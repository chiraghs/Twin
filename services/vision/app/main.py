"""Twin vision service.

A stateless FastAPI app that runs deterministic OpenCV checks on images and short videos.
Called server-to-server by the Twin web app (never directly by browsers, so no CORS).
Uploads are processed in memory or a temp file that is deleted immediately; nothing is stored.
"""

from __future__ import annotations

import os
import tempfile

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import __version__
from .inspection import InspectionError, inspect_image, inspect_video

MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", 15 * 1024 * 1024))
MAX_VIDEO_BYTES = int(os.getenv("MAX_VIDEO_BYTES", 30 * 1024 * 1024))
MAX_VIDEO_SECONDS = float(os.getenv("MAX_VIDEO_SECONDS", 300))

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}
VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-msvideo": ".avi"}

app = FastAPI(
    title="Twin Vision Service",
    version=__version__,
    description="Deterministic OpenCV inspection: image quality, barcode/QR reading, golden-reference comparison and video motion analysis. Results are measurements for human review.",
)


def _read_limited(upload: UploadFile, limit: int, what: str) -> bytes:
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"{what} is larger than {limit // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(400, f"{what} is empty")
    return data


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "twin-vision", "version": __version__, "engine": f"OpenCV {cv2.__version__}"}


# Sync handlers run in FastAPI's worker thread pool, so CPU-bound OpenCV work does not block the event loop.
@app.post("/v1/inspect/image")
def inspect_image_endpoint(
    image: UploadFile = File(..., description="Image to inspect"),
    reference: UploadFile | None = File(None, description="Optional golden (known-good) image of the same part"),
    threshold: int = Form(40, ge=5, le=200, description="Per-pixel difference threshold (0–255) after alignment"),
    min_area_pct: float = Form(0.05, ge=0.001, le=10, description="Smallest reported region, % of the image"),
) -> dict:
    if image.content_type not in IMAGE_TYPES:
        raise HTTPException(415, f"Unsupported image type {image.content_type}. Use JPEG, PNG, WebP or BMP.")
    if reference is not None and reference.content_type not in IMAGE_TYPES:
        raise HTTPException(415, f"Unsupported reference type {reference.content_type}.")
    data = _read_limited(image, MAX_IMAGE_BYTES, "Image")
    ref = _read_limited(reference, MAX_IMAGE_BYTES, "Reference image") if reference is not None else None
    try:
        return inspect_image(data, ref, threshold, min_area_pct)
    except InspectionError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/v1/inspect/video")
def inspect_video_endpoint(
    video: UploadFile = File(..., description="Short video clip"),
    sample_fps: float = Form(2.0, ge=0.2, le=10),
    motion_threshold_pct: float = Form(1.0, ge=0.05, le=50, description="% of pixels that must change for a sample to count as moving"),
    min_still_sec: float = Form(3.0, ge=0.5, le=600, description="Shortest still period reported as a possible stoppage"),
) -> dict:
    suffix = VIDEO_TYPES.get(video.content_type or "")
    if suffix is None:
        raise HTTPException(415, f"Unsupported video type {video.content_type}. Use MP4, WebM, MOV or AVI.")
    data = _read_limited(video, MAX_VIDEO_BYTES, "Video")
    # OpenCV reads video from a path; the temp file is removed as soon as analysis ends.
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            return inspect_video(tmp.name, sample_fps, MAX_VIDEO_SECONDS, motion_threshold_pct, min_still_sec)
        except InspectionError as e:
            raise HTTPException(422, str(e)) from e
