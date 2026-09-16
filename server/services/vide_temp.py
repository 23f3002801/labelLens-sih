#!/usr/bin/env python3
"""
label_extractor.py — 360° product scan (video/image) -> flat, compliance-ready label images.

Pipeline
--------
1. Memory-safe keyframe selection: stream with grab(), keep (idx, sharpness) only,
   re-read the sharpest frame per time bucket.
2. Segmentation: GroundingDINO box prompts -> SAM2 (best), per-frame AMG fallback
   with overlap-merge so multi-part AMG segments become one product mask.
3. Geometry (multi-hypothesis per mask):
   - cuboid:   robust angle-sorted quad ordering + perspective rectification
   - cylinder: PCA axis alignment + arc-length unwrap (cos-weighted, label band
               auto-cropped), strips stitched ACROSS FRAMES into one panorama,
               fused with per-texel nan-median (kills specular glare)
   - irregular: alpha-masked crop (pouches, bags)
4. Dedup: 180-degree-invariant perceptual hashing, filter-then-cap clustering.
5. Fusion: ECC alignment + median stack for repeated cuboid/irregular faces.
6. Orientation via tesseract OSD if installed; quality gates + JSON report.

Install
-------
    pip install opencv-python numpy torch sam2 imagehash pillow scikit-learn tqdm
    # optional but recommended:
    pip install transformers          # GroundingDINO-guided segmentation
    pip install pytesseract && apt install tesseract-ocr   # orientation OSD

Usage
-----
    python label_extractor.py scan.mp4 -o labels/
    python label_extractor.py can_scan.mp4 -o labels/ --shape cylinder   # cans/bottles
    python label_extractor.py photo.png  -o labels/
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import time
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# ----------------------------- optional deps -----------------------------
try:
    import torch
    HAS_TORCH = True
except Exception:
    HAS_TORCH = False

try:
    from PIL import Image
    import imagehash
    HAS_HASH = True
except Exception:
    HAS_HASH = False

try:
    from sklearn.cluster import AgglomerativeClustering
    HAS_SKLEARN = True
except Exception:
    HAS_SKLEARN = False

try:
    from pytesseract import image_to_osd, Output
    HAS_OSD = True
except Exception:
    HAS_OSD = False

try:
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
    HAS_DINO = True
except Exception:
    HAS_DINO = False

log = logging.getLogger("label_extractor")
DEFAULT_CKPT_DIR = Path(__file__).resolve().parents[1] / "checkpoints"


# ----------------------------- config -----------------------------
@dataclass
class Config:
    # sampling
    max_keyframes: int = 15
    samples_per_sec: float = 5.0
    # segmentation
    detector: str = "auto"                      # auto | dino | amg
    dino_model: str = "IDEA-Research/grounding-dino-tiny"
    dino_prompt: str = "product. package. box. can. bottle. jar. carton. pouch."
    dino_box_thresh: float = 0.30
    dino_text_thresh: float = 0.25
    amg_points_per_side: int = 12
    min_mask_area_frac: float = 0.06
    max_mask_area_frac: float = 0.92
    mask_merge_containment: float = 0.50
    # geometry
    shape_mode: str = "auto"                    # auto | cuboid | cylinder | irregular
    quad_eps_levels: tuple = (0.015, 0.025, 0.04)
    quad_min_fill: float = 0.80
    distortion_thresh_deg: float = 30.0
    cyl_max_radius_px: int = 400
    cyl_band_tol: float = 0.15
    cyl_min_label_h: int = 48
    min_face_px: int = 64
    out_min_side_px: int = 896
    # fusion / dedup
    texture_fusion: bool = True
    ecc_downscale: float = 0.5
    cluster_dist: float = 12.0
    max_faces: int = 6
    min_votes: int = 2
    # quality / models
    blur_gate: float = 0.0                      # 0 = off; try 20-60
    use_osd: bool = True
    sam_checkpoint: str = str(DEFAULT_CKPT_DIR / "sam2.1_hiera_large.pt")
    sam_config: str = "configs/sam2.1/sam2.1_hiera_l.yaml"
    device: str = ""


@dataclass
class Candidate:
    image: np.ndarray                 # BGR (cyl strips) or BGRA (cuboid/irregular)
    method: str                       # cuboid | cyl | irregular
    frame_idx: int
    sharpness: float
    area_frac: float
    weight: Optional[np.ndarray] = None   # per-pixel fusion weight (cyl strips)
    meta: dict = field(default_factory=dict)


# ----------------------------- small utils -----------------------------
def composite_white(img: np.ndarray) -> np.ndarray:
    """Flatten BGRA over white. Every metric (sharpness, hashing, fusion) must
    run on THIS, never on the raw 4-channel array."""
    if img.ndim == 2 or img.shape[2] == 3:
        return img
    a = img[..., 3:4].astype(np.float32) / 255.0
    out = img[..., :3].astype(np.float32) * a + 255.0 * (1.0 - a)
    return out.astype(np.uint8)


def sharpness(img: np.ndarray) -> float:
    g = cv2.cvtColor(composite_white(img), cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(cv2.GaussianBlur(g, (5, 5), 0), cv2.CV_64F).var())


@contextmanager
def inference_ctx(device: str):
    if HAS_TORCH:
        with torch.inference_mode():
            if device.startswith("cuda"):
                with torch.autocast("cuda", dtype=torch.bfloat16):
                    yield
            else:
                yield
    else:
        yield


# ----------------------------- stage 1: keyframes -----------------------------
def select_keyframes(path: Path, cfg: Config) -> list[tuple[int, np.ndarray]]:
    """Two-pass, O(1) memory: pass 1 scores samples (grab() for skipped frames),
    pass 2 re-reads only the per-bucket winners."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    interval = max(1, int(round(fps / cfg.samples_per_sec)))

    samples: list[tuple[int, float]] = []
    idx = 0
    while True:
        if idx % interval == 0:
            ok, frame = cap.read()
            if not ok:
                break
            samples.append((idx, sharpness(frame)))
        else:
            if not cap.grab():
                break
        idx += 1
    cap.release()
    if not samples:
        return []

    n = min(cfg.max_keyframes, len(samples))
    bounds = np.linspace(0, len(samples), n + 1).astype(int)
    picked = [max(samples[bounds[i]:bounds[i + 1]], key=lambda t: t[1])[0]
              for i in range(n) if bounds[i] < bounds[i + 1]]

    cap = cv2.VideoCapture(str(path))
    out = []
    for fidx in picked:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fidx)
        ok, frame = cap.read()
        if ok:
            out.append((fidx, frame))
    cap.release()
    return out


# ----------------------------- stage 2: segmentation -----------------------------
class Segmenter:
    def __init__(self, cfg: Config):
        if not HAS_TORCH:
            raise RuntimeError("torch and the sam2 package are required")
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        self.cfg = cfg
        self.device = cfg.device or ("cuda" if torch.cuda.is_available() else "cpu")
        log.info("Loading SAM 2 (%s) on %s", cfg.sam_config, self.device)
        sam = build_sam2(cfg.sam_config, cfg.sam_checkpoint,
                         device=self.device, apply_postprocessing=False)
        self.predictor = SAM2ImagePredictor(sam)

        self.mode = "amg"
        self.dino = self.dino_proc = None
        if cfg.detector in ("auto", "dino") and HAS_DINO:
            try:
                self.dino_proc = AutoProcessor.from_pretrained(cfg.dino_model)
                self.dino = AutoModelForZeroShotObjectDetection.from_pretrained(
                    cfg.dino_model).to(self.device).eval()
                self.mode = "dino"
                log.info("Detector: GroundingDINO + SAM2 (prompted)")
            except Exception as e:
                log.warning("GroundingDINO unavailable (%s); using AMG.", e)
        if self.mode == "amg":
            log.info("Detector: SAM2 automatic mask generator")
        # AMG is always available as per-frame fallback
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
        self.amg = SAM2AutomaticMaskGenerator(
            sam, points_per_side=cfg.amg_points_per_side,
            pred_iou_thresh=0.85, stability_score_thresh=0.85,
            min_mask_region_area=2000)

    # ---- GroundingDINO ----
    def _dino_boxes(self, rgb: np.ndarray) -> np.ndarray:
        inputs = self.dino_proc(images=rgb, text=self.cfg.dino_prompt,
                                return_tensors="pt").to(self.device)
        with inference_ctx(self.device):
            out = self.dino(**inputs)
        try:
            res = self.dino_proc.post_process_grounded_object_detection(
                out, input_ids=inputs.input_ids,
                box_threshold=self.cfg.dino_box_thresh,
                text_threshold=self.cfg.dino_text_thresh,
                target_sizes=[rgb.shape[:2]])[0]
        except TypeError:  # older transformers signature
            res = self.dino_proc.post_process_grounded_object_detection(
                out, inputs.input_ids,
                threshold=self.cfg.dino_box_thresh,
                text_threshold=self.cfg.dino_text_thresh,
                target_sizes=[rgb.shape[:2]])[0]
        return res["boxes"].cpu().numpy()

    # ---- mask merging for AMG (label + body segments -> one product) ----
    def _merge(self, masks: list[np.ndarray]) -> list[np.ndarray]:
        accepted: list[np.ndarray] = []
        for m in sorted(masks, key=lambda a: a.sum(), reverse=True):
            for a in accepted:
                inter = np.logical_and(m, a).sum()
                if inter / max(min(m.sum(), a.sum()), 1) >= self.cfg.mask_merge_containment:
                    a |= m
                    break
            else:
                accepted.append(m.copy())
        return accepted

    def segment(self, frame_bgr: np.ndarray) -> list[np.ndarray]:
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        farea = frame_bgr.shape[0] * frame_bgr.shape[1]
        lo, hi = self.cfg.min_mask_area_frac, self.cfg.max_mask_area_frac
        masks: list[np.ndarray] = []

        if self.mode == "dino":
            self.predictor.set_image(rgb)
            with inference_ctx(self.device):
                for box in self._dino_boxes(rgb):
                    m, scores, _ = self.predictor.predict(
                        box=box.reshape(-1), multimask_output=True)
                    masks.append(m[int(np.argmax(scores))])
            masks = [mm for mm in masks if lo <= mm.mean() <= hi]
            if masks:
                return masks
            log.info("DINO found no boxes this frame; falling back to AMG.")

        with inference_ctx(self.device):
            for md in self.amg.generate(rgb):
                if lo <= md["area"] / farea <= hi:
                    masks.append(md["segmentation"])
        return self._merge(masks) if masks else []


# ----------------------------- stage 3a: cuboid -----------------------------
def order_quad(pts: np.ndarray) -> np.ndarray:
    """Angle-sort around centroid (valid at ANY rotation), then roll so the
    sequence starts at the TL-most corner: TL,TR,BR,BL."""
    c = pts.mean(axis=0)
    pts = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    span = np.maximum(pts.max(0) - pts.min(0), 1e-6)
    start = int(np.argmin(((pts - pts.min(0)) / span).sum(axis=1)))
    return np.roll(pts, -start, axis=0).astype(np.float32)


def quad_defect(pts: np.ndarray) -> float:
    total = 0.0
    n = len(pts)
    for i in range(n):
        v1, v2 = pts[i - 1] - pts[i], pts[(i + 1) % n] - pts[i]
        cosv = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9)
        total += abs(math.degrees(math.acos(np.clip(cosv, -1, 1))) - 90.0)
    return total


def try_quad(frame: np.ndarray, mask: np.ndarray, cfg: Config,
             frame_idx: int) -> Optional[Candidate]:
    contours, _ = cv2.findContours(mask.astype(np.uint8),
                                   cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(c, True)
    rgba = np.dstack([frame, (mask.astype(np.uint8) * 255)])

    for eps in cfg.quad_eps_levels:
        approx = cv2.approxPolyDP(c, eps * peri, True)
        if len(approx) != 4:
            continue
        pts = order_quad(approx.reshape(4, 2).astype(np.float32))
        defect = quad_defect(pts)
        if defect > cfg.distortion_thresh_deg:
            continue
        if cv2.contourArea(approx) / max(cv2.contourArea(c), 1) < cfg.quad_min_fill:
            continue

        cen = pts.mean(axis=0)
        inset = pts + 0.025 * (cen - pts)          # shave mask-edge halo
        tl, tr, br, bl = inset
        w = max(int(round(np.linalg.norm(br - bl))), int(round(np.linalg.norm(tr - tl))))
        h = max(int(round(np.linalg.norm(tr - br))), int(round(np.linalg.norm(tl - bl))))
        if w < cfg.min_face_px or h < cfg.min_face_px:
            return None
        scale = min(6.0, max(1.0, cfg.out_min_side_px / max(1, min(w, h))))
        W, H = int(w * scale), int(h * scale)
        dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], np.float32)
        M = cv2.getPerspectiveTransform(inset.astype(np.float32), dst)
        out = cv2.warpPerspective(rgba, M, (W, H), flags=cv2.INTER_CUBIC,
                                  borderValue=(255, 255, 255, 0))
        return Candidate(out, "cuboid", frame_idx, sharpness(out), float(mask.mean()),
                         meta={"defect_deg": round(defect, 1)})
    return None


# ----------------------------- stage 3b: cylinder -----------------------------
def unwrap_cylinder(frame: np.ndarray, mask: np.ndarray, cfg: Config,
                    frame_idx: int) -> Optional[Candidate]:
    ys, xs = np.nonzero(mask)
    if len(xs) < 500:
        return None
    pts = np.stack([xs, ys], 1).astype(np.float64)
    mean = pts.mean(0)
    cov = (pts - mean).T @ (pts - mean) / len(pts)
    evals, evecs = np.linalg.eigh(cov)
    axis = evecs[:, int(np.argmax(evals))]

    # rotate so cylinder axis is vertical (product scans are ~upright);
    # getRotationMatrix2D(center, -theta, 1) maps axis -> +y  (verified below)
    theta = math.atan2(axis[0], axis[1])
    M = cv2.getRotationMatrix2D(tuple(mean), -math.degrees(theta), 1.0)
    h, w = mask.shape
    rimg = cv2.warpAffine(frame, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderValue=(255, 255, 255))
    rmask = cv2.warpAffine(mask.astype(np.uint8), M, (w, h),
                           flags=cv2.INTER_NEAREST)

    # per-row silhouette extent
    lo = np.full(h, np.nan); hi = np.full(h, np.nan)
    for y in range(h):
        xr = np.flatnonzero(rmask[y])
        if len(xr):
            lo[y], hi[y] = xr[0], xr[-1]
    valid = np.flatnonzero(~np.isnan(lo))
    if len(valid) < 60:
        return None
    widths = (hi - lo + 1)[valid]
    mid = valid[len(valid) // 4: 3 * len(valid) // 4 + 1]
    r = float(np.median((hi - lo + 1)[mid]) / 2)
    if r < 12:
        return None
    band = valid[np.abs((hi - lo + 1)[valid] - 2 * r) < cfg.cyl_band_tol * 2 * r]
    if len(band) < cfg.cyl_min_label_h:
        return None
    y0, y1 = int(band[0]), int(band[-1])
    if y1 - y0 < cfg.cyl_min_label_h:
        return None
    cx = float(np.median((lo[band] + hi[band]) / 2))

    if r > cfg.cyl_max_radius_px:                      # keep strips manageable
        s = cfg.cyl_max_radius_px / r
        rimg = cv2.resize(rimg, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        rmask = cv2.resize(rmask, None, fx=s, fy=s, interpolation=cv2.INTER_NEAREST)
        y0, y1, r, cx = int(y0 * s), int(y1 * s), r * s, cx * s

    # arc-length resampling: s in [-pi*r/2, pi*r/2]  <->  x = cx + r*sin(s/r)
    strip_w = max(32, int(math.pi * r))
    s = np.linspace(-math.pi * r / 2, math.pi * r / 2, strip_w)
    map_x = np.broadcast_to((cx + r * np.sin(s / r)).astype(np.float32), (y1 - y0, strip_w))
    map_y = np.broadcast_to(np.arange(y0, y1, dtype=np.float32)[:, None], (y1 - y0, strip_w))
    strip = cv2.remap(rimg, map_x, map_y, cv2.INTER_CUBIC,
                      borderMode=cv2.BORDER_REPLICATE)
    wgt = np.broadcast_to(np.clip(np.cos(s / r), 0, 1).astype(np.float32),
                          (y1 - y0, strip_w)).copy()
    wgt[cv2.remap(rmask, map_x, map_y, cv2.INTER_NEAREST) == 0] = 0

    return Candidate(strip, "cyl", frame_idx, sharpness(strip), float(mask.mean()),
                     weight=wgt, meta={"r_px": round(r, 1)})


# ----------------------------- stage 3c: irregular -----------------------------
def irregular_crop(frame: np.ndarray, mask: np.ndarray, cfg: Config,
                   frame_idx: int) -> Optional[Candidate]:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    if x1 - x0 < cfg.min_face_px or y1 - y0 < cfg.min_face_px:
        return None
    p = 2
    xa, xb = max(0, x0 - p), min(frame.shape[1], x1 + p + 1)
    ya, yb = max(0, y0 - p), min(frame.shape[0], y1 + p + 1)
    rgba = np.dstack([frame, (mask.astype(np.uint8) * 255)])[ya:yb, xa:xb]
    return Candidate(rgba, "irregular", frame_idx, sharpness(rgba),
                     float(mask.mean()), meta={})


# ----------------------------- stage 4: cross-frame cylinder stitching -----------------------------
class StripStitcher:
    """Stitches cos-weighted 180-degree strips into a panorama via gradient
    template matching; fuses with per-texel nan-median (glare/occlusion robust)."""

    MATCH_THRESH = 0.30
    WRAP_THRESH = 0.50

    def __init__(self):
        self.items: list[tuple[np.ndarray, np.ndarray, np.ndarray, int]] = []
        self.warnings: list[str] = []

    @staticmethod
    def _grad(img: np.ndarray) -> np.ndarray:
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        mag = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, 3),
                            cv2.Sobel(g, cv2.CV_32F, 0, 1, 3))
        return cv2.normalize(mag, None, 0, 1, cv2.NORM_MINMAX)

    def _bounds(self) -> tuple[int, int]:
        x0 = min(it[3] for it in self.items)
        x1 = max(it[3] + it[1].shape[1] for it in self.items)
        return x0, x1

    def _canvas_grad(self) -> np.ndarray:
        x0, x1 = self._bounds()
        H = self.items[0][1].shape[0]
        cv_ = np.zeros((H, x1 - x0), np.float32)
        for g, _, _, x in self.items:
            xs = x - x0
            cv_[:, xs:xs + g.shape[1]] = np.maximum(cv_[:, xs:xs + g.shape[1]], g)
        return cv_

    def add(self, strip: np.ndarray, wgt: np.ndarray) -> None:
        if self.items:  # normalize to first strip's height
            H = self.items[0][1].shape[0]
            if strip.shape[0] != H:
                f = H / strip.shape[0]
                strip = cv2.resize(strip, (max(8, int(strip.shape[1] * f)), H),
                                   interpolation=cv2.INTER_AREA)
                wgt = cv2.resize(wgt, (strip.shape[1], H), interpolation=cv2.INTER_AREA)
        grad = self._grad(strip)

        if not self.items:
            self.items.append((grad, strip, wgt, 0))
            return

        cg = self._canvas_grad()
        t0 = int(0.30 * strip.shape[1]); t1 = int(0.70 * strip.shape[1])
        templ = grad[:, t0:t1]
        if templ.shape[0] > cg.shape[0] or templ.shape[1] > cg.shape[1]:
            self.warnings.append("template larger than canvas; strip appended")
            self.items.append((grad, strip, wgt,
                               max(0, self._canvas_w() - strip.shape[1] // 2)))
            return
        res = cv2.matchTemplate(cg, templ, cv2.TM_CCOEFF_NORMED)
        _, score, _, loc = cv2.minMaxLoc(res)
        if not np.isfinite(score) or score < self.MATCH_THRESH:
            self.warnings.append(f"weak match ({score:.2f}); possible rotation gap")
            x_off = self._canvas_w() - int(0.10 * strip.shape[1])
        else:
            x_off = loc[0] - t0
        self.items.append((grad, strip, wgt, x_off))

    def _canvas_w(self) -> int:
        x0, x1 = self._bounds()
        return x1 - x0

    def finish(self) -> tuple[np.ndarray, dict]:
        x0, _ = self._bounds()
        H = self.items[0][1].shape[0]
        W = self._canvas_w()
        K = len(self.items)
        vals = np.full((K, H, W, 3), np.nan, np.float16)
        for i, (g, s, w_, x) in enumerate(self.items):
            xs = x - x0
            valid = w_ > 0.05
            view = vals[i, :, xs:xs + s.shape[1]]
            view[valid] = s[valid]
        cg = self._canvas_grad()

        # loop closure: right end duplicating the left start -> crop it
        g0, s0, _, x0i = self.items[0]
        t0 = int(0.30 * s0.shape[1]); t1 = int(0.70 * s0.shape[1])
        cut = 0
        if W > 2 * (t1 - t0):
            res = cv2.matchTemplate(cg, g0[:, t0:t1], cv2.TM_CCOEFF_NORMED)
            _, score, _, loc = cv2.minMaxLoc(res)
            expected = (x0i - x0) + t0
            if np.isfinite(score) and score > self.WRAP_THRESH and loc[0] > expected + (t1 - t0):
                cut = (loc[0] - t0) - (x0i - x0)
                if not (0 < cut < W // 2):
                    cut = 0

        Wf = W - cut
        with np.errstate(all="ignore"):
            fused = np.nanmedian(vals[:, :, :Wf], axis=0).astype(np.float32)
        fused = np.nan_to_num(fused, nan=255.0).astype(np.uint8)

        strip_w = float(np.median([it[1].shape[1] for it in self.items]))
        info = {"n_strips": K, "panorama_w": int(Wf), "wrap_px_removed": int(cut),
                "est_360_coverage": round(min(1.0, Wf / (2 * strip_w)), 2),
                "warnings": self.warnings}
        return fused, info


# ----------------------------- stage 5: ECC + median fusion -----------------------------
def ecc_fuse(members: list[Candidate], cfg: Config) -> tuple[np.ndarray, dict]:
    ref = max(members, key=lambda m: m.sharpness)
    ref_bgr = composite_white(ref.image)
    H, W = ref_bgr.shape[:2]
    d = cfg.ecc_downscale
    ref_s = cv2.cvtColor(cv2.resize(ref_bgr, None, fx=d, fy=d), cv2.COLOR_BGR2GRAY).astype(np.float32)
    stack = [ref_bgr.astype(np.float32)]
    n_aligned = 0

    for m in members:
        if m is ref:
            continue
        img = composite_white(m.image)
        if img.shape[:2] != (H, W):
            img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
        small = cv2.cvtColor(cv2.resize(img, None, fx=d, fy=d), cv2.COLOR_BGR2GRAY).astype(np.float32)
        warp = np.eye(2, 3, dtype=np.float32)
        try:
            cv2.findTransformECC(ref_s, small, warp, cv2.MOTION_AFFINE,
                                 (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5))
            warp[:, 2] /= d
            img = cv2.warpAffine(img, warp, (W, H),
                                 flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                 borderValue=(255, 255, 255))
            n_aligned += 1
        except cv2.error:
            self_skip = True  # unaligned member still contributes (median robust)
        stack.append(img.astype(np.float32))

    fused = np.median(np.stack(stack), axis=0).astype(np.uint8)
    return fused, {"ecc_members": len(members), "ecc_aligned": n_aligned}


# ----------------------------- stage 6: orientation -----------------------------
def fix_orientation(bgr: np.ndarray, cfg: Config) -> np.ndarray:
    if cfg.use_osd and HAS_OSD:
        try:
            rgb = cv2.cvtColor(composite_white(bgr), cv2.COLOR_BGR2RGB)
            osd = image_to_osd(Image.fromarray(rgb), output=Output.DICT)
            rot = int(osd.get("rotate", 0)) % 360
            if rot:
                bgr = np.rot90(bgr, k=(360 - rot) // 90).copy()  # rot90 is CCW
            return bgr
        except Exception as e:
            log.warning("OSD failed (%s); keeping orientation as-is.", e)
    return bgr


# ----------------------------- hashing / clustering -----------------------------
def hash_vecs(images: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    n = len(images)
    H0 = np.zeros((n, 64), bool); H180 = np.zeros((n, 64), bool)
    for i, img in enumerate(images):
        rgb = cv2.cvtColor(composite_white(img), cv2.COLOR_BGR2RGB)
        if HAS_HASH:
            im0 = Image.fromarray(rgb)
            H0[i] = imagehash.phash(im0, hash_size=8).hash.ravel()
            H180[i] = imagehash.phash(im0.rotate(180), hash_size=8).hash.ravel()
        else:  # crude fallback: mean-thresholded 8x8 thumbnail
            g = cv2.cvtColor(rgb, cv2.COLOR_BGR2GRAY)
            t = cv2.resize(g, (8, 8)).astype(np.float32)
            H0[i] = (t > t.mean()).ravel()
            t180 = t[::-1, ::-1]
            H180[i] = (t180 > t.mean()).ravel()
    return H0, H180


def phash_dist_matrix(H0: np.ndarray, H180: np.ndarray) -> np.ndarray:
    X = H0.astype(bool)
    Y = np.concatenate([H0, H180], axis=0).astype(bool)
    d = np.count_nonzero(X[:, None, :] != Y[None, :, :], axis=2)
    n = len(X)
    return np.minimum(d[:, :n], d[:, n:]).astype(np.float32)


def cluster_candidates(cands: list[Candidate], cfg: Config) -> list[list[int]]:
    H0, H180 = hash_vecs([c.image for c in cands])
    dist = phash_dist_matrix(H0, H180)
    groups: list[list[int]] = []
    if HAS_SKLEARN:
        labels = AgglomerativeClustering(
            n_clusters=None, metric="precomputed", linkage="average",
            distance_threshold=cfg.cluster_dist).fit_predict(dist)
        buckets = defaultdict(list)
        for i, lb in enumerate(labels):
            buckets[int(lb)].append(i)
        groups = list(buckets.values())
    else:  # union-find fallback
        parent = list(range(len(cands)))
        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]; a = parent[a]
            return a
        for i in range(len(cands)):
            for j in range(i + 1, len(cands)):
                if dist[i, j] < cfg.cluster_dist:
                    parent[find(i)] = find(j)
        buckets = defaultdict(list)
        for i in range(len(cands)):
            buckets[find(i)].append(i)
        groups = list(buckets.values())
    return groups


# ----------------------------- orchestrator -----------------------------
def extract_labels(input_path: str, out_dir: str, cfg: Config) -> dict:
    t0 = time.time()
    path = Path(input_path)
    outp = Path(out_dir); outp.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []

    if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".bmp", ".webp"):
        frame = cv2.imread(str(path))
        if frame is None:
            raise RuntimeError(f"Cannot read image: {path}")
        frames, single = [(0, frame)], True
    else:
        frames = select_keyframes(path, cfg)
        single = False
    if not frames:
        raise RuntimeError("No usable frames extracted")
    log.info("Keyframes selected: %s", [i for i, _ in frames])

    seg = Segmenter(cfg)
    cands: list[Candidate] = []
    for fidx, frame in frames:
        for mask in seg.segment(frame):
            made = False
            if cfg.shape_mode in ("auto", "cuboid"):
                c = try_quad(frame, mask, cfg, fidx)
                if c: cands.append(c); made = True
            if cfg.shape_mode in ("auto", "cylinder"):
                c = unwrap_cylinder(frame, mask, cfg, fidx)
                if c: cands.append(c); made = True
            if cfg.shape_mode == "irregular" or (cfg.shape_mode == "auto" and not made):
                c = irregular_crop(frame, mask, cfg, fidx)
                if c: cands.append(c)
    log.info("Geometry candidates: %d", len(cands))
    if not cands:
        return {"outputs": [], "warnings": ["no candidates found"]}

    # absolute quality gate
    if cfg.blur_gate > 0:
        strong = [c for c in cands if c.sharpness >= cfg.blur_gate]
        if strong:
            if len(strong) < len(cands):
                warnings.append(f"{len(cands) - len(strong)} candidates below blur gate")
            cands = strong
        else:
            warnings.append("ALL candidates below blur gate; keeping top-3 anyway")
            cands = sorted(cands, key=lambda c: c.sharpness, reverse=True)[:3]

    groups = cluster_candidates(cands, cfg)
    groups = [g for g in groups
              if len(g) >= (1 if single else cfg.min_votes)]
    groups.sort(key=lambda g: (len(g), max(cands[i].sharpness for i in g)), reverse=True)
    if not groups:  # short clips: fall back to best singles, flagged
        groups = [[i] for i in sorted(range(len(cands)),
                                      key=lambda i: -cands[i].sharpness)[:3]]
        warnings.append("no multi-view clusters; saved flagged singles")
    groups = groups[:cfg.max_faces]  # cap AFTER filtering (boxes have 6 faces)

    outputs = []
    for gi, g in enumerate(groups):
        members = [cands[i] for i in g]
        method = members[0].method
        if method == "cyl" and len(members) >= 2 and cfg.texture_fusion:
            st = StripStitcher()
            for m in sorted(members, key=lambda c: c.frame_idx):  # temporal order
                st.add(m.image, m.weight if m.weight is not None
                       else np.ones(m.image.shape[:2], np.float32))
            fused, info = st.finish()
        elif len(members) >= 2 and cfg.texture_fusion:
            fused, info = ecc_fuse(members, cfg)
        else:
            best = max(members, key=lambda m: m.sharpness)
            fused = composite_white(best.image)
            info = {"members": 1}
        fused = fix_orientation(fused, cfg)
        out_file = outp / f"label_{gi + 1:02d}_{method}.png"
        cv2.imwrite(str(out_file), fused)
        outputs.append({"path": str(out_file), "method": method,
                        "n_views": len(members),
                        "frames": sorted({m.frame_idx for m in members}),
                        "sharpness": round(sharpness(fused), 1), **info})
        log.info("Saved %s  (%d view(s), %s)", out_file, len(members), method)

    # near-duplicate final outputs (e.g. frontal quad vs unwrap of same face)
    if len(outputs) >= 2:
        H0, H180 = hash_vecs([cv2.imread(o["path"]) for o in outputs])
        D = phash_dist_matrix(H0, H180)
        for i in range(len(outputs)):
            for j in range(i + 1, len(outputs)):
                if D[i, j] < 14:
                    warnings.append(
                        f"outputs {i + 1} and {j + 1} look like the same face "
                        f"(pHash={D[i, j]:.0f}); consider --shape to disambiguate")

    report = {"input": str(path), "frames_used": [i for i, _ in frames],
              "params": asdict(cfg), "outputs": outputs,
              "warnings": warnings, "runtime_s": round(time.time() - t0, 1)}
    rp = outp / "extraction_report.json"
    rp.write_text(json.dumps(report, indent=2, default=str))
    log.info("Report: %s", rp)
    return report


# ----------------------------- CLI -----------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="360° product scan -> flat label images")
    ap.add_argument("input")
    ap.add_argument("-o", "--out", default="extracted_labels")
    ap.add_argument("--shape", default="auto", choices=["auto", "cuboid", "cylinder", "irregular"])
    ap.add_argument("--detector", default="auto", choices=["auto", "dino", "amg"])
    ap.add_argument("--device", default="")
    ap.add_argument("--max-keyframes", type=int, default=15)
    ap.add_argument("--samples-per-sec", type=float, default=5.0)
    ap.add_argument("--min-votes", type=int, default=2)
    ap.add_argument("--max-faces", type=int, default=6)
    ap.add_argument("--cluster-dist", type=float, default=12.0)
    ap.add_argument("--distortion", type=float, default=30.0)
    ap.add_argument("--blur-gate", type=float, default=0.0)
    ap.add_argument("--sam-checkpoint", default=str(DEFAULT_CKPT_DIR / "sam2.1_hiera_large.pt"))
    ap.add_argument("--sam-config", default="configs/sam2.1/sam2.1_hiera_l.yaml")
    ap.add_argument("--dino-prompt", default="product. package. box. can. bottle. jar. carton. pouch.")
    ap.add_argument("--no-fusion", action="store_true")
    ap.add_argument("--no-osd", action="store_true")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO,
                        format="%(levelname)s %(message)s")
    cfg = Config(
        shape_mode=args.shape, detector=args.detector, device=args.device,
        max_keyframes=args.max_keyframes, samples_per_sec=args.samples_per_sec,
        min_votes=args.min_votes, max_faces=args.max_faces,
        cluster_dist=args.cluster_dist, distortion_thresh_deg=args.distortion,
        blur_gate=args.blur_gate, sam_checkpoint=args.sam_checkpoint,
        sam_config=args.sam_config, dino_prompt=args.dino_prompt,
        texture_fusion=not args.no_fusion, use_osd=not args.no_osd)

    report = extract_labels(args.input, args.out, cfg)
    print(f"\n{'=' * 60}")
    for o in report.get("outputs", []):
        print(f"  {o['path']}   views={o['n_views']}  sharpness={o['sharpness']}")
    for w in report.get("warnings", []):
        print(f"  WARNING: {w}")
    if not report.get("outputs"):
        print("  No labels extracted.")


if __name__ == "__main__":
    main()