# Twin vision service

A stateless FastAPI service that runs deterministic OpenCV checks for Twin AI. The web app calls it server-to-server through `POST /api/vision/inspect`. See [docs/python-services-plan.md](../../docs/python-services-plan.md) for why it exists and what comes next.

## Run

```bash
uv sync                                   # Python 3.13, deps from uv.lock
uv run pytest                             # 16 tests on synthetic media
uv run uvicorn app.main:app --port 8000   # interactive docs at /docs
```

Point the web app at it with `VISION_SERVICE_URL=http://localhost:8000`.

Set `VISION_SERVICE_TOKEN` (here and in the web app) to require a bearer token on the inspection endpoints.

Docker (in the full stack, `docker compose up` runs it as `http://vision:8080`):

```bash
docker build -t twin-vision .
docker run -p 8000:8080 twin-vision
```

## API

| Endpoint | Form fields | Returns |
|---|---|---|
| `GET /health` | — | status, version, OpenCV version |
| `POST /v1/inspect/image` | `image` (JPEG/PNG/WebP/BMP ≤ 15 MB), optional `reference` (golden image), `threshold` (default 40), `min_area_pct` (default 0.05) | `quality`, `codes`, `comparison` (alignment, inliers, `defects[]` with boxes normalised to the uploaded image) |
| `POST /v1/inspect/video` | `video` (MP4/WebM/MOV/AVI ≤ 30 MB), `sample_fps` (2), `motion_threshold_pct` (1.0), `min_still_sec` (3) | `segments`, `stillPeriods`, `movingPct`, `codes`, frame `quality`, a downsampled motion `series` |

Errors: `415` wrong type, `413` too large, `422` undecodable, `400` empty.

## Behaviour

- **Deterministic.** Fixed parameters and a seeded RANSAC: the same input gives the same output (tested). Every response names the engine version.
- **Measurements, not verdicts.** The web app stores each result as a review that waits for a person to confirm or dismiss it.
- **Nothing stored.** Images are decoded in memory. Videos go to a temp file that is deleted after analysis.

Limits:
- This is classical vision: it finds differences from a golden image but doesn't classify defects.
- Barcode grades are indicative. A formal ISO/IEC 15416 grade needs a calibrated verifier.
- OpenCV's 1D reader misses some codes.

Settings (environment): `MAX_IMAGE_BYTES`, `MAX_VIDEO_BYTES`, `MAX_VIDEO_SECONDS`, `PORT`.
