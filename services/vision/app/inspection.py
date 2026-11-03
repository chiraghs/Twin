"""Deterministic machine-vision checks (OpenCV).

Everything here is classical image processing with fixed parameters: the same input always gives
the same output. Nothing is a trained model and nothing is stored. Results are measurements for a
person to review, never accept/reject decisions.

Checks:
- image quality: is the frame usable for inspection (sharpness, exposure, contrast)
- codes: QR and 1D barcodes decoded, with an *indicative* symbol-contrast grade (ISO/IEC 15416 bands)
- golden comparison: align a test image to a known-good reference and report regions that differ
- video: frame-differencing motion timeline, still periods (possible stoppages), codes, frame quality
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass

import cv2
import numpy as np

# Processing sizes keep results comparable across camera resolutions.
QUALITY_LONG_SIDE = 1000
COMPARE_LONG_SIDE = 1200
VIDEO_WIDTH = 480

# Heuristic thresholds for "usable for inspection" (documented, not standards).
SHARPNESS_MIN = 60.0  # variance of the Laplacian at QUALITY_LONG_SIDE
BRIGHTNESS_MIN = 40.0
BRIGHTNESS_MAX = 215.0
CONTRAST_MIN = 12.0

# ISO/IEC 15416 symbol-contrast grade bands (SC = Rmax - Rmin, in %).
SC_BANDS = [(70.0, "A"), (55.0, "B"), (40.0, "C"), (20.0, "D")]

RNG_SEED = 20261013


class InspectionError(ValueError):
    """Input that cannot be inspected (undecodable, empty, too large)."""


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float

    def as_dict(self) -> dict:
        return {"x": round(self.x, 4), "y": round(self.y, 4), "w": round(self.w, 4), "h": round(self.h, 4)}


def decode_image(data: bytes) -> np.ndarray:
    if not data:
        raise InspectionError("Empty file")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise InspectionError("Not a decodable image (use JPEG, PNG, WebP or BMP)")
    if img.shape[0] < 32 or img.shape[1] < 32:
        raise InspectionError("Image is too small to inspect (minimum 32×32 px)")
    return img


def _resize_long(img: np.ndarray, long_side: int) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    scale = long_side / max(h, w)
    if abs(scale - 1.0) < 1e-6:
        return img, 1.0
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR
    return cv2.resize(img, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=interp), scale


def _gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _norm_box(x: float, y: float, w: float, h: float, width: int, height: int) -> Box:
    x0 = min(max(x, 0.0), width)
    y0 = min(max(y, 0.0), height)
    x1 = min(max(x + w, 0.0), width)
    y1 = min(max(y + h, 0.0), height)
    return Box(x0 / width, y0 / height, (x1 - x0) / width, (y1 - y0) / height)


# ───────────────────────────── image quality ─────────────────────────────


def image_quality(img: np.ndarray) -> dict:
    gray = _gray(img)
    # Only shrink: enlarging a small frame would soften it and understate sharpness.
    if max(gray.shape[:2]) > QUALITY_LONG_SIDE:
        gray, _ = _resize_long(gray, QUALITY_LONG_SIDE)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    contrast = float(gray.std())
    issues: list[str] = []
    if sharpness < SHARPNESS_MIN:
        issues.append("blurry")
    if brightness < BRIGHTNESS_MIN:
        issues.append("underexposed")
    elif brightness > BRIGHTNESS_MAX:
        issues.append("overexposed")
    if contrast < CONTRAST_MIN:
        issues.append("low contrast")
    return {
        "sharpness": round(sharpness, 1),
        "brightness": round(brightness, 1),
        "contrast": round(contrast, 1),
        "usable": not issues,
        "issues": issues,
        "thresholds": {"sharpnessMin": SHARPNESS_MIN, "brightnessMin": BRIGHTNESS_MIN, "brightnessMax": BRIGHTNESS_MAX, "contrastMin": CONTRAST_MIN},
    }


# ───────────────────────────── codes ─────────────────────────────


def _contrast_grade(gray: np.ndarray, pts: np.ndarray) -> tuple[float | None, str | None]:
    x, y, w, h = cv2.boundingRect(pts.astype(np.float32))
    crop = gray[max(0, y) : y + h, max(0, x) : x + w]
    if crop.size < 16:
        return None, None
    r_max = float(np.percentile(crop, 95))
    r_min = float(np.percentile(crop, 5))
    sc = (r_max - r_min) / 255.0 * 100.0
    grade = next((g for limit, g in SC_BANDS if sc >= limit), "F")
    return round(sc, 1), grade


def _barcode_passes(gray: np.ndarray) -> list[tuple[np.ndarray, float, int]]:
    """Image variants for the 1D reader as (image, scale, pad). OpenCV's barcode localiser is
    sensitive to scale and to perfectly sharp edges, so a few fixed variants are tried in order."""
    pad = max(16, round(0.1 * max(gray.shape)))
    padded = cv2.copyMakeBorder(gray, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=255)
    half = cv2.resize(padded, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    return [
        (gray, 1.0, 0),
        (cv2.GaussianBlur(gray, (0, 0), 0.8), 1.0, 0),
        (padded, 1.0, pad),
        (half, 0.5, pad),
        (cv2.GaussianBlur(half, (0, 0), 0.8), 0.5, pad),
    ]


def read_codes(img: np.ndarray) -> list[dict]:
    gray = _gray(img)
    h, w = gray.shape[:2]
    found: dict[tuple[str, str], dict] = {}

    def add(fmt: str, text: str, pts: np.ndarray) -> None:
        key = (fmt, text)
        if not text or key in found:
            return
        sc, grade = _contrast_grade(gray, pts)
        bx, by, bw, bh = cv2.boundingRect(pts.astype(np.float32))
        found[key] = {"format": fmt, "data": text, "box": _norm_box(bx, by, bw, bh, w, h).as_dict(), "symbolContrast": sc, "contrastGrade": grade}

    ok, texts, points, _ = cv2.QRCodeDetector().detectAndDecodeMulti(gray)
    if ok and points is not None:
        for text, pts in zip(texts, points):
            add("QR_CODE", text, pts)

    bd = cv2.barcode.BarcodeDetector()
    for variant, scale, pad in _barcode_passes(gray):
        res = bd.detectAndDecodeWithType(variant)  # OpenCV ≥ 4.8: (ok, infos, types, points)
        if not res[0] or res[3] is None:
            continue
        for text, kind, pts in zip(res[1], res[2], res[3]):
            add(str(kind), text, pts / scale - pad)  # back to original image coordinates

    return sorted(found.values(), key=lambda c: (c["box"]["y"], c["box"]["x"], c["data"]))


# ───────────────────────────── golden comparison ─────────────────────────────


def _align(test_g: np.ndarray, ref_g: np.ndarray) -> tuple[np.ndarray | None, int, str]:
    """Homography mapping test → reference, from ORB features (deterministic with a fixed RNG seed)."""
    cv2.setRNGSeed(RNG_SEED)
    orb = cv2.ORB_create(nfeatures=4000)
    kt, dt = orb.detectAndCompute(test_g, None)
    kr, dr = orb.detectAndCompute(ref_g, None)
    if dt is None or dr is None or len(kt) < 12 or len(kr) < 12:
        return None, 0, "too few features"
    matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(dt, dr)
    matches = sorted(matches, key=lambda m: (m.distance, m.queryIdx, m.trainIdx))[:800]
    if len(matches) < 12:
        return None, 0, "too few matches"
    src = np.float32([kt[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
    dst = np.float32([kr[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0, maxIters=4000, confidence=0.999)
    inliers = int(mask.sum()) if mask is not None else 0
    if H is None or inliers < 12:
        return None, inliers, "homography not found"
    return H, inliers, "ok"


def compare_to_reference(test: np.ndarray, reference: np.ndarray, threshold: int = 40, min_area_pct: float = 0.05) -> dict:
    """Align `test` to the golden `reference` and report regions that differ.

    Boxes are returned in the TEST image's coordinates (normalised 0–1), so they can be drawn over
    the image the user uploaded.
    """
    ref_c, _ = _resize_long(reference, COMPARE_LONG_SIDE)
    test_c, _ = _resize_long(test, COMPARE_LONG_SIDE)
    ref_g = cv2.GaussianBlur(_gray(ref_c), (5, 5), 0)
    test_g = cv2.GaussianBlur(_gray(test_c), (5, 5), 0)
    rh, rw = ref_g.shape
    th_, tw = test_g.shape

    H, inliers, why = _align(test_g, ref_g)
    if H is not None:
        mode = "homography"
        warped = cv2.warpPerspective(test_g, H, (rw, rh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        valid = cv2.warpPerspective(np.full_like(test_g, 255), H, (rw, rh), flags=cv2.INTER_NEAREST, borderValue=0)
        H_inv = np.linalg.inv(H)
    else:
        mode = "resize"
        warped = cv2.resize(test_g, (rw, rh), interpolation=cv2.INTER_AREA)
        valid = np.full_like(ref_g, 255)
        H_inv = np.array([[tw / rw, 0, 0], [0, th_ / rh, 0], [0, 0, 1]], dtype=np.float64)
    valid = cv2.erode(valid, np.ones((9, 9), np.uint8))
    m = valid > 0

    # Photometric normalisation: match the test's mean/std to the reference inside the valid area,
    # so a global lighting change is not reported as a defect.
    t_vals = warped[m].astype(np.float32)
    r_vals = ref_g[m].astype(np.float32)
    if t_vals.size and t_vals.std() > 1e-3:
        norm = (warped.astype(np.float32) - t_vals.mean()) / t_vals.std() * r_vals.std() + r_vals.mean()
    else:
        norm = warped.astype(np.float32)
    diff = np.abs(norm - ref_g.astype(np.float32))
    diff[~m] = 0
    diff_u8 = np.clip(diff, 0, 255).astype(np.uint8)

    _, binary = cv2.threshold(diff_u8, threshold, 255, cv2.THRESH_BINARY)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    area_total = float(rw * rh)
    min_area = max(25.0, area_total * min_area_pct / 100.0)
    defects = []
    for c in contours:
        area = float(cv2.contourArea(c))
        if area < min_area:
            continue
        cmask = np.zeros_like(binary)
        cv2.drawContours(cmask, [c], -1, 255, thickness=-1)
        mean_diff = float(diff[cmask > 0].mean())
        # Map the region back into the test image frame.
        pts = cv2.perspectiveTransform(c.reshape(-1, 1, 2).astype(np.float64), H_inv)
        bx, by, bw, bh = cv2.boundingRect(pts.astype(np.float32))
        defects.append(
            {
                "box": _norm_box(bx, by, bw, bh, tw, th_).as_dict(),
                "areaPct": round(area / area_total * 100.0, 3),
                "meanDiff": round(mean_diff, 1),
            }
        )
    defects.sort(key=lambda d: (-d["areaPct"], d["box"]["y"], d["box"]["x"]))
    changed_pct = float((binary > 0).sum()) / area_total * 100.0
    return {
        "alignment": mode,
        "alignmentNote": "ORB features + RANSAC homography" if mode == "homography" else f"no reliable alignment ({why}); images compared after resizing",
        "inliers": inliers,
        "threshold": threshold,
        "minAreaPct": min_area_pct,
        "changedPct": round(changed_pct, 3),
        "defects": defects[:25],
        "truncated": len(defects) > 25,
    }


def inspect_image(data: bytes, reference: bytes | None = None, threshold: int = 40, min_area_pct: float = 0.05) -> dict:
    t0 = time.perf_counter()
    img = decode_image(data)
    ref = decode_image(reference) if reference else None
    result = {
        "kind": "image",
        "width": int(img.shape[1]),
        "height": int(img.shape[0]),
        "quality": image_quality(img),
        "codes": read_codes(img),
        "comparison": compare_to_reference(img, ref, threshold, min_area_pct) if ref is not None else None,
        "engine": f"OpenCV {cv2.__version__}",
    }
    result["durationMs"] = round((time.perf_counter() - t0) * 1000)
    return result


# ───────────────────────────── video ─────────────────────────────


def inspect_video(path: str, sample_fps: float = 2.0, max_seconds: float = 300.0, motion_threshold_pct: float = 1.0, min_still_sec: float = 3.0) -> dict:
    """Motion timeline by frame differencing on sampled frames, plus codes and frame quality.

    "still" means almost nothing in the frame changed between samples. On a fixed camera watching
    a conveyor that usually means the line stopped; it is reported as a possible stoppage.
    """
    t0 = time.perf_counter()
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise InspectionError("Could not open the video (use MP4, WebM, MOV or AVI)")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        if not math.isfinite(fps) or fps <= 0 or fps > 240:
            fps = 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        step = max(1, round(fps / max(0.2, min(sample_fps, fps))))
        max_frames = int(max_seconds * fps)

        samples: list[dict] = []
        codes: dict[tuple[str, str], dict] = {}
        prev = None
        idx = 0
        blurry = dark = bright = 0
        while idx < max_frames:
            ok = cap.grab()
            if not ok:
                break
            if idx % step == 0:
                ok, frame = cap.retrieve()
                if not ok or frame is None:
                    break
                t = idx / fps
                small, _ = _resize_long(frame, VIDEO_WIDTH)
                g = cv2.GaussianBlur(_gray(small), (5, 5), 0)
                if prev is None:
                    changed = 0.0
                else:
                    d = cv2.absdiff(g, prev)
                    changed = float((d > 25).sum()) / d.size * 100.0
                prev = g
                q = image_quality(small)
                blurry += "blurry" in q["issues"]
                dark += "underexposed" in q["issues"]
                bright += "overexposed" in q["issues"]
                samples.append({"t": round(t, 2), "changedPct": round(changed, 3)})
                if len(samples) % 4 == 1:  # read codes about every 2 s at the default rate
                    for c in read_codes(frame):
                        key = (c["format"], c["data"])
                        if key not in codes:
                            codes[key] = {"format": c["format"], "data": c["data"], "firstSec": round(t, 2), "contrastGrade": c["contrastGrade"]}
            idx += 1
        analysed_sec = idx / fps
    finally:
        cap.release()

    if not samples:
        raise InspectionError("The video has no readable frames")

    # Each sample's change describes the interval since the previous sample, so segments sit exactly
    # on the sampling grid; the tail after the last sample takes the last known state.
    segments: list[dict] = []
    for prev_s, s in zip(samples, samples[1:]):
        st = "moving" if s["changedPct"] >= motion_threshold_pct else "still"
        if segments and segments[-1]["state"] == st:
            segments[-1]["endSec"] = s["t"]
        else:
            segments.append({"state": st, "startSec": prev_s["t"], "endSec": s["t"]})
    if not segments:
        segments.append({"state": "still", "startSec": 0.0, "endSec": 0.0})
    segments[-1]["endSec"] = round(max(segments[-1]["endSec"], analysed_sec), 2)
    stills = [
        {"startSec": seg["startSec"], "endSec": seg["endSec"], "durationSec": round(seg["endSec"] - seg["startSec"], 2)}
        for seg in segments
        if seg["state"] == "still" and seg["endSec"] - seg["startSec"] >= min_still_sec
    ]
    moving_sec = sum(seg["endSec"] - seg["startSec"] for seg in segments if seg["state"] == "moving")

    # Downsample the motion series for display.
    stride = max(1, math.ceil(len(samples) / 120))
    series = samples[::stride]

    return {
        "kind": "video",
        "fps": round(fps, 2),
        "durationSec": round(total_frames / fps, 2) if total_frames else round(analysed_sec, 2),
        "analysedSec": round(analysed_sec, 2),
        "truncated": analysed_sec >= max_seconds - 1e-6,
        "sampleFps": round(fps / step, 2),
        "framesAnalysed": len(samples),
        "motionThresholdPct": motion_threshold_pct,
        "movingPct": round(moving_sec / max(analysed_sec, 1e-6) * 100.0, 1),
        "segments": segments,
        "stillPeriods": stills,
        "quality": {"blurryFrames": blurry, "underexposedFrames": dark, "overexposedFrames": bright},
        "codes": sorted(codes.values(), key=lambda c: (c["firstSec"], c["data"])),
        "series": series,
        "engine": f"OpenCV {cv2.__version__}",
        "durationMs": round((time.perf_counter() - t0) * 1000),
    }
