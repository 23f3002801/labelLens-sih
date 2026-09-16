import cv2
import numpy as np  
import torch  
import imagehash  
from PIL import Image  
from sklearn.cluster import AgglomerativeClustering  
from sam2.build_sam import build_sam2  
from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator  
import os  
from tqdm import tqdm  
from pathlib import Path  

SERVER_DIR = Path(__file__).resolve().parents[1]  
CHECKPOINT_PATH = SERVER_DIR / "checkpoints" / "sam2.1_hiera_large.pt"  

class UniversalLabelExtractor:
    def __init__(self, checkpoint=str(CHECKPOINT_PATH), config="configs/sam2.1/sam2.1_hiera_l.yaml", max_keyframes=15):  
        self.device = "cuda" if torch.cuda.is_available() else "cpu"  
        self.max_keyframes = max_keyframes  
        
        print(f"Loading SAM 2 Large Model on {self.device}...")
        sam2 = build_sam2(config, checkpoint, device=self.device, apply_postprocessing=False)  
        self.mask_generator = SAM2AutomaticMaskGenerator(
            model=sam2,
            points_per_side=12, 
            pred_iou_thresh=0.85,
            stability_score_thresh=0.85,
            min_mask_region_area=10000, 
        )  

    def _select_keyframes(self, video_path: str) -> list[np.ndarray]:
        cap = cv2.VideoCapture(video_path)  
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0  
        interval = max(1, int(fps / 5))  
        
        frames_info = []
        idx = 0
        while cap.isOpened():  
            ret, frame = cap.read()  
            if not ret: break  
            
            if idx % interval == 0:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)  
                sharpness = cv2.Laplacian(cv2.GaussianBlur(gray, (5, 5), 0), cv2.CV_64F).var()  
                frames_info.append({"frame": frame, "sharpness": sharpness})  
            idx += 1
        cap.release()  

        if not frames_info: return []  

        n_buckets = min(self.max_keyframes, len(frames_info))  
        bucket_size = len(frames_info) / n_buckets  
        
        keyframes = []
        for i in range(n_buckets):  
            start = int(i * bucket_size)  
            end = int((i + 1) * bucket_size) if i < n_buckets - 1 else len(frames_info)  
            bucket = frames_info[start:end]  
            if bucket:
                best_frame = max(bucket, key=lambda x: x["sharpness"])  
                keyframes.append(best_frame["frame"])  
                
        return keyframes  

    def _calculate_distortion(self, corners: np.ndarray) -> float:
        (tl, tr, br, bl) = corners  
        def angle(p1, vertex, p3):  
            v1, v2 = p1 - vertex, p3 - vertex  
            cos = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-8)  
            return np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))  
        return sum(abs(angle(*trio) - 90) for trio in [(tl, tr, br), (tr, br, bl), (br, bl, tl), (bl, tl, tr)])  

    def extract_and_mask(self, frame: np.ndarray) -> list[dict]:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)  
        masks = self.mask_generator.generate(rgb_frame)  
        
        valid_objects = []
        frame_h, frame_w = frame.shape[:2]  
        margin = 10  

        # Prepare base RGBA frame for transparent background removal
        rgba_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA)

        for mask_data in masks:  
            mask = mask_data["segmentation"].astype(np.uint8) * 255  
            area = mask_data["area"]  
            
            if area / (frame_h * frame_w) < 0.10: continue  
                
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)  
            if not contours: continue  
            
            c = max(contours, key=cv2.contourArea)  
            x, y, w, h = cv2.boundingRect(c)  
            
            if x < margin or y < margin or (x + w) > (frame_w - margin) or (y + h) > (frame_h - margin):  
                continue
                
            isolated_rgba = rgba_frame.copy()
            isolated_rgba[:, :, 3] = mask
            
            peri = cv2.arcLength(c, True)  
            is_cuboid = False
            
            # PATH A: Geometric Unwrapping for Cuboids
            for eps in [0.02, 0.03, 0.04]:  
                approx = cv2.approxPolyDP(c, eps * peri, True)  
                if len(approx) == 4:  
                    corners = approx.reshape(4, 2).astype("float32")  
                    
                    rect = np.zeros((4, 2), dtype="float32")  
                    s = corners.sum(axis=1)  
                    rect[0], rect[2] = corners[np.argmin(s)], corners[np.argmax(s)]  
                    diff = np.diff(corners, axis=1)  
                    rect[1], rect[3] = corners[np.argmin(diff)], corners[np.argmax(diff)]  
                    
                    distortion = self._calculate_distortion(rect)  
                    if distortion <= 35.0:  
                        warped = self._warp_perspective(isolated_rgba, rect)  
                        if warped is not None:  
                            gray = cv2.cvtColor(warped, cv2.COLOR_BGRA2GRAY)
                            sharpness = float(cv2.Laplacian(cv2.GaussianBlur(gray, (5, 5), 0), cv2.CV_64F).var())  
                            valid_objects.append({
                                "image": warped,
                                "sharpness": sharpness,
                                "area": area,
                                "distortion": distortion  
                            })
                            is_cuboid = True
                        break  
                        
            # PATH B: Bounding Box Fallback for Irregular Shapes (Chips)
            if not is_cuboid and w > 50 and h > 50:
                cropped = isolated_rgba[y:y+h, x:x+w]
                gray = cv2.cvtColor(cropped, cv2.COLOR_BGRA2GRAY)
                sharpness = float(cv2.Laplacian(cv2.GaussianBlur(gray, (5, 5), 0), cv2.CV_64F).var())
                valid_objects.append({
                    "image": cropped,
                    "sharpness": sharpness,
                    "area": area,
                    "distortion": 1.0 # Default low penalty for irregular crops
                })
                    
        return valid_objects

    def _warp_perspective(self, image: np.ndarray, rect: np.ndarray) -> np.ndarray | None:
        centroid = rect.mean(axis=0)  
        inset = np.array([pt + 0.03 * (centroid - pt) for pt in rect], dtype="float32")  
        (tl, tr, br, bl) = inset  
        
        width = max(int(np.linalg.norm(br - bl)), int(np.linalg.norm(tr - tl)))  
        height = max(int(np.linalg.norm(tr - br)), int(np.linalg.norm(tl - bl)))  

        if width < 50 or height < 50: return None  

        dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")  
        matrix = cv2.getPerspectiveTransform(inset, dst)  
        warped = cv2.warpPerspective(image, matrix, (width, height))  
        
        if height > width:  
            warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)  
            
        return warped  

    def process_input(self, input_path: str, output_dir: str):
        # Route logic for single image vs video
        if input_path.lower().endswith(('.png', '.jpg', '.jpeg')):
            frame = cv2.imread(input_path)
            if frame is None: return []
            keyframes = [frame]
        else:
            keyframes = self._select_keyframes(input_path)  
            
        if not keyframes: return []  

        all_candidates = []
        pbar = tqdm(total=len(keyframes), desc="[Pass 2] SAM 2 Large Analyzing Keyframes")  
        for frame in keyframes:  
            with torch.inference_mode(), torch.autocast(self.device, dtype=torch.bfloat16):  
                objects = self.extract_and_mask(frame)
                all_candidates.extend(objects)
            pbar.update(1)  
        pbar.close()  
        
        if not all_candidates:  
            print("No valid faces detected.")  
            return []  

        os.makedirs(output_dir, exist_ok=True)  
        saved_paths = []

        # Bypass clustering if input is a single image to keep all unique faces found
        if len(all_candidates) <= 2 and len(keyframes) == 1:
            for i, best in enumerate(all_candidates):
                out_path = os.path.join(output_dir, f"extracted_label_{i + 1}.png")
                cv2.imwrite(out_path, best["image"])
                saved_paths.append(out_path)
                print(f"Saved: {out_path}")
            return saved_paths

        print(f"\n[Pass 3] Deduplicating {len(all_candidates)} candidates using 180° Invariant Hashing...")  
        
        hashes_0 = []  
        hashes_180 = []  
        
        for f in all_candidates:  
            # Strip alpha channel for image hashing
            img = Image.fromarray(cv2.cvtColor(f["image"], cv2.COLOR_BGRA2RGB))
            hashes_0.append(imagehash.phash(img, hash_size=8))  
            hashes_180.append(imagehash.phash(img.rotate(180), hash_size=8))  
            
        n = len(all_candidates)  
        dist = np.zeros((n, n), dtype=float)  
        
        for i in range(n):  
            for j in range(n):  
                if i != j:  
                    dist[i, j] = min(hashes_0[i] - hashes_0[j], hashes_0[i] - hashes_180[j])  

        labels = AgglomerativeClustering(
            n_clusters=None, 
            metric="precomputed", 
            linkage="average", 
            distance_threshold=15
        ).fit_predict(dist)  
        
        clusters = {}  
        for i, lbl in enumerate(labels):  
            clusters.setdefault(lbl, []).append(all_candidates[i])  
            
        sorted_clusters = sorted(clusters.values(), key=lambda group: len(group), reverse=True)  
        top_clusters = sorted_clusters[:5]  
        
        print(f"Filtered out garbage crops. Keeping the top {len(top_clusters)} dominant physical faces.")  
        
        for i, group in enumerate(top_clusters):  
            if len(group) < 2 and len(keyframes) > 1: continue 
                
            best = max(group, key=lambda f: (f["sharpness"] * f["area"]) / (f["distortion"] + 1))  
            out_path = os.path.join(output_dir, f"dominant_face_{i + 1}.png")
            cv2.imwrite(out_path, best["image"])  
            saved_paths.append(out_path)  
            print(f"Saved: {out_path} (Detected {len(group)} times)")

        return saved_paths  

if __name__ == "__main__":  
    extractor = UniversalLabelExtractor(checkpoint="sam2.1_hiera_large.pt", config="configs/sam2.1/sam2.1_hiera_l.yaml")
    # Processing Video
    # extractor.process_input("sample.mp4", "extracted_labels")
    # Processing Single Image
    # extractor.process_input(r"E:\github\labelLens-sih\dataset\test\44.png", "extracted_labels")









  