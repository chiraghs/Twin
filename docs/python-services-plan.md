# Python services plan (FastAPI)

**Status (14 Oct 2026):** Phase 1 (the vision service) is built and tested. Phase 2 is done: it runs privately on Cloud Run as `twin-vision` and is connected from the Integrations page. Phases 3–5 come after the hackathon. A second Python component, `services/agents` (a Python ADK agent that uses Twin over MCP), is also built; see [architecture § 7.4](architecture.md#74-mcp-server-and-the-python-adk-agent).

## Decision

Twin keeps **Next.js as the system of record**: UI, API, factory state, audit trail and the deterministic plant engine. We add **Python (FastAPI) services alongside it** for work where Python's libraries are clearly stronger: computer vision, industrial protocols, local model serving and ML forecasting.

We are **not** moving the whole backend to Python:

- **The engine runs in the browser too.** The plant model, what-if scenarios and quality maths (≈6,250 lines in `src/domain`) are imported by 15 UI modules. That's why the What-If sliders recalculate instantly. A Python backend would mean two engines that must give identical numbers, or a server round trip on every slider move.
- **A rewrite has no visible gain.** It would mean re-doing 51 unit tests, the deterministic crisis numbers and the streamed agent run.
- **It adds risk to the demo.** It would put a second deploy on the critical path.

## Architecture

```
Browser ──► Next.js on Firebase App Hosting (Cloud Run)
              UI · API · deterministic engine · state · audit
              │
              ├── HTTPS + Google ID token ──► Vision service (FastAPI + OpenCV, Cloud Run)   ← Phase 1–2
              │
              ◄── Pub/Sub ◄── Edge gateway on the plant network (Python)                     ← Phases 3–4
              │                 OPC UA · Modbus · MQTT (read-only) · RTSP frame sampling
              │
              └── HTTP ──► Gemma model server, on-prem (optional)                             ← Phase 5
```

## Ground rules for every Python service

1. **Stateless (vision service).** The vision service returns measurements; the web app records them and writes the audit trail. (The separate intelligence backend in `backend/` is stateful: it shares the SQLite database with the web app; see [data-model.md](data-model.md).)
2. **Deterministic where claimed.** Fixed parameters, no randomness (RANSAC is seeded), and the engine version in every response. Tests assert that the same input gives the same output.
3. **Advisory only.** Every result lands as *awaiting human review*. Nothing is accepted or rejected automatically, and nothing writes to a PLC. Connectors are read-only by design.
4. **Honest status.** Each service appears on the Integrations page and shows *Connected* only after a real call succeeds.
5. **Private by default.** Cloud Run services are deployed with `--no-allow-unauthenticated`. Next.js calls them with a Google-signed ID token, and only the App Hosting service account gets `roles/run.invoker`. No CORS: browsers never call Python directly.
6. **No retained media.** Frames are processed in memory, or in a temp file deleted right after. Nothing is stored and there is no face recognition.
7. **Shared contract.** The response shapes are mirrored in `src/domain/vision.ts`, with tests on both sides.

---

## Phase 1: Vision service ✅ built

Code: [`services/vision`](../services/vision). FastAPI 0.143, OpenCV 4.14, Python 3.13, locked with `uv`.

| Endpoint | What it measures |
|---|---|
| `GET /health` | Service and OpenCV version |
| `POST /v1/inspect/image` | **Image quality**: is the frame sharp, well exposed and contrasty enough to judge? **Codes**: QR and 1D barcodes decoded, with an *indicative* ISO/IEC 15416 symbol-contrast grade. **Golden comparison** (when a known-good `reference` image is sent): ORB features + RANSAC homography align the part, lighting is normalised, and regions that differ are returned as boxes in the uploaded image's coordinates. |
| `POST /v1/inspect/video` | Sampled frames (2 fps by default). A frame-differencing **motion timeline** with **still periods** (a possible line stoppage on a fixed camera), codes seen, and frame quality counts. |

Limits: 15 MB per image, 30 MB per video, 300 s of video analysed.

**How it plugs into the app**

- `POST /api/vision/inspect` (Next.js) forwards the upload, maps the result to review findings (`findingsFromInspection`), and stores a review that awaits disposition.
- **Visual Quality → Machine-vision check** uploads a part photo (optionally with a golden reference) or a clip. It draws the regions over the image, or shows the motion timeline for a clip.
- **Integrations → Vision service** reports *Not configured*, *Configured · not yet verified*, *Connected* or *Connection failed*, based on real calls.

**Tests:** 16 pytest (synthetic boards with a missing IC, a rotated and shifted part, lighting changes, QR/EAN-13, a video with a stoppage, API limits) and 2 Vitest (result mapping). The container image builds on `python:3.13-slim` with no extra system packages.

**Known limits:**
- This is classical machine vision, not a trained model. It finds *differences*; it does not say what the defect is.
- The golden comparison needs the same part type, a similar view and stable lighting. Glare or a different board revision will show up as differences.
- The barcode grade is indicative. A formal ISO/IEC 15416 grade needs a calibrated verifier (ISO/IEC 15426-1).
- OpenCV's 1D reader misses some codes, especially very tall or perfectly sharp synthetic ones.
- "Still" means no pixels changed. On a camera that also sees people, motion doesn't imply the line is running.

## Phase 2: Deploy to Cloud Run ✅ done

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project twin-ai

gcloud run deploy twin-vision \
  --source services/vision --region asia-southeast1 --project twin-ai \
  --no-allow-unauthenticated --cpu 1 --memory 1Gi \
  --concurrency 4 --min-instances 0 --max-instances 2 --timeout 150

gcloud run services add-iam-policy-binding twin-vision \
  --region asia-southeast1 --project twin-ai \
  --member serviceAccount:firebase-app-hosting-compute@twin-ai.iam.gserviceaccount.com \
  --role roles/run.invoker
```

Deployed 14 Oct 2026: `https://twin-vision-566093229758.asia-southeast1.run.app` (revision 1, `asia-southeast1`). A call without a token gets 403. Set the URL on **Integrations → Vision service → Configure** (admin; saved durably), or as `VISION_SERVICE_URL` in `apphosting.yaml`, then use **Test connection**.

The **CCTV control room** can run the video check on a camera's reference footage, so the OpenCV path is demonstrable on real video without uploads.

**Done when:**
- Integrations shows *Connected (verified)* on the live site.
- A golden comparison from Visual Quality on the live site returns boxes.
- Calling the service URL without a token returns 403.

**Cost:** it scales to zero and is billed per request; a demo's traffic is small. A cold start (loading OpenCV) adds a second or two to the first request. Set `--min-instances 1` only during judging, because an idle instance is billed.

## Phase 3: Live camera analytics (after the hackathon)

- **Viewing.** A MediaMTX gateway on the plant network pulls each camera's ONVIF/RTSP stream and republishes HLS over HTTPS. The camera live view already plays HLS (**Stream source** on any camera).
- **Analysing.** A Python edge worker samples frames from RTSP and runs the Phase 1 checks continuously. It publishes compact events (not video) to Pub/Sub, for example `{cameraId, kind: "still", startSec, …}`. Next.js turns them into camera detections and reviews.
- **Privacy.** Faces are blurred at the edge before anything leaves the plant, retention is set per camera, and live views stay audited.
- **Done when** a stoppage seen by a real camera appears in the twin within 10 s, and no frames leave the plant network.

## Phase 4: Industrial connectors (edge gateway)

- Add `services/edge-gateway` with OPC UA (`asyncua`), Modbus TCP (`pymodbus`) and MQTT (`aiomqtt`). A config maps tags to assets.
- It publishes normalised readings `{assetId, vibration, temperature, powerKw, ts}` to the Pub/Sub topic the app already ingests (`TELEMETRY_SOURCE=pubsub`).
- **Read-only by construction:** no write or command calls exist in the code. It runs on the plant network with outbound-only connections, not on Cloud Run.
- **Done when** one real asset's vibration drives the twin's health score and the maintenance agent's trend.

## Phase 5: Learned inspection and on-prem models

- **Defect model.**
  - Start with anomaly detection trained only on good parts (PatchCore or PaDiM via `anomalib`); no defect labels are needed.
  - Move to a supervised detector (e.g. YOLO) once labelled rejects exist.
  - Before trusting either, run an AIAG MSA attribute-agreement study against certified inspectors (κ ≥ 0.75 is a common bar).
  - Keep the golden comparison as a fallback.
- **Gemma on-prem** (vLLM or Ollama) behind the same narrative interface as the Muse models, with the same schema validation and numeric grounding check, for plants that can't use the cloud.
- **Forecasting.** Try statsmodels or scikit-learn models for time-to-trip. Replace the current OLS trend only if they beat it on held-out history.

## Out of scope

- Porting the plant engine, scenarios or agents to Python.
- Any write path to machines.
- Storing video in the cloud.

## Risks and open questions

| Risk | Mitigation |
|---|---|
| Two languages to maintain | Python only behind a narrow, tested HTTP contract; the engine stays in TypeScript |
| Cold starts on Cloud Run | Scale to zero normally; `min-instances 1` only during judging |
| Upload size (Cloud Run request limit 32 MB) | Service limits of 15 / 30 MB; long footage is analysed at the edge (Phase 3) |
| Golden images per product and revision | Store them in Cloud Storage under `golden/<productId>/<revision>/` and select them automatically by station (open question: who approves a new golden image?) |
| Over-trusting measurements | Every result awaits human disposition; MSA before tuning any threshold |

## Local development

```bash
# Vision service
cd services/vision
uv sync                                   # Python 3.13, locked deps
uv run pytest                             # 16 tests
uv run uvicorn app.main:app --port 8000   # API docs at http://localhost:8000/docs

# Web app (another terminal)
VISION_SERVICE_URL=http://localhost:8000 npm run dev
```

Or with Docker: `docker build -t twin-vision services/vision && docker run -p 8000:8080 twin-vision`.
