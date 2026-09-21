#!/usr/bin/env python3
"""
label_extractor.py (v8 — RIGID) — 360° product scan -> flat, compliance-ready label images.

v8 changelog:
  - CYLINDER FIX: all cylinder strips of one object form exactly ONE mosaic.
    v7's pHash clustering split the same can's strips into 5 mini-panoramas
    (28%/13% coverage + singles) -> unreadable. A cylinder has one label
    surface; clustering is only applied to box faces.
  - STRICT COMMIT: the global shape decision is law. cuboid -> only quads.
    cylinder -> only strips. irregular -> only alpha crops. No irregular
    safety net for cuboid/cylinder, no fallback crops, ever.
  - ALL FALLBACK LADDERS REMOVED: no AMG cross-fallback (detector=dino + no
    boxes -> frame contributes nothing), no template stitcher, no
    single-view slot filling, no irregular re-association, no OCR/OSD.
    Errors are loud; degraded modes are explicitly reported, never silent.
  - mosaic_min_rotation guard removed: stacking same-azimuth strips is
    CORRECT median fusion (glare suppression), not garbage. The garbage in
    v6/v7 came from strips of DIFFERENT faces being stacked.
  - Default keyframes 24 (more strips -> finer dTheta + better fusion).
  - --tracker frame (default) | video (explicit; needs decord).

Usage:
    python label_extractor.py scan.mp4 --detector dino
    python label_extractor.py can.mp4 --detector dino --max-keyframes 30
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import time
import warnings
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
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
    HAS_DINO = True
except Exception:
    HAS_DINO = False

try:
    from transformers import CLIPProcessor, CLIPModel
    HAS_CLIP = True
except Exception:
    HAS_CLIP = False

log = logging.getLogger("label_extractor")
DEFAULT_CKPT_DIR = Path(__file__).resolve().parents[1] / "checkpoints"
DINO_MODEL_PATH = DEFAULT_CKPT_DIR / "grounding-dino-tiny"
CLIP_MODEL_PATH = DEFAULT_CKPT_DIR / "clip-vit-base-patch32"
CHECKPOINT_PATH = DEFAULT_CKPT_DIR / "sam2.1_hiera_large.pt"


# ----------------------------- config -----------------------------
@dataclass
class Config:
    # sampling
    max_keyframes: int = 24
    samples_per_sec: float = 5.0
    keyframe_dedup_bits: int = 3
    # tracking
    tracker: str = "frame"               # frame | video
    # segmentation
    detector: str = "dino"               # GroundingDINO is required
    dino_model: str = str(DINO_MODEL_PATH)
    dino_prompt: str = "product. package. box. can. bottle. jar. carton. pouch."
    dino_box_thresh: float = 0.30
    dino_text_thresh: float = 0.25
    min_mask_area_frac: float = 0.06
    max_mask_area_frac: float = 0.92
    mask_merge_containment: float = 0.50
    dino_nms_iou: float = 0.70
    # geometry
    shape_mode: str = "auto"
    quad_eps_levels: tuple = (0.015, 0.03, 0.05)
    quad_min_fill: float = 0.80
    quad_inset: float = 0.02
    distortion_thresh_deg: float = 30.0
    cyl_max_radius_px: int = 400
    cyl_band_tol: float = 0.15
    cyl_min_label_h: int = 48
    cyl_trim_lo: float = 0.70
    cyl_trim_hi: float = 1.35
    min_face_px: int = 64
    out_min_side_px: int = 896
    mask_feather_px: int = 3
    # cuboid two-face split
    split_faces: bool = True
    fold_min_support: float = 0.55
    hex_min_conf: float = 0.30
    hex_min_fill: float = 0.85
    # mask edge refinement
    edge_refine: bool = True
    # glare suppression
    glare_weight: bool = True
    # CLIP shape head
    use_clip: bool = True
    clip_model: str = str(CLIP_MODEL_PATH)
    clip_min_conf: float = 0.55
    clip_margin: float = 0.15
    clip_frames: int = 5
    # shape decision
    shape_vote_min_score: float = 0.25
    shape_margin: float = 0.12
    xframe_min_frames: int = 4
    width_ratio_cyl: float = 1.15
    width_ratio_box: float = 1.28
    motion_thresh: float = 0.05
    rotation_min_total: float = 1.2      # rad; cylinder needs measured rotation
    cyl_cap_min: float = 0.12
    # rotation mosaic
    mosaic_loop_tol: float = 0.35
    mosaic_max_w: int = 8000
    mosaic_max_h: int = 640
    mosaic_refine_dx: tuple = tuple(range(-8, 9))          # was (-6,-3,0,3,6)
    mosaic_refine_scales: tuple = (0.96, 0.98, 1.0, 1.02, 1.04)  # was (0.97,1.0,1.03)
    pair_min_matches: int = 12
    # face verification (cuboid face grouping)
    orb_match_inliers: int = 12
    orb_match_ratio: float = 0.35
    # fusion
    texture_fusion: bool = True
    ecc_downscale: float = 0.5
    cluster_dist: float = 12.0
    max_faces: int = 6
    # quality
    blur_gate: float = 0.0
    # models
    sam_checkpoint: str = str(DEFAULT_CKPT_DIR / "sam2.1_hiera_large.pt")
    sam_config: str = "configs/sam2.1/sam2.1_hiera_l.yaml"
    device: str = ""


@dataclass
class Candidate:
    image: np.ndarray
    method: str
    frame_idx: int
    sharpness: float
    area_frac: float
    weight: Optional[np.ndarray] = None
    meta: dict = field(default_factory=dict)


# ----------------------------- small utils -----------------------------
def clamp01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def composite_white(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2 or img.shape[2] == 3:
        return img
    a = img[..., 3:4].astype(np.float32) / 255.0
    out = img[..., :3].astype(np.float32) * a + 255.0 * (1.0 - a)
    return out.astype(np.uint8)


def sharpness(img: np.ndarray) -> float:
    g = cv2.cvtColor(composite_white(img), cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(cv2.GaussianBlur(g, (5, 5), 0), cv2.CV_64F).var())


def _smooth1d(v: np.ndarray, k: int = 7) -> np.ndarray:
    v = np.asarray(v, np.float32)
    if v.size < 3:
        return v
    if k % 2 == 0:
        k += 1
    k = min(k, v.size if v.size % 2 else v.size - 1)
    if k < 3:
        return v
    pad = np.pad(v, (k // 2, k // 2), mode="edge")
    return np.convolve(pad, np.ones(k, np.float32) / k, mode="valid")


def _poly_area(p: np.ndarray) -> float:
    x, y = p[:, 0].astype(np.float64), p[:, 1].astype(np.float64)
    return 0.5 * abs(float(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1))))


def _wmedian(v: np.ndarray, w: np.ndarray) -> float:
    o = np.argsort(v)
    v, w = v[o], w[o]
    cw = np.cumsum(w)
    if cw[-1] <= 0:
        return float(np.median(v))
    idx = int(np.searchsorted(cw, 0.5 * cw[-1]))
    return float(v[min(idx, len(v) - 1)])


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


# ----------------------------- mask refinement -----------------------------
def refine_mask(mask: np.ndarray, feather_px: int = 3) -> np.ndarray:
    m = (mask.astype(np.uint8)) * 255
    if m.max() == 0:
        return np.zeros(mask.shape, np.float32)
    k = max(3, (feather_px * 2) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n > 2:
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        m = np.where(lbl == biggest, np.uint8(255), np.uint8(0))
    dist_in = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    return np.clip(dist_in / max(feather_px, 1), 0.0, 1.0).astype(np.float32)


def _largest_cc_bin(mask: np.ndarray) -> np.ndarray:
    m = (mask.astype(np.uint8)) * 255
    if m.max() == 0:
        return np.zeros(mask.shape, bool)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n > 2:
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        m = np.where(lbl == biggest, np.uint8(255), np.uint8(0))
    return m > 0


def _boxf(img: np.ndarray, r: int) -> np.ndarray:
    return cv2.boxFilter(img, -1, (2 * r + 1, 2 * r + 1),
                         borderType=cv2.BORDER_REFLECT)


def guided_alpha(frame_bgr: np.ndarray, alpha: np.ndarray,
                 r: int = 6, eps: float = 1e-4) -> np.ndarray:
    g = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    p = alpha.astype(np.float32)
    mg, mp = _boxf(g, r), _boxf(p, r)
    cov = _boxf(g * p, r) - mg * mp
    var = _boxf(g * g, r) - mg * mg
    a = cov / (var + eps)
    b = mp - a * mg
    return np.clip(_boxf(a, r) * g + _boxf(b, r), 0.0, 1.0)


def refine_alpha(frame: np.ndarray, mask: np.ndarray, cfg: Config) -> np.ndarray:
    alpha = refine_mask(mask, cfg.mask_feather_px)
    if cfg.edge_refine:
        snap = guided_alpha(frame, alpha)
        snap[~mask.astype(bool)] = 0.0
        snap = cv2.GaussianBlur(snap, (3, 3), 0)
        alpha = np.maximum(snap, alpha * 0.5)
    return np.clip(alpha, 0.0, 1.0).astype(np.float32)


def glare_weight(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.float32)
    s = hsv[..., 1].astype(np.float32)
    glare = ((v > 205.0) & (s < 60.0)).astype(np.float32)
    return 1.0 - 0.9 * glare


# ----------------------------- stage 1: keyframes -----------------------------
def _thumb_bits(frame: np.ndarray) -> np.ndarray:
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    t = cv2.resize(g, (8, 8)).astype(np.float32)
    return (t > t.mean()).ravel()


def select_keyframes(path: Path, cfg: Config) -> list[tuple[int, np.ndarray]]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    interval = max(1, int(round(fps / cfg.samples_per_sec)))

    samples: list[tuple[int, float, np.ndarray]] = []
    idx = 0
    while True:
        if idx % interval == 0:
            ok, frame = cap.read()
            if not ok:
                break
            samples.append((idx, sharpness(frame), _thumb_bits(frame)))
        else:
            if not cap.grab():
                break
        idx += 1
    cap.release()
    if not samples:
        return []

    runs: list[tuple[int, float]] = []
    cur: Optional[tuple[int, float]] = None
    cur_bits: Optional[np.ndarray] = None
    for s_idx, sh, bits in samples:
        if cur is None or cur_bits is None:
            cur, cur_bits = (s_idx, sh), bits
        elif int(np.count_nonzero(bits != cur_bits)) <= cfg.keyframe_dedup_bits:
            if sh > cur[1]:
                cur, cur_bits = (s_idx, sh), bits
        else:
            runs.append(cur)
            cur, cur_bits = (s_idx, sh), bits
    if cur is not None:
        runs.append(cur)
    samples_dedup = runs if len(runs) >= 2 else [(i, s) for i, s, _ in samples]

    n = min(cfg.max_keyframes, len(samples_dedup))
    bounds = np.linspace(0, len(samples_dedup), n + 1).astype(int)
    picked = [max(samples_dedup[bounds[i]:bounds[i + 1]], key=lambda t: t[1])[0]
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


# ----------------------------- stage 2: segmentation (NO cross-fallback) -----------------------------
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

        if cfg.detector != "dino":
            raise ValueError("Only GroundingDINO detection is supported; AMG fallback is disabled")
        if not HAS_DINO:
            raise RuntimeError("GroundingDINO dependencies are missing; install transformers")
        dino_path = Path(cfg.dino_model)
        if not dino_path.exists():
            raise FileNotFoundError(f"GroundingDINO checkpoint directory not found: {dino_path}")
        self.dino_proc = AutoProcessor.from_pretrained(str(dino_path), local_files_only=True)
        self.dino = AutoModelForZeroShotObjectDetection.from_pretrained(
            str(dino_path), local_files_only=True).to(self.device).eval()
        self.mode = "dino"
        log.info("Detector: GroundingDINO + SAM2 (required; AMG disabled)")

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
        except TypeError:
            res = self.dino_proc.post_process_grounded_object_detection(
                out, inputs.input_ids,
                threshold=self.cfg.dino_box_thresh,
                text_threshold=self.cfg.dino_text_thresh,
                target_sizes=[rgb.shape[:2]])[0]
        return res["boxes"].cpu().numpy()

    def _nms(self, masks: list[np.ndarray]) -> list[np.ndarray]:
        keep: list[np.ndarray] = []
        for m in sorted(masks, key=lambda a: a.sum(), reverse=True):
            dup = False
            for k in keep:
                inter = np.logical_and(m, k).sum()
                if inter / max(min(m.sum(), k.sum()), 1) > self.cfg.dino_nms_iou:
                    dup = True
                    break
            if not dup:
                keep.append(m)
        return keep

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
        """GroundingDINO boxes feed SAM2; no detector fallback is used."""
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        lo, hi = self.cfg.min_mask_area_frac, self.cfg.max_mask_area_frac
        boxes = self._dino_boxes(rgb)
        if len(boxes) == 0:
            return []
        self.predictor.set_image(rgb)
        masks: list[np.ndarray] = []
        with inference_ctx(self.device):
            for box in boxes:
                m, scores, _ = self.predictor.predict(
                    box=box.reshape(-1), multimask_output=True)
                masks.append(m[int(np.argmax(scores))])
        masks = [mm for mm in masks if lo <= mm.mean() <= hi]
        return self._nms(masks)


# ----------------------------- stage 2b: video-predictor tracking (EXPLICIT) -----------------------------
def _track_via_video_predictor(cfg: Config, path: Path, frames: list,
                                seg: "Segmenter") -> list[tuple[int, int, np.ndarray, np.ndarray]]:
    from sam2.build_sam import build_sam2_video_predictor
    device = cfg.device or ("cuda" if torch.cuda.is_available() else "cpu")
    pred = build_sam2_video_predictor(cfg.sam_config, cfg.sam_checkpoint,
                                      device=device)
    state = pred.init_state(video_path=str(path))

    seed_fidx, seed_frame = frames[0]
    seeds = seg.segment(seed_frame)
    if not seeds:
        raise RuntimeError("no objects on the first keyframe to seed tracking")
    n_seeded = 0
    for i, m in enumerate(seeds):
        ys, xs = np.nonzero(m)
        if len(xs) < 50:
            continue
        box = np.array([xs.min(), ys.min(), xs.max(), ys.max()], np.float32)
        pred.add_new_points_or_box(state, i + 1, box=box, frame=int(seed_fidx))
        n_seeded += 1
    if n_seeded == 0:
        raise RuntimeError("no usable seed boxes")

    want = {fidx: fr for fidx, fr in frames}
    got: dict[int, list[tuple[int, np.ndarray]]] = defaultdict(list)
    with torch.inference_mode():
        for out_fidx, out_obj_ids, out_mask_logits in pred.propagate_in_video(state):
            if out_fidx not in want:
                continue
            frame = want[out_fidx]
            for i, oid in enumerate(out_obj_ids):
                m = np.squeeze((out_mask_logits[i] > 0).cpu().numpy())
                if m.ndim != 2:
                    continue
                if m.shape != frame.shape[:2]:
                    m = cv2.resize(m.astype(np.uint8), (frame.shape[1], frame.shape[0]),
                                   interpolation=cv2.INTER_NEAREST) > 0
                area = float(m.mean())
                if not (cfg.min_mask_area_frac * 0.5 <= area <= cfg.max_mask_area_frac):
                    continue
                got[int(out_fidx)].append((int(oid) - 1, m.astype(bool)))

    raw: list[tuple[int, int, np.ndarray, np.ndarray]] = []
    for fidx, frame in frames:
        for oid, mask in got.get(fidx, []):
            raw.append((oid, fidx, frame, mask))
    if not raw:
        raise RuntimeError("video predictor produced no usable masks")
    return raw


# ----------------------------- per-frame tracker (default) -----------------------------
class ObjectTracker:
    def __init__(self, iou_thresh: float = 0.20):
        self.iou_thresh = iou_thresh
        self.objs: list[dict] = []

    def update(self, masks: list[np.ndarray],
               frame_shape: tuple) -> list[tuple[int, np.ndarray]]:
        H, W = frame_shape[:2]
        diag = math.hypot(H, W)
        out: list[tuple[int, np.ndarray]] = []
        for m in masks:
            ys, xs = np.nonzero(m)
            if len(xs) == 0:
                continue
            cent = np.array([xs.mean(), ys.mean()], np.float64)
            area = float(m.sum())
            best, best_s = None, 0.0
            for o in self.objs:
                inter = np.logical_and(m, o["mask"]).sum()
                union = area + o["area"] - inter
                iou = inter / max(union, 1.0)
                d = float(np.linalg.norm(cent - o["cent"]) / diag)
                s = iou if iou > 0.10 else (0.6 * max(0.0, 1.0 - d / 0.25))
                if d < 0.18 and 0.5 < area / max(o["area"], 1e-6) < 2.0:
                    s = max(s, 0.22)
                if abs(math.log(max(area, 1.0) / max(o["area"], 1.0))) > 1.2:
                    s *= 0.1
                if s > best_s:
                    best_s, best = s, o
            if best is not None and best_s >= self.iou_thresh:
                oid = best["oid"]
                best.update(mask=m.copy(), cent=cent, area=area)
            else:
                oid = len(self.objs)
                self.objs.append({"mask": m.copy(), "cent": cent,
                                  "area": area, "oid": oid})
            out.append((oid, m))
        return out


# ----------------------------- stage 3: shape analysis -----------------------------
def order_quad(pts: np.ndarray) -> np.ndarray:
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


def _axis_rotation(mask: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    if len(xs) < 10:
        return np.eye(2, 3, dtype=np.float64)
    pts = np.stack([xs, ys], 1).astype(np.float64)
    mean = pts.mean(0)
    cov = (pts - mean).T @ (pts - mean) / len(pts)
    evals, evecs = np.linalg.eigh(cov)
    major = evecs[:, int(np.argmax(evals))]
    minor = evecs[:, int(np.argmin(evals))]
    vertical = np.array([0.0, 1.0])
    axis = major if abs(float(major @ vertical)) >= abs(float(minor @ vertical)) else minor
    theta = math.atan2(axis[0], axis[1])
    return cv2.getRotationMatrix2D((float(mean[0]), float(mean[1])),
                                   -math.degrees(theta), 1.0)


def _row_profile(rmask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    h = rmask.shape[0]
    lo = np.full(h, np.nan)
    hi = np.full(h, np.nan)
    touched = (rmask[:, 0] > 0) | (rmask[:, -1] > 0)
    for y in range(h):
        if touched[y]:
            continue
        xr = np.flatnonzero(rmask[y])
        if len(xr):
            lo[y], hi[y] = float(xr[0]), float(xr[-1])
    valid = np.flatnonzero(~np.isnan(lo))
    return lo, hi, valid, float(touched.mean())


def _cap_curve(rmask: np.ndarray) -> float:
    ys, xs = np.nonzero(rmask)
    if len(xs) < 100:
        return 0.0
    x0, x1 = int(xs.min()), int(xs.max())
    w = x1 - x0 + 1
    c0, c1 = int(x0 + 0.15 * w), int(x0 + 0.85 * w)
    top, bot = [], []
    for x in range(c0, c1 + 1):
        col = np.flatnonzero(rmask[:, x])
        if len(col):
            top.append((x, col[0]))
            bot.append((x, col[-1]))

    def curv(pts: list[tuple[int, int]], want_sign: float) -> float:
        if len(pts) < 25:
            return 0.0
        P = np.asarray(pts, np.float64)
        x, y = P[:, 0], P[:, 1]
        if y.max() - y.min() < 2.0:
            return 0.0
        p1 = np.polyfit(x, y, 1)
        r1 = float(np.sqrt(np.mean((y - np.polyval(p1, x)) ** 2)))
        p2 = np.polyfit(x, y, 2)
        r2 = float(np.sqrt(np.mean((y - np.polyval(p2, x)) ** 2)))
        if want_sign * p2[0] <= 0:
            return 0.0
        if r1 < 1e-6:
            return 0.0
        gain = clamp01((r1 - r2) / r1)
        sag = clamp01(r1 / (0.02 * w + 1e-6))
        return gain * sag

    return max(curv(top, +1.0), curv(bot, -1.0))


def detect_fold(frame: np.ndarray, mask: np.ndarray, cfg: Config) -> Optional[int]:
    ys, xs = np.nonzero(mask)
    if len(xs) < 800:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    w = x1 - x0
    rows = y1 - y0 + 1
    if w < 3 * cfg.min_face_px or rows < cfg.min_face_px:
        return None
    g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, 3))
    inside = mask.astype(bool)
    energy = np.where(inside, gx, 0.0).sum(axis=0)
    a, b = x0 + int(0.15 * w), x1 - int(0.15 * w)
    if b - a < 8:
        return None
    seg = _smooth1d(energy[a:b + 1], max(3, (w // 60) | 1))
    med = float(np.median(seg)) + 1e-3
    pk = int(np.argmax(seg))
    if float(seg[pk]) < max(3.0 * med, med + 6.0):
        return None
    xc = a + pk
    lo_t, hi_t = max(0, pk - int(0.06 * w)), min(len(seg), pk + int(0.06 * w) + 1)
    seg2 = seg.copy()
    seg2[lo_t:hi_t] = 0.0
    if seg2.size and float(seg2.max()) > 0.75 * float(seg[pk]):
        return None
    s0, s1 = max(0, xc - 2), min(gx.shape[1], xc + 3)
    col_grad = gx[:, s0:s1].max(axis=1)
    col_in = inside[:, s0:s1].any(axis=1)
    support = float(np.count_nonzero((col_grad > 12) & col_in)) / max(rows, 1)
    if support < cfg.fold_min_support:
        return None
    l0, l1 = max(0, xc - 10), max(0, xc - 3)
    r0, r1 = min(g.shape[1], xc + 3), min(g.shape[1], xc + 10)
    if l1 <= l0 or r1 <= r0:
        return None
    gl = g[y0:y1 + 1, l0:l1][inside[y0:y1 + 1, l0:l1]]
    gr = g[y0:y1 + 1, r0:r1][inside[y0:y1 + 1, r0:r1]]
    if gl.size < 30 or gr.size < 30:
        return None
    if abs(float(gl.mean()) - float(gr.mean())) < 5.0:
        return None
    return xc


def silhouette_features(frame: np.ndarray, mask: np.ndarray, cfg: Config) -> dict:
    feats = {"quad_conf": 0.0, "hex_conf": 0.0, "cap_curve": 0.0, "rounding": 1.0,
             "taper_term": 0.0, "width_cv": 1.0, "width_norm": 0.0,
             "clipped": True, "fold": 0.0, "fold_x": None}
    mclean = _largest_cc_bin(mask)
    m8 = mclean.astype(np.uint8)
    contours, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return feats
    c = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(c, True)
    area_c = max(cv2.contourArea(c), 1.0)

    M = _axis_rotation(mclean)
    h, w = mclean.shape
    rmask = (cv2.warpAffine(m8.astype(np.float32), M, (w, h),
                            flags=cv2.INTER_NEAREST, borderValue=0.0) > 0.5
             ).astype(np.uint8)
    lo, hi, valid, touched_frac = _row_profile(rmask)
    feats["clipped"] = touched_frac > 0.15

    cap = _cap_curve(rmask)
    feats["cap_curve"] = cap

    if len(valid) >= 30:
        widths = (hi - lo + 1.0)[valid]
        n4 = max(1, len(valid) // 4)
        mid = valid[n4:len(valid) - n4] if len(valid) - n4 > n4 else valid
        wm = (hi - lo + 1.0)[mid]
        feats["width_cv"] = float(np.std(wm) / max(float(np.mean(wm)), 1e-6))
        height = float(valid[-1] - valid[0] + 1)
        feats["width_norm"] = float(2.0 * float(np.median(wm)) / max(height, 1.0))
        yv = valid.astype(np.float64)
        if np.ptp(yv) > 1:
            sl = float(np.polyfit(yv, widths, 1)[0])
            feats["taper_term"] = clamp01(
                (abs(sl) * float(yv[-1] - yv[0] + 1)
                 / max(float(widths.mean()), 1.0) - 0.12) / 0.20)

    best_quad, best_fill4, best_hex = 0.0, 0.85, 0.0
    for eps in cfg.quad_eps_levels:
        ap = cv2.approxPolyDP(c, eps * peri, True)
        n_ap = len(ap)
        fill = cv2.contourArea(ap) / area_c
        if n_ap == 4:
            pts4 = order_quad(ap.reshape(4, 2).astype(np.float32))
            ang = clamp01(1.0 - quad_defect(pts4) / cfg.distortion_thresh_deg)
            fillt = clamp01((fill - 0.94) / 0.05)
            q = ang * fillt
            if q >= best_quad:
                best_quad, best_fill4 = q, fill
        elif 5 <= n_ap <= 7 and cap < 0.35 and fill > 0.88:
            best_hex = max(best_hex, clamp01((fill - 0.88) / 0.08))
    feats["quad_conf"] = best_quad
    feats["hex_conf"] = best_hex
    feats["rounding"] = clamp01((0.97 - best_fill4) / 0.04)

    fx = detect_fold(frame, mclean, cfg)
    if fx is not None:
        feats["fold"] = 1.0
        feats["fold_x"] = fx
    return feats


def _shape_scores(feats: dict) -> tuple[float, float]:
    cap = feats["cap_curve"]
    box = (0.50 * feats["quad_conf"] + 0.25 * feats["hex_conf"]
           + 0.15 * (1.0 - cap) + 0.10 * feats["fold"])
    cyl = (0.45 * cap
           + 0.20 * feats["rounding"] * (0.25 + 0.75 * cap)
           + 0.15 * feats["taper_term"])
    return cyl, box


def _mask_thumb(frame: np.ndarray, mask: np.ndarray, size: int = 24) -> Optional[np.ndarray]:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    crop = frame[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
    m = mask[y0:y1 + 1, x0:x1 + 1].astype(np.float32)
    out = crop * m[..., None]
    out = cv2.resize(out, (size, size))
    return out / 255.0


def detect_motion(recs: list[dict], thresh: float) -> bool:
    if len(recs) < 2:
        return False
    picks = sorted({0, len(recs) // 2, len(recs) - 1})
    thumbs = [_mask_thumb(recs[i]["frame"], recs[i]["mask"]) for i in picks]
    thumbs = [t for t in thumbs if t is not None]
    if len(thumbs) < 2:
        return False
    diffs = [float(np.mean(np.abs(thumbs[i] - thumbs[j])))
             for i in range(len(thumbs)) for j in range(i + 1, len(thumbs))]
    return max(diffs) > thresh


# ----------------------------- pairwise rotation estimation -----------------------------
def pair_rotation(cfg: Config, A: np.ndarray, ma: np.ndarray,
                  B: np.ndarray, mb: np.ndarray) -> Optional[tuple[float, float]]:
    if A is None or B is None or ma is None or mb is None:
        return None
    ga = cv2.cvtColor(A, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(B, cv2.COLOR_BGR2GRAY)

    def cyl_params(m):
        mm = _largest_cc_bin(m)
        ys, xs = np.nonzero(mm)
        if len(xs) < 100:
            return None
        cx = float(xs.mean())
        m8 = mm.astype(np.uint8)
        h = m8.shape[0]
        lo, hi = np.full(h, np.nan), np.full(h, np.nan)
        for y in range(h):
            xr = np.flatnonzero(m8[y])
            if len(xr):
                lo[y], hi[y] = float(xr[0]), float(xr[-1])
        valid = np.flatnonzero(~np.isnan(lo))
        if len(valid) < 20:
            return None
        n4 = max(1, len(valid) // 4)
        mid = valid[n4:len(valid) - n4]
        r = float(np.median((hi - lo + 1.0)[mid] / 2.0))
        if r < 12:
            return None
        return cx, r

    pa, pb = cyl_params(ma), cyl_params(mb)
    if pa is None or pb is None:
        return None
    cxa, ra = pa
    cxb, rb = pb
    r = 0.5 * (ra + rb)
    H = ga.shape[0]

    xa_l, xb_l = [], []
    try:
        orb = cv2.ORB_create(3000, scaleFactor=1.2, nlevels=8)
        ka, da = orb.detectAndCompute(ga, None)
        kb, db = orb.detectAndCompute(gb, None)
        if da is not None and db is not None and len(ka) >= 10 and len(kb) >= 10:
            bf = cv2.BFMatcher(cv2.NORM_HAMMING)
            for pair in bf.knnMatch(da, db, k=2):
                if len(pair) != 2:
                    continue
                m = pair[0]
                if m.distance >= 0.8 * pair[1].distance:
                    continue
                p, q = ka[m.queryIdx].pt, kb[m.trainIdx].pt
                if abs(p[1] - q[1]) > 0.06 * H:
                    continue
                if abs(p[0] - cxa) > 0.85 * r or abs(q[0] - cxb) > 0.85 * r:
                    continue
                xa_l.append(p[0])
                xb_l.append(q[0])
    except cv2.error:
        pass

    def dtheta_from(xa, xb):
        sa = np.clip((xa - cxa) / r, -0.98, 0.98)
        sb = np.clip((xb - cxb) / r, -0.98, 0.98)
        d = np.arcsin(sb) - np.arcsin(sa)
        w = np.sqrt(np.maximum(1.0 - sa ** 2, 1e-3))
        med = _wmedian(d, w)
        mad = float(np.median(np.abs(d - med))) + 1e-4
        sigma = 1.4826 * mad / math.sqrt(max(len(d), 1))
        return float(med), float(max(sigma, 1e-3))

    if len(xa_l) >= cfg.pair_min_matches:
        return dtheta_from(np.array(xa_l), np.array(xb_l))

    try:
        sc = 0.5
        sa_ = cv2.resize(ga, None, fx=sc, fy=sc)
        sb_ = cv2.resize(gb, None, fx=sc, fy=sc)
        flow = cv2.calcOpticalFlowFarneback(sa_, sb_, None, 0.5, 3, 25, 3, 7, 1.2, 0)
        mha = cv2.resize(ma.astype(np.float32), None, fx=sc, fy=sc) > 0.5
        mhb = cv2.resize(mb.astype(np.float32), None, fx=sc, fy=sc) > 0.5
        ys, xs = np.nonzero(mha & mhb)
        x = xs.astype(np.float64) / sc
        u = flow[ys, xs, 0].astype(np.float64) / sc
        xb = x + u
        sel = (np.abs(x - cxa) < 0.85 * r) & (np.abs(xb - cxb) < 0.9 * r)
        if int(sel.sum()) >= 200:
            if int(sel.sum()) > 4000:
                idx = np.linspace(0, int(sel.sum()) - 1, 4000).astype(int)
                x, xb = x[sel][idx], xb[sel][idx]
            else:
                x, xb = x[sel], xb[sel]
            return dtheta_from(x, xb)
    except cv2.error:
        pass
    return None


def estimate_rotation_total(cfg: Config, frame_map: dict,
                            seq: list[tuple[int, np.ndarray]]
                            ) -> tuple[Optional[float], int, int]:
    if len(seq) < 3:
        return None, 0, 0
    pairs, valid = 0, []
    for (fa, ma), (fb, mb) in zip(seq, seq[1:]):
        A, B = frame_map.get(fa), frame_map.get(fb)
        if A is None or B is None:
            continue
        pairs += 1
        res = pair_rotation(cfg, A, ma, B, mb)
        if res is not None:
            valid.append(res[0])
    if len(valid) < 2:
        return None, len(valid), pairs
    return float(sum(valid)), len(valid), pairs


# ----------------------------- CLIP shape head -----------------------------
class ShapeClassifier:
    TEMPLATES = {
        "cuboid": [
            "a photo of a cardboard box", "a photo of a product box",
            "a photo of a cereal box", "a photo of a paperboard carton",
            "a photo of a rectangular package",
        ],
        "cylinder": [
            "a photo of a beverage can", "a photo of a tin can",
            "a photo of a soup can", "a photo of a cylindrical container",
            "a photo of a bottle", "a photo of a glass jar",
        ],
        "irregular": [
            "a photo of a snack pouch", "a photo of a stand-up pouch",
            "a photo of a plastic bag", "a photo of a crumpled package",
            "a photo of an irregularly shaped object",
        ],
    }

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.device = cfg.device or ("cuda" if torch.cuda.is_available() else "cpu")
        self._loaded = False
        self._failed = False
        self.proc = self.model = None
        self.cls_index: list[str] = []
        self.text_ids = None
        self.text_am = None
        self.status = "not loaded"

    @staticmethod
    def _as_tensor(x, keys) -> "torch.Tensor":
        if torch.is_tensor(x):
            return x
        for k in keys:
            v = getattr(x, k, None)
            if torch.is_tensor(v):
                return v
        raise TypeError(f"unexpected CLIP output type: {type(x)}")

    def _load(self) -> bool:
        if self._loaded or self._failed:
            return self._loaded
        if not (HAS_CLIP and HAS_TORCH):
            self.status = "unavailable: transformers/CLIP import failed"
            self._failed = True
            return False
        try:
            self.proc = CLIPProcessor.from_pretrained(
                self.cfg.clip_model, local_files_only=True)
            self.model = CLIPModel.from_pretrained(
                self.cfg.clip_model, local_files_only=True).to(self.device).eval()
            texts: list[str] = []
            for shape in ("cuboid", "cylinder", "irregular"):
                for t in self.TEMPLATES[shape]:
                    texts.append(t)
                    self.cls_index.append(shape)
            tinp = self.proc(text=texts, return_tensors="pt", padding=True).to(self.device)
            self.text_ids = tinp["input_ids"]
            self.text_am = tinp["attention_mask"]
            self._logits(np.zeros((64, 64, 3), np.uint8))
            self._loaded = True
            self.status = "ok"
            log.info("CLIP shape head loaded (%s) on %s",
                     self.cfg.clip_model, self.device)
        except Exception as e:
            self.status = f"unavailable: {e}"
            log.warning("CLIP unavailable (%s); shape falls back to geometry/silhouette.", e)
            self._failed = True
        return self._loaded

    def _logits(self, rgb: np.ndarray) -> "torch.Tensor":
        inp = self.proc(images=[rgb], return_tensors="pt").to(self.device)
        with inference_ctx(self.device):
            try:
                out = self.model(input_ids=self.text_ids,
                                 attention_mask=self.text_am,
                                 pixel_values=inp["pixel_values"])
                lg = getattr(out, "logits_per_image", None)
                if torch.is_tensor(lg):
                    return lg[0].float()
            except Exception:
                pass
            imf = self._as_tensor(
                self.model.get_image_features(pixel_values=inp["pixel_values"]),
                ("image_embeds", "pooler_output"))
            tf = self._as_tensor(
                self.model.get_text_features(input_ids=self.text_ids,
                                             attention_mask=self.text_am),
                ("text_embeds", "pooler_output"))
            imf = imf / imf.norm(dim=-1, keepdim=True).clamp(min=1e-6)
            tf = tf / tf.norm(dim=-1, keepdim=True).clamp(min=1e-6)
            scale = 100.0
            ls = getattr(self.model, "logit_scale", None)
            if torch.is_tensor(ls):
                try:
                    scale = float(ls.exp().detach().cpu())
                except Exception:
                    scale = 100.0
            return (imf @ tf.T).float() * scale

    def classify(self, crops: list[np.ndarray]) -> Optional[dict]:
        if not crops or not self._load():
            return None
        try:
            per = []
            for crop in crops:
                rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                lg = self._logits(rgb)
                per.append(torch.softmax(lg, dim=-1).cpu().numpy())
            P = np.mean(np.stack(per), axis=0)
            out = {"cuboid": 0.0, "cylinder": 0.0, "irregular": 0.0}
            for p, cls in zip(P, self.cls_index):
                out[cls] += float(p)
            return out
        except Exception as e:
            self.status = f"error during classify: {e}"
            log.warning("CLIP classify failed (%s).", e)
            return None


def _clip_crops(recs: list[dict], k: int) -> list[np.ndarray]:
    if not recs:
        return []
    idxs = sorted(set(np.linspace(0, len(recs) - 1, min(k, len(recs))).astype(int).tolist()))
    crops: list[np.ndarray] = []
    for i in idxs:
        fr, mk = recs[i]["frame"], recs[i]["mask"]
        m = _largest_cc_bin(mk)
        ys, xs = np.nonzero(m)
        if len(xs) == 0:
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        pad = int(0.08 * max(x1 - x0, y1 - y0)) + 4
        xa, xb = max(0, x0 - pad), min(fr.shape[1], x1 + pad + 1)
        ya, yb = max(0, y0 - pad), min(fr.shape[0], y1 + pad + 1)
        crop = fr[ya:yb, xa:xb].astype(np.float32)
        mm = m[ya:yb, xa:xb].astype(np.float32)
        comp = crop * mm[..., None] + 255.0 * (1.0 - mm[..., None])
        crops.append(comp.astype(np.uint8))
    return crops


def decide_shape(recs: list[dict], cfg: Config,
                 clip_probs: Optional[dict] = None,
                 rot_total: Optional[float] = None,
                 rot_valid: int = 0, rot_pairs: int = 0) -> tuple[str, dict]:
    """Cascade: (1) width-ratio geometry -- cylinder verdict additionally
    requires MEASURED rotation >= rotation_min_total; (2) CLIP; (3) silhouette."""
    if cfg.shape_mode != "auto":
        return cfg.shape_mode, {"forced": cfg.shape_mode}

    agg_cyl = agg_box = wsum = 0.0
    for r in recs:
        w = float(r["mask"].mean())
        cyl, box = _shape_scores(r["feats"])
        agg_cyl += cyl * w
        agg_box += box * w
        wsum += w
    if wsum > 0:
        agg_cyl /= wsum
        agg_box /= wsum

    vote = {"cylinder_score": round(agg_cyl, 3), "cuboid_score": round(agg_box, 3),
            "n_frames": len(recs)}
    if rot_total is not None:
        vote["rotation_total_deg"] = round(math.degrees(rot_total), 1)
        vote["rotation_pairs"] = f"{rot_valid}/{rot_pairs}"

    geo: Optional[str] = None
    wn = np.array([r["feats"]["width_norm"] for r in recs
                   if (not r["feats"]["clipped"]) and r["feats"]["width_norm"] > 1e-3],
                  np.float64)
    if len(wn) >= cfg.xframe_min_frames:
        p_lo, p_hi = np.percentile(wn, [8, 92])
        wr = float(p_hi / max(p_lo, 1e-6))
        moving = detect_motion(recs, cfg.motion_thresh)
        vote.update(width_ratio=round(wr, 3), moving=moving)
        if moving or wr > cfg.width_ratio_cyl:
            if wr > cfg.width_ratio_box:
                geo = "cuboid"
            elif wr < cfg.width_ratio_cyl:
                if rot_total is not None:
                    if abs(rot_total) >= cfg.rotation_min_total:
                        geo = "cylinder"
                        vote["corroboration"] = (
                            f"measured rotation {math.degrees(rot_total):.0f} deg "
                            "with flat width")
                    else:
                        vote["geo_withheld"] = (
                            f"flat width but measured rotation only "
                            f"{math.degrees(rot_total):.0f} deg -- object not "
                            "yaw-rotating; width test not applicable")
                else:
                    cap_mean = float(np.mean([r["feats"]["cap_curve"] for r in recs]))
                    clip_cyl = bool(clip_probs and clip_probs.get("cylinder", 0.0)
                                    >= cfg.clip_min_conf)
                    vote["cap_curve_mean"] = round(cap_mean, 3)
                    if cap_mean >= cfg.cyl_cap_min:
                        geo = "cylinder"
                        vote["corroboration"] = "curved caps (rotation unmeasurable)"
                    elif clip_cyl:
                        geo = "cylinder"
                        vote["corroboration"] = "clip agreement (rotation unmeasurable)"
                    else:
                        vote["geo_withheld"] = (
                            "flat width; rotation unmeasurable, no corroboration")
            if geo is not None:
                agg_cyl += 0.55 * clamp01((cfg.width_ratio_cyl - wr) / 0.07)
                agg_box += 0.55 * clamp01((wr - cfg.width_ratio_box) / 0.14)
        vote["geo_verdict"] = geo

    clip_shape: Optional[str] = None
    if clip_probs:
        vote["clip"] = {k: round(v, 3) for k, v in clip_probs.items()}
        ranked = sorted(clip_probs.items(), key=lambda kv: -kv[1])
        if ranked[0][1] >= cfg.clip_min_conf and \
                ranked[0][1] - ranked[1][1] >= cfg.clip_margin:
            clip_shape = ranked[0][0]
            vote["clip_verdict"] = clip_shape

    if geo is not None:
        shape, why = geo, "width-ratio geometry"
    elif clip_shape is not None:
        shape, why = clip_shape, "clip"
    else:
        if max(agg_cyl, agg_box) < cfg.shape_vote_min_score:
            shape, why = "irregular", "low evidence"
        else:
            margin = abs(agg_cyl - agg_box) / (agg_cyl + agg_box + 1e-6)
            vote["margin"] = round(float(margin), 3)
            if margin < cfg.shape_margin:
                shape, why = "irregular", "ambiguous silhouette"
            else:
                shape = "cylinder" if agg_cyl >= agg_box else "cuboid"
                why = "silhouette cues"
    vote["decision"] = shape
    vote["decision_source"] = why
    return shape, vote


# ----------------------------- stage 4a: cuboid -----------------------------
def try_quad(frame: np.ndarray, mask: np.ndarray, cfg: Config,
             frame_idx: int) -> Optional[Candidate]:
    contours, _ = cv2.findContours(mask.astype(np.uint8),
                                   cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(c, True)
    alpha = refine_alpha(frame, mask, cfg)
    rgba = np.dstack([frame, (alpha * 255).astype(np.uint8)])

    for eps in cfg.quad_eps_levels:
        approx = cv2.approxPolyDP(c, eps * peri, True)
        if len(approx) != 4:
            continue
        pts = order_quad(approx.reshape(4, 2).astype(np.float32))
        defect = quad_defect(pts)
        if defect > cfg.distortion_thresh_deg:
            continue
        fill = cv2.contourArea(approx) / max(cv2.contourArea(c), 1)
        if fill < cfg.quad_min_fill:
            continue

        cen = pts.mean(axis=0)
        inset = pts + cfg.quad_inset * (cen - pts)
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
        ang = clamp01(1.0 - defect / max(cfg.distortion_thresh_deg, 1e-6))
        fillt = clamp01((fill - 0.94) / 0.05)
        return Candidate(out, "cuboid", frame_idx, sharpness(out), float(mask.mean()),
                         meta={"defect_deg": round(defect, 1), "fill": round(fill, 3),
                               "cuboid_conf": round(ang * fillt, 3)})
    return None


def _hex_quad_candidate(rgba: np.ndarray, pts: np.ndarray, cfg: Config,
                        frame_idx: int, area_frac: float
                        ) -> tuple[Optional[Candidate], float]:
    pts = order_quad(pts.astype(np.float32))
    defect = quad_defect(pts)
    if defect > cfg.distortion_thresh_deg:
        return None, 0.0
    cen = pts.mean(axis=0)
    inset = pts + cfg.quad_inset * (cen - pts)
    tl, tr, br, bl = inset
    w = max(int(round(np.linalg.norm(br - bl))), int(round(np.linalg.norm(tr - tl))))
    h = max(int(round(np.linalg.norm(tr - br))), int(round(np.linalg.norm(tl - bl))))
    if w < cfg.min_face_px or h < cfg.min_face_px:
        return None, 0.0
    scale = min(6.0, max(1.0, cfg.out_min_side_px / max(1, min(w, h))))
    W, H = int(w * scale), int(h * scale)
    dst = np.array([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], np.float32)
    M = cv2.getPerspectiveTransform(inset.astype(np.float32), dst)
    out = cv2.warpPerspective(rgba, M, (W, H), flags=cv2.INTER_CUBIC,
                              borderValue=(255, 255, 255, 0))
    conf = clamp01(1.0 - defect / max(cfg.distortion_thresh_deg, 1e-6))
    return (Candidate(out, "cuboid", frame_idx, sharpness(out), area_frac,
                      meta={"defect_deg": round(defect, 1), "hex_conf": round(conf, 3)}),
            conf)


def hex_split(frame: np.ndarray, mask: np.ndarray, cfg: Config,
              frame_idx: int) -> list[Candidate]:
    mclean = _largest_cc_bin(mask)
    m8 = mclean.astype(np.uint8)
    contours, _ = cv2.findContours(m8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    c = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(c, True)
    area_c = max(cv2.contourArea(c), 1.0)
    if peri <= 0:
        return []
    alpha = refine_alpha(frame, mask, cfg)
    rgba = np.dstack([frame, (alpha * 255).astype(np.uint8)])
    area_frac = float(np.asarray(mask, bool).mean())

    best_cands: list[Candidate] = []
    best_score = 0.0
    for eps in cfg.quad_eps_levels:
        ap = cv2.approxPolyDP(c, eps * peri, True)
        if len(ap) != 6:
            continue
        P = ap.reshape(6, 2).astype(np.float32)
        for i in range(3):
            j = i + 3
            q1 = P[[i, (i + 1) % 6, (i + 2) % 6, j]]
            q2 = np.array([P[j], P[(j + 1) % 6], P[(j + 2) % 6], P[i]], np.float32)
            cands_q: list[Candidate] = []
            confs: list[float] = []
            for q in (q1, q2):
                cand, conf = _hex_quad_candidate(rgba, q, cfg, frame_idx, area_frac)
                if cand is not None:
                    cands_q.append(cand)
                    confs.append(conf)
            if len(cands_q) == 2:
                fill = (_poly_area(q1) + _poly_area(q2)) / area_c
                if fill < cfg.hex_min_fill:
                    continue
                score = min(confs) + 0.15
            elif len(cands_q) == 1:
                score = 0.7 * confs[0]
            else:
                continue
            if score > best_score:
                best_score, best_cands = score, list(cands_q)
    if best_cands and best_score >= cfg.hex_min_conf:
        for b in best_cands:
            b.meta["hex_split"] = True
        return best_cands
    return []


def box_candidates(frame: np.ndarray, mask: np.ndarray, cfg: Config,
                   frame_idx: int, fold_x: Optional[int] = None) -> list[Candidate]:
    mask_b = mask.astype(bool)
    q = try_quad(frame, mask_b, cfg, frame_idx)
    if q is not None:
        return [q]
    if cfg.split_faces:
        if fold_x is not None:
            left = mask_b.copy()
            left[:, fold_x + 1:] = False
            right = mask_b.copy()
            right[:, :fold_x] = False
            out: list[Candidate] = []
            for side in (left, right):
                if int(side.sum()) > cfg.min_face_px ** 2:
                    qq = try_quad(frame, side, cfg, frame_idx)
                    if qq is not None:
                        qq.meta["face_split"] = True
                        out.append(qq)
            if out:
                return out
        hs = hex_split(frame, mask_b, cfg, frame_idx)
        if hs:
            return hs
    return []


# ----------------------------- stage 4b: cylinder -----------------------------
def unwrap_cylinder(frame: np.ndarray, mask: np.ndarray, cfg: Config,
                    frame_idx: int) -> Optional[Candidate]:
    mask = _largest_cc_bin(mask)
    ys, xs = np.nonzero(mask)
    if len(xs) < 500:
        return None
    M = _axis_rotation(mask)
    h, w = mask.shape
    rimg = cv2.warpAffine(frame, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderValue=(255, 255, 255))
    alpha = refine_alpha(frame, mask, cfg)
    ralpha = cv2.warpAffine(alpha, M, (w, h), flags=cv2.INTER_LINEAR,
                            borderValue=0.0).astype(np.float32)
    rmask = (ralpha > 0.5).astype(np.uint8)

    lo, hi, valid, _ = _row_profile(rmask)
    if len(valid) < 60:
        return None
    widths = (hi - lo + 1.0)[valid]
    n4 = max(1, len(valid) // 4)
    mid = valid[n4: len(valid) - n4]
    if len(mid) < 10:
        mid = valid
    r_med = float(np.median((hi - lo + 1.0)[mid] / 2.0))
    if r_med < 12:
        return None

    r_row = (hi - lo + 1.0) / 2.0
    cx_row = (lo + hi) / 2.0
    keep = valid[(r_row[valid] >= cfg.cyl_trim_lo * r_med) &
                 (r_row[valid] <= cfg.cyl_trim_hi * r_med)]
    band = keep if len(keep) >= cfg.cyl_min_label_h else valid
    if len(band) < 2:
        return None
    d = np.diff(band)
    breaks = np.flatnonzero(d > 1)
    starts = np.concatenate([[band[0]], band[breaks + 1]])
    ends = np.concatenate([band[breaks], [band[-1]]])
    i = int(np.argmax(ends - starts))
    y0, y1 = int(starts[i]), int(ends[i]) + 1
    if y1 - y0 < cfg.cyl_min_label_h:
        return None

    rows = np.arange(y0, y1, dtype=np.float32)
    r_s = _smooth1d(r_row[y0:y1], 9).astype(np.float32)
    cx_s = _smooth1d(cx_row[y0:y1], 9).astype(np.float32)

    if r_med > cfg.cyl_max_radius_px:
        s = cfg.cyl_max_radius_px / r_med
        rimg = cv2.resize(rimg, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        ralpha = cv2.resize(ralpha, None, fx=s, fy=s, interpolation=cv2.INTER_LINEAR)
        rows, r_s, cx_s, r_med = rows * s, r_s * s, cx_s * s, r_med * s

    n_col = max(48, int(math.pi * r_med))
    th = np.linspace(-math.pi / 2.0, math.pi / 2.0, n_col).astype(np.float32)
    map_x = (cx_s[:, None] + r_s[:, None] * np.sin(th)[None, :]).astype(np.float32)
    map_y = np.repeat(rows[:, None], n_col, axis=1).astype(np.float32)
    strip = cv2.remap(rimg, map_x, map_y, cv2.INTER_CUBIC,
                      borderMode=cv2.BORDER_REPLICATE)
    a_map = cv2.remap(ralpha, map_x, map_y, cv2.INTER_LINEAR,
                      borderMode=cv2.BORDER_CONSTANT, borderValue=0.0)
    cosw = np.clip(np.cos(th), 0.0, 1.0).astype(np.float32)
    wgt = (cosw[None, :] * a_map).astype(np.float32)

    band_w = r_row[y0:y1]
    width_cv = float(np.std(band_w) / max(np.mean(band_w), 1e-6))
    conf = clamp01(1.0 - width_cv / max(cfg.cyl_band_tol, 1e-6))
    conf *= clamp01(len(band) / max(len(valid), 1) / 0.3)
    return Candidate(strip, "cyl", frame_idx, sharpness(strip), float(mask.mean()),
                     weight=wgt,
                     meta={"r_px": round(r_med, 1), "cyl_conf": round(conf, 3),
                           "tapered": bool(np.any(np.abs(r_s - r_s[0]) > 0.1 * r_med))})


# ----------------------------- stage 4c: irregular -----------------------------
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
    alpha = refine_alpha(frame, mask, cfg)
    rgba = np.dstack([frame, (alpha * 255).astype(np.uint8)])[ya:yb, xa:xb]
    return Candidate(rgba, "irregular", frame_idx, sharpness(rgba),
                     float(mask.mean()), meta={})


# ----------------------------- stage 5: rotation mosaic (ONE per cylinder) -----------------------------
class MosaicError(RuntimeError):
    pass


class RotationMosaic:
    """360° cylinder panorama assembled as a BEST-VIEW canvas (v9).

    v8's nanmedian fusion smeared text into mush (output sharpness 8 vs
    25-37 for the input strips): pixel-scale misalignment across ~29 views
    makes every output pixel the median of 29 different glyph phases.
    Instead, every output texel is OWNED by the strip that views that
    azimuth most frontally (its weight map = cos x alpha x glare-free is
    exactly that quality measure), so each texel keeps single-exposure
    sharpness. Strips are aligned to the SHARP canvas (never a blurred
    one) with a bounded search (+-8 px @ 1 px, +-4% scale). Seams
    crossfade over a narrow quality band."""

    def __init__(self, cfg: Config, frame_map: dict, mask_by_frame: dict):
        self.cfg = cfg
        self.frame_map = frame_map
        self.mask_by_frame = mask_by_frame
        self.strips: list[tuple[np.ndarray, np.ndarray, int]] = []
        self.dtheta: list[Optional[float]] = []
        self.sig: list[float] = []
        self.warnings: list[str] = []

    def add(self, strip: np.ndarray, wgt: np.ndarray, fidx: int) -> None:
        if self.strips:
            H = self.strips[0][0].shape[0]
            if strip.shape[0] != H:
                f = H / strip.shape[0]
                strip = cv2.resize(strip, (max(8, int(round(strip.shape[1] * f))), H),
                                   interpolation=cv2.INTER_AREA)
                wgt = cv2.resize(wgt, (strip.shape[1], H), interpolation=cv2.INTER_AREA)
        if self.cfg.glare_weight:
            wgt = wgt * glare_weight(strip)
        wgt = wgt.astype(np.float32)
        if self.strips:
            res = pair_rotation(self.cfg,
                                self.frame_map.get(self.strips[-1][2]),
                                self.mask_by_frame.get(self.strips[-1][2]),
                                self.frame_map.get(fidx),
                                self.mask_by_frame.get(fidx))
            if res is None:
                self.warnings.append(f"rotation estimate failed before frame {fidx}")
                self.dtheta.append(None)
                self.sig.append(1e9)
            else:
                self.dtheta.append(res[0])
                self.sig.append(res[1])
        self.strips.append((strip, wgt, fidx))

    def _segments(self, x0: float, w: int, wrap: bool, W: int) -> list[tuple[int, int, int]]:
        if wrap:
            x = int(x0) % W
            if x + w <= W:
                return [(x, 0, w)]
            return [(x, 0, W - x), (0, W - x, w - (W - x))]
        xc = int(max(0, min(x0, W - w)))
        return [(xc, 0, w)]

    def _blit_best(self, P: np.ndarray, S: np.ndarray, qp: np.ndarray,
                   qs: np.ndarray, st: np.ndarray, wg: np.ndarray,
                   x0: float, wrap: bool, W: int) -> None:
        """Insert one strip: texels where its quality beats the current
        primary promote (old primary -> runner-up); texels beating only the
        runner-up replace it. Invariant: qp >= qs everywhere."""
        w = st.shape[1]
        for (sx, so, sl) in self._segments(x0, w, wrap, W):
            if sl <= 0:
                continue
            newq = wg[:, so:so + sl].astype(np.float32)
            m = newq > 0.05
            if not m.any():
                continue
            new = st[:, so:so + sl].astype(np.float32)
            p = P[:, sx:sx + sl]
            s_ = S[:, sx:sx + sl]
            qps = qp[:, sx:sx + sl]
            qss = qs[:, sx:sx + sl]
            take_p = m & (newq > qps)
            s_[take_p] = p[take_p]          # demote old primary
            qss[take_p] = qps[take_p]
            p[take_p] = new[take_p]         # new primary
            qps[take_p] = newq[take_p]
            take_s = m & (~take_p) & (newq > qss)
            s_[take_s] = new[take_s]
            qss[take_s] = newq[take_s]

        def _score_sharp(self, st: np.ndarray, wg: np.ndarray, x0: float,
                     P: np.ndarray, qp: np.ndarray, wrap: bool, W: int) -> float:
            """NCC of a candidate placement against the SHARP canvas, restricted
            to high-quality regions of both (wg > 0.5 and canvas quality > 0.5).
            The canvas is 3-channel; scoring runs on its 2-D luminance so the
            correlation stays a scalar."""
            w = st.shape[1]
            if W < w:
                return -1.0
            gy = cv2.cvtColor(st, cv2.COLOR_BGR2GRAY).astype(np.float32)
            a_l, b_l = [], []
            for (sx, so, sl) in self._segments(x0, w, wrap, W):
                if sl <= 0:
                    continue
                m = (wg[:, so:so + sl] > 0.5) & (qp[:, sx:sx + sl] > 0.5)
                if m.any():
                    a_l.append(gy[:, so:so + sl][m])
                    seg = P[:, sx:sx + sl]                       # (H, sl, 3)
                    pg = (seg[..., 0] * 0.114                    # B
                        + seg[..., 1] * 0.587                  # G
                        + seg[..., 2] * 0.299)                 # R -> (H, sl)
                    b_l.append(pg[m])
            if not a_l:
                return -1.0
            a = np.concatenate(a_l)
            b = np.concatenate(b_l)
            if len(a) < 400:
                return -1.0
            if len(a) > 150000:
                idx = np.random.default_rng(0).choice(len(a), 150000, replace=False)
                a, b = a[idx], b[idx]
            a = a - a.mean()
            b = b - b.mean()
            den = float(np.linalg.norm(a) * np.linalg.norm(b))
            if den < 1e-6:
                return -1.0
            return float(np.dot(a, b) / den)

    def finish(self) -> tuple[np.ndarray, dict]:
        n = len(self.strips)
        if n < 2:
            raise MosaicError("need >= 2 strips")

        valid_pairs = [(d, s) for d, s in zip(self.dtheta, self.sig) if d is not None]
        if not valid_pairs:
            raise MosaicError("no pairwise rotation estimates (textureless object?)")
        med_d = float(np.median([d for d, _ in valid_pairs]))
        med_s = float(np.median([s for _, s in valid_pairs]))
        dth: list[float] = []
        sg: list[float] = []
        for d, s in zip(self.dtheta, self.sig):
            if d is None:
                dth.append(med_d)
                sg.append(3.0 * max(med_s, 1e-3))
            else:
                dth.append(d)
                sg.append(max(s, 1e-3))

        th = [0.0]
        for d in dth:
            th.append(th[-1] + d)
        total = th[-1]

        closed = False
        k = int(round(abs(total) / (2.0 * math.pi))) if total != 0 else 0
        if k >= 1 and abs(abs(total) - k * 2.0 * math.pi) <= self.cfg.mosaic_loop_tol:
            target = math.copysign(k * 2.0 * math.pi, total)
            cumvar = [0.0]
            for s in sg:
                cumvar.append(cumvar[-1] + s * s)
            err = target - total
            tot = max(cumvar[-1], 1e-9)
            th = [th[i] + err * (cumvar[i] / tot) for i in range(n)]
            total = target
            closed = True

        H = self.strips[0][0].shape[0]
        if H > self.cfg.mosaic_max_h:
            f = self.cfg.mosaic_max_h / H
            self.strips = [(cv2.resize(s, (max(8, int(round(s.shape[1] * f))),
                                           self.cfg.mosaic_max_h),
                                       interpolation=cv2.INTER_AREA),
                            cv2.resize(w, (max(8, int(round(s.shape[1] * f))),
                                          self.cfg.mosaic_max_h),
                                       interpolation=cv2.INTER_AREA), fi)
                           for (s, w, fi) in self.strips]
            H = self.cfg.mosaic_max_h
        strip_w_med = float(np.median([s[0].shape[1] for s in self.strips]))
        ppr = strip_w_med / math.pi

        left = min(t - math.pi / 2.0 for t in th)
        right = max(t + math.pi / 2.0 for t in th)
        wrap = closed
        if wrap:
            W = max(64, int(round(2.0 * math.pi * ppr)))
        else:
            W = int((right - left) * ppr) + 1
        if W > self.cfg.mosaic_max_w:
            ppr *= self.cfg.mosaic_max_w / W
            W = self.cfg.mosaic_max_w
            if wrap:
                W = min(W, max(64, int(round(2.0 * math.pi * ppr))))

        # ---- best-view canvas: primary, runner-up, and their qualities ----
        P = np.full((H, W, 3), 255.0, np.float32)
        S = np.zeros((H, W, 3), np.float32)
        qp = np.zeros((H, W), np.float32)
        qs = np.zeros((H, W), np.float32)
        refine_scores: list[float] = []

        for i, (strip, wgt, fidx) in enumerate(self.strips):
            base = (th[i] - math.pi / 2.0) * ppr if wrap \
                else (th[i] - math.pi / 2.0 - left) * ppr
            if i == 0:
                self._blit_best(P, S, qp, qs, strip, wgt, base, wrap, W)
                continue
            center = base + strip.shape[1] / 2.0
            best = (strip, wgt, base, -2.0)
            for dx in self.cfg.mosaic_refine_dx:
                for s in self.cfg.mosaic_refine_scales:
                    if abs(s - 1.0) < 1e-3:
                        st2, wg2 = strip, wgt
                    else:
                        w2 = max(8, int(round(strip.shape[1] * s)))
                        st2 = cv2.resize(strip, (w2, H), interpolation=cv2.INTER_AREA)
                        wg2 = cv2.resize(wgt, (w2, H), interpolation=cv2.INTER_AREA)
                    x0 = center - st2.shape[1] / 2.0 + dx
                    sc_ = self._score_sharp(st2, wg2, x0, P, qp, wrap, W)
                    if sc_ > best[3]:
                        best = (st2, wg2, x0, sc_)
            st2, wg2, x0, sc_ = best
            if st2 is None:
                st2, wg2, x0 = strip, wgt, base
            self._blit_best(P, S, qp, qs, st2, wg2, x0, wrap, W)
            refine_scores.append(round(sc_, 2))

        # ---- seam crossfade: pure primary where it clearly wins, blend only
        # in the narrow band where primary and runner-up qualities cross ----
        alpha = np.ones((H, W), np.float32)
        m = qs > 1e-3
        alpha[m] = np.clip((qp[m] - qs[m]) / 0.06, 0.0, 1.0)
        fused = P * alpha[..., None] + S * (1.0 - alpha[..., None])
        fused = np.where((qp > 1e-3)[..., None], fused, 255.0)
        fused = np.clip(fused, 0.0, 255.0).astype(np.uint8)

        info = {"n_strips": n, "panorama_w": int(W), "mode": "best-view",
                "closed_loop": closed,
                "coverage": round(min(abs(total) / (2.0 * math.pi), 2.0), 2),
                "rotation_deg": [round(math.degrees(t), 1) for t in th],
                "dtheta_deg": [None if d is None else round(math.degrees(d), 1)
                               for d in self.dtheta],
                "refine_scores": refine_scores,
                "mean_quality": round(float(np.mean(qp[qp > 0])), 3),
                "warnings": self.warnings}
        log.info("RotationMosaic: %d strips, coverage=%.0f%%, closed=%s, W=%d, "
                 "mode=best-view, mean_quality=%.2f",
                 n, 100.0 * min(abs(total) / (2.0 * math.pi), 1.0), closed, W,
                 float(np.mean(qp[qp > 0])) if (qp > 0).any() else 0.0)
        return fused, info

# ----------------------------- stage 6: ECC + median fusion -----------------------------
def ecc_fuse(members: list[Candidate], cfg: Config) -> tuple[np.ndarray, dict]:
    ref = max(members, key=lambda m: m.sharpness)
    ref_bgr = composite_white(ref.image)
    H, W = ref_bgr.shape[:2]
    d = cfg.ecc_downscale
    ref_s = cv2.cvtColor(cv2.resize(ref_bgr, None, fx=d, fy=d),
                         cv2.COLOR_BGR2GRAY).astype(np.float32)
    stack = [ref_bgr.astype(np.float32)]
    n_aligned = 0

    for m in members:
        if m is ref:
            continue
        img = composite_white(m.image)
        if img.shape[:2] != (H, W):
            img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
        small = cv2.cvtColor(cv2.resize(img, None, fx=d, fy=d),
                             cv2.COLOR_BGR2GRAY).astype(np.float32)
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
            pass
        stack.append(img.astype(np.float32))

    fused = np.median(np.stack(stack), axis=0).astype(np.uint8)
    return fused, {"ecc_members": len(members), "ecc_aligned": n_aligned}


# ----------------------------- hashing / clustering -----------------------------
def hash_vecs(images: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    n = len(images)
    H0 = np.zeros((n, 64), bool)
    H180 = np.zeros((n, 64), bool)
    for i, img in enumerate(images):
        rgb = cv2.cvtColor(composite_white(img), cv2.COLOR_BGR2RGB)
        if HAS_HASH:
            im0 = Image.fromarray(rgb)
            H0[i] = imagehash.phash(im0, hash_size=8).hash.ravel()
            H180[i] = imagehash.phash(im0.rotate(180), hash_size=8).hash.ravel()
        else:
            g = cv2.cvtColor(rgb, cv2.COLOR_BGR2GRAY)
            t = cv2.resize(g, (8, 8)).astype(np.float32)
            H0[i] = (t > t.mean()).ravel()
            H180[i] = (t[::-1, ::-1] > t.mean()).ravel()
    return H0, H180


def phash_dist_matrix(H0: np.ndarray, H180: np.ndarray) -> np.ndarray:
    X = H0.astype(bool)
    Y = np.concatenate([H0, H180], axis=0).astype(bool)
    d = np.count_nonzero(X[:, None, :] != Y[None, :, :], axis=2)
    n = len(X)
    return np.minimum(d[:, :n], d[:, n:]).astype(np.float32)


def cluster_candidates(cands: list[Candidate], cfg: Config,
                       split_same_frame_cuboid: bool = False) -> list[list[int]]:
    if len(cands) <= 1:
        return [[i] for i in range(len(cands))]
    H0, H180 = hash_vecs([c.image for c in cands])
    dist = phash_dist_matrix(H0, H180)
    if split_same_frame_cuboid:
        for i in range(len(cands)):
            for j in range(len(cands)):
                if i != j and cands[i].frame_idx == cands[j].frame_idx \
                        and cands[i].method == "cuboid" and cands[j].method == "cuboid":
                    dist[i, j] = 64.0
    groups: list[list[int]] = []
    if HAS_SKLEARN:
        labels = AgglomerativeClustering(
            n_clusters=None, metric="precomputed", linkage="average",
            distance_threshold=cfg.cluster_dist).fit_predict(dist)
        buckets = defaultdict(list)
        for i, lb in enumerate(labels):
            buckets[int(lb)].append(i)
        groups = list(buckets.values())
    else:
        parent = list(range(len(cands)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
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


# ----------------------------- cuboid face verification -----------------------------
def face_inliers(img_a: np.ndarray, img_b: np.ndarray,
                 min_inliers: int = 12, min_ratio: float = 0.35) -> int:
    try:
        ga = cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY)
        gb = cv2.cvtColor(img_b, cv2.COLOR_BGR2GRAY)
        orb = cv2.ORB_create(nfeatures=1500, scaleFactor=1.2, nlevels=8)
        ka, da = orb.detectAndCompute(ga, None)
        kb, db = orb.detectAndCompute(gb, None)
        if da is None or db is None or len(ka) < 12 or len(kb) < 12:
            return 0
        bf = cv2.BFMatcher(cv2.NORM_HAMMING)
        matches = bf.knnMatch(da, db, k=2)
        good = [m for pair in matches if len(pair) == 2
                and pair[0].distance < 0.78 * pair[1].distance for m in [pair[0]]]
        if len(good) < 8:
            return 0
        src = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
        if H is None or mask is None:
            return 0
        inl = int(mask.sum())
        if inl < min_inliers or inl / max(len(good), 1) < min_ratio:
            return 0
        ha_, wa_ = ga.shape[:2]
        hb_, wb_ = gb.shape[:2]
        corners = np.float32([[0, 0], [wa_, 0], [wa_, ha_], [0, ha_]]).reshape(-1, 1, 2)
        proj = cv2.perspectiveTransform(corners, H).reshape(-1, 2)
        if np.any(proj[:, 0] < -0.25 * wb_) or np.any(proj[:, 0] > 1.25 * wb_) \
                or np.any(proj[:, 1] < -0.25 * hb_) or np.any(proj[:, 1] > 1.25 * hb_):
            return 0
        return inl
    except cv2.error:
        return 0


def _group_rep(cands: list[Candidate], g: list[int]) -> np.ndarray:
    return composite_white(max((cands[i] for i in g), key=lambda c: c.sharpness).image)


def _merge_face_groups(groups: list[list[int]], cands: list[Candidate],
                       cfg: Config) -> list[list[int]]:
    if len(groups) <= 1:
        return groups
    order = sorted(groups,
                   key=lambda g: (len(g), max(cands[i].sharpness for i in g)),
                   reverse=True)
    anchors: list[dict] = []
    for g in order:
        rep = _group_rep(cands, g)
        for a in anchors:
            if face_inliers(rep, a["rep"], cfg.orb_match_inliers,
                            cfg.orb_match_ratio) >= cfg.orb_match_inliers:
                a["members"].extend(g)
                break
        else:
            anchors.append({"rep": rep, "members": list(g)})
    return [a["members"] for a in anchors]


def _cyl_best_single(members: list[Candidate], cfg: Config,
                     note: str = "single best view") -> tuple[np.ndarray, dict]:
    best = max(members, key=lambda m: m.sharpness)
    a = (best.weight if best.weight is not None
         else np.ones(best.image.shape[:2], np.float32))
    if cfg.glare_weight:
        a = a * glare_weight(best.image)
    a = np.clip(a / max(float(a.max()), 1e-3), 0.0, 1.0)
    bgr = best.image.astype(np.float32)
    fused = (bgr * a[..., None] + 255.0 * (1.0 - a[..., None])).astype(np.uint8)
    return fused, {"members": 1, "note": note}


# ----------------------------- orchestrator (RIGID) -----------------------------
def extract_labels(input_path: str, out_dir: str, cfg: Config) -> dict:
    t0 = time.time()
    path = Path(input_path)
    outp = Path(out_dir)
    outp.mkdir(parents=True, exist_ok=True)
    warnings_l: list[str] = []

    if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"):
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
    frame_map = {fidx: fr for fidx, fr in frames}

    seg = Segmenter(cfg)

    if cfg.tracker == "video":
        if single:
            raise RuntimeError("--tracker video requires a video input")
        raw = _track_via_video_predictor(cfg, path, frames, seg)
        log.info("Tracking: SAM2 video predictor (%d masks)", len(raw))
    else:
        tracker = ObjectTracker()
        raw: list[tuple[int, int, np.ndarray, np.ndarray]] = []
        for fidx, frame in frames:
            for oid, mask in tracker.update(seg.segment(frame), frame.shape):
                raw.append((oid, fidx, frame, mask))
        log.info("Tracking: per-frame detector + IoU tracker")

    records: list[dict] = []
    for oid, fidx, frame, mask in raw:
        feats = silhouette_features(frame, mask, cfg)
        quads = (box_candidates(frame, mask, cfg, fidx, feats.get("fold_x"))
                 if cfg.shape_mode in ("auto", "cuboid") else [])
        cyl = (unwrap_cylinder(frame, mask, cfg, fidx)
               if cfg.shape_mode in ("auto", "cylinder") else None)
        records.append({"oid": oid, "fidx": fidx, "frame": frame,
                        "mask": mask, "feats": feats,
                        "quads": quads, "cyl": cyl})
    if not records:
        return {"outputs": [], "warnings": ["no product masks found"], "objects": []}

    by_obj: dict[int, list[dict]] = defaultdict(list)
    for r in records:
        by_obj[r["oid"]].append(r)
    multi = len(by_obj) > 1
    log.info("Objects tracked: %d (%s masks total)", len(by_obj), len(records))

    shape_clf = ShapeClassifier(cfg) if (cfg.use_clip and HAS_TORCH) else None

    report_objects: list[dict] = []
    all_outputs: list[dict] = []

    for oid in sorted(by_obj):
        recs = by_obj[oid]
        clip_probs = None
        if shape_clf is not None and cfg.shape_mode == "auto":
            clip_probs = shape_clf.classify(_clip_crops(recs, cfg.clip_frames))
        seq = [(r["fidx"], r["mask"]) for r in recs]
        rot_total, rot_valid, rot_pairs = estimate_rotation_total(cfg, frame_map, seq)
        dominant, vote_info = decide_shape(recs, cfg, clip_probs,
                                           rot_total, rot_valid, rot_pairs)
        if shape_clf is not None:
            vote_info["clip_status"] = shape_clf.status
        elif cfg.shape_mode == "auto":
            vote_info["clip_status"] = "disabled (--no-clip or no torch)"
        log.info("Object %d: masks=%d shape=%s %s",
                 oid, len(recs), dominant, vote_info)

        # ---- STRICT COMMIT: the decision is law ----
        cands: list[Candidate] = []
        if dominant == "cuboid":
            for r in recs:
                cands.extend(r["quads"])
        elif dominant == "cylinder":
            cands = [r["cyl"] for r in recs if r["cyl"] is not None]
        else:
            for r in recs:
                ic = irregular_crop(r["frame"], r["mask"], cfg, r["fidx"])
                if ic is not None:
                    cands.append(ic)

        if not cands:
            report_objects.append(
                {"oid": oid, "n_masks": len(recs), "shape": dominant,
                 "shape_vote": vote_info,
                 "error": f"no rectifiable candidates for shape={dominant}"})
            warnings_l.append(f"obj{oid}: no rectifiable candidates "
                              f"(shape={dominant})")
            log.error("Object %d: no rectifiable candidates for shape=%s",
                      oid, dominant)
            continue

        mask_by_frame: dict[int, np.ndarray] = {}
        for r in recs:
            mask_by_frame.setdefault(r["fidx"], r["mask"])

        outputs: list[dict] = []

        def save(fused: np.ndarray, method: str, info: dict,
                 n_views: int, member_frames: list[int]) -> None:
            gi = len(outputs) + 1
            name = (f"obj{oid:02d}_" if multi else "label_") \
                + f"{gi:02d}_{method}.png"
            out_file = outp / name
            cv2.imwrite(str(out_file), fused)
            outputs.append({"path": str(out_file), "method": method,
                            "n_views": n_views, "frames": member_frames,
                            "sharpness": round(sharpness(fused), 1), **info})
            log.info("Saved %s  (%d view(s), %s)", out_file, n_views, method)

        if dominant == "cylinder":
            # ONE mosaic from ALL strips. No clustering, no splitting.
            members = sorted(cands, key=lambda c: c.frame_idx)
            if len(members) >= 2 and cfg.texture_fusion:
                try:
                    mo = RotationMosaic(cfg, frame_map, mask_by_frame)
                    for m in members:
                        mo.add(m.image,
                               m.weight if m.weight is not None
                               else np.ones(m.image.shape[:2], np.float32),
                               m.frame_idx)
                    fused, info = mo.finish()
                    save(fused, "cyl", info, len(members),
                         sorted({m.frame_idx for m in members}))
                except MosaicError as e:
                    log.error("Object %d: cylinder mosaic failed: %s", oid, e)
                    fused, info = _cyl_best_single(members, cfg,
                                                   note=f"mosaic failed: {e}")
                    save(fused, "cyl", info, len(members),
                         sorted({m.frame_idx for m in members}))
            else:
                fused, info = _cyl_best_single(members, cfg)
                save(fused, "cyl", info, len(members),
                     sorted({m.frame_idx for m in members}))

        elif dominant == "cuboid":
            groups = cluster_candidates(cands, cfg, split_same_frame_cuboid=True)
            groups = _merge_face_groups(groups, cands, cfg)
            groups.sort(key=lambda g: (len(g), max(cands[i].sharpness for i in g)),
                        reverse=True)
            for g in groups[:cfg.max_faces]:
                members = [cands[i] for i in g]
                if len(members) >= 2 and cfg.texture_fusion:
                    fused, info = ecc_fuse(members, cfg)
                else:
                    best = max(members, key=lambda m: m.sharpness)
                    fused = composite_white(best.image)
                    info = {"members": 1}
                save(fused, "cuboid", info, len(members),
                     sorted({m.frame_idx for m in members}))

        else:  # irregular
            groups = cluster_candidates(cands, cfg)
            groups.sort(key=lambda g: (len(g), max(cands[i].sharpness for i in g)),
                        reverse=True)
            for g in groups[:cfg.max_faces]:
                members = [cands[i] for i in g]
                if len(members) >= 2 and cfg.texture_fusion:
                    fused, info = ecc_fuse(members, cfg)
                else:
                    best = max(members, key=lambda m: m.sharpness)
                    fused = composite_white(best.image)
                    info = {"members": 1}
                save(fused, "irregular", info, len(members),
                     sorted({m.frame_idx for m in members}))

        all_outputs.extend(outputs)

        if len(outputs) >= 2:
            H0, H180 = hash_vecs([cv2.imread(o["path"]) for o in outputs])
            D = phash_dist_matrix(H0, H180)
            for i in range(len(outputs)):
                for j in range(i + 1, len(outputs)):
                    if D[i, j] < 14:
                        warnings_l.append(
                            f"obj{oid}: outputs {i + 1} and {j + 1} look like the "
                            f"same face (pHash={D[i, j]:.0f})")

        report_objects.append({"oid": oid, "n_masks": len(recs),
                               "shape": dominant, "shape_vote": vote_info,
                               "outputs": outputs})

    ok_objs = [o for o in report_objects if "shape" in o]
    dominant_global = (max(ok_objs, key=lambda o: o.get("n_masks", 0))["shape"]
                       if ok_objs else "irregular")

    report = {"input": str(path), "frames_used": [i for i, _ in frames],
              "detected_shape": dominant_global,
              "objects": report_objects, "outputs": all_outputs,
              "params": asdict(cfg), "warnings": warnings_l,
              "runtime_s": round(time.time() - t0, 1)}
    rp = outp / "extraction_report.json"
    rp.write_text(json.dumps(report, indent=2, default=str))
    log.info("Report: %s", rp)
    return report


class UniversalLabelExtractor:
    """Adapter preserving the FastAPI unwrap contract for the new extractor."""

    def __init__(self, checkpoint: str = str(CHECKPOINT_PATH),
                 config: str = "configs/sam2.1/sam2.1_hiera_l.yaml",
                 max_keyframes: int = 24):
        self.checkpoint = checkpoint
        self.config = config
        self.max_keyframes = max_keyframes

    def process_input(self, input_path: str, output_dir: str) -> list[str]:
        cfg = Config(
            sam_checkpoint=self.checkpoint,
            sam_config=self.config,
            max_keyframes=self.max_keyframes,
            detector="dino",
        )
        report = extract_labels(input_path, output_dir, cfg)
        return [item["path"] for item in report.get("outputs", [])]


# ----------------------------- CLI -----------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="360° product scan -> flat label images")
    ap.add_argument("input")
    ap.add_argument("-o", "--out", default="extracted_labels")
    ap.add_argument("--shape", default="auto",
                    choices=["auto", "cuboid", "cylinder", "irregular"])
    ap.add_argument("--detector", default="dino", choices=["dino"])
    ap.add_argument("--tracker", default="frame", choices=["frame", "video"])
    ap.add_argument("--device", default="")
    ap.add_argument("--max-keyframes", type=int, default=24)
    ap.add_argument("--samples-per-sec", type=float, default=5.0)
    ap.add_argument("--max-faces", type=int, default=6)
    ap.add_argument("--cluster-dist", type=float, default=12.0)
    ap.add_argument("--distortion", type=float, default=30.0)
    ap.add_argument("--shape-margin", type=float, default=0.12)
    ap.add_argument("--blur-gate", type=float, default=0.0)
    ap.add_argument("--sam-checkpoint",
                    default=str(DEFAULT_CKPT_DIR / "sam2.1_hiera_large.pt"))
    ap.add_argument("--sam-config", default="configs/sam2.1/sam2.1_hiera_l.yaml")
    ap.add_argument("--dino-prompt",
                    default="product. package. box. can. bottle. jar. carton. pouch.")
    ap.add_argument("--no-fusion", action="store_true")
    ap.add_argument("--no-split-faces", action="store_true")
    ap.add_argument("--no-edge-refine", action="store_true")
    ap.add_argument("--no-glare", action="store_true")
    ap.add_argument("--no-clip", action="store_true")
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO,
                        format="%(levelname)s %(message)s")
    cfg = Config(
        shape_mode=args.shape, detector=args.detector, device=args.device,
        tracker=args.tracker,
        max_keyframes=args.max_keyframes, samples_per_sec=args.samples_per_sec,
        max_faces=args.max_faces, cluster_dist=args.cluster_dist,
        distortion_thresh_deg=args.distortion, shape_margin=args.shape_margin,
        blur_gate=args.blur_gate, sam_checkpoint=args.sam_checkpoint,
        sam_config=args.sam_config, dino_prompt=args.dino_prompt,
        texture_fusion=not args.no_fusion, split_faces=not args.no_split_faces,
        edge_refine=not args.no_edge_refine, glare_weight=not args.no_glare,
        use_clip=not args.no_clip)

    report = extract_labels(args.input, args.out, cfg)
    print(f"\n{'=' * 60}")
    if "detected_shape" in report:
        print(f"  Detected shape: {report['detected_shape']}")
    for obj in report.get("objects", []):
        print(f"  Object {obj.get('oid')}: shape={obj.get('shape', 'error')}  "
              f"{obj.get('shape_vote', {})}")
        if "error" in obj:
            print(f"    ERROR: {obj['error']}")
        for o in obj.get("outputs", []):
            line = (f"    {o['path']}   views={o['n_views']}  "
                    f"sharpness={o['sharpness']}")
            if "coverage" in o:
                line += (f"  coverage={o['coverage']}  closed={o.get('closed_loop')}"
                         f"  W={o.get('panorama_w')}")
            if "note" in o:
                line += f"  [{o['note']}]"
            print(line)
    for w in report.get("warnings", []):
        print(f"  WARNING: {w}")
    if not report.get("outputs"):
        print("  No labels extracted.")


if __name__ == "__main__":
    main()