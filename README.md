# Twin AI — Agentic Industrial Digital Twin

> **Your factory. Reimagined before reality.**
> Create your factory's digital twin. Let AI understand its operations, predict what could go wrong, simulate better decisions, and help you act before losses happen.

Twin AI is a working MVP of an industrial digital-twin platform. It digitizes a factory as a live topology, ingests (simulated) telemetry, watches the line through inspection, thermal and CCTV cameras placed in the twin, runs six specialized AI agents that investigate incidents, compares alternative operating plans on a deterministic plant model, and applies the chosen plan to the twin only after human approval, with a full audit trail.

Operators can ask the **Twin Copilot**, a multi-agent system running natively on **Meta's Muse Spark** (Responses API function calling). Its specialist agents answer with figures from deterministic tools, and it can propose plans, but only for human approval. External agents can use the same tools through the built-in **MCP server**.

New users build their own twin with the **Twin Builder**: they give an agent their factory's drawing (or speak / type their requirements, or let **Muse Image** draw a plan), and it reads the layout with **Muse Spark** and **SAM 3.1**, researches standard setups with cited sources, and drafts a twin. The user reviews every element, with where each one came from, before a deterministic build ([design](docs/twin-builder.md)).

It ships with one complete scenario: an electronics plant with three lines where an assembly robot develops bearing damage just as a critical customer order is due and a key component is in short supply.

### Built on Meta's models

![Twin architecture](docs/architecture/twin-architecture.png)

| Meta model (Meta Model API) | What it does in Twin |
|---|---|
| **Muse Spark** (`muse-spark-1.3`) | Runs the multi-agent copilot (coordinator + 3 specialists, tool calling), reads blueprints, researches layouts with cited web search, drafts and edits twin specs, reviews inspection photos and frame sheets |
| **Muse Wonder** (`muse-wonder-1.0`) | Writes the orchestrator's decision briefing from simulated trade-offs; every figure is checked against the simulation |
| **SAM 3.1** (`sam-3.1`) | Segments every machine and conveyor footprint on an uploaded floor plan, and localises reported defects on inspection photos |
| **Muse Image** (`muse-image-1.0`) | Draws a floor plan from a plain-language description (describe → draw → segment → twin) and synthetic inspection test photos |
| **Muse Voice Transcribe** | Speech-to-twin: describe the plant out loud in the Twin Builder |

Language models never produce the numbers: every figure comes from the deterministic plant model, and model output is schema-validated, grounding-checked and approved by a person before anything changes.

### Built during the Meta Global AI Developer Hackathon

Twin builds on our earlier digital-twin engine: the deterministic plant model, simulator, agents, twin views, Playground and MCP server existed before the event. During the hackathon (Oct 26 – Nov 4, 2026) we:

- rebuilt the whole AI layer on **Meta Model API** (Responses API client with structured output, function tools and web search; the copilot is now a native multi-agent runtime on Muse Spark; decision briefings on Muse Wonder with Muse Spark fallback);
- added **SAM 3.1** equipment-footprint segmentation to the Twin Builder's blueprint reading and **SAM 3.1** defect localisation to visual reviews;
- added **Muse Image** floor-plan generation and synthetic inspection photos, and **Muse Voice Transcribe** speech-to-twin;
- moved the Python MCP agent to Muse Spark, rebuilt the Python backend's AI on Meta Model API (grounded Muse Spark copilots, Muse Wonder what-if and S&OP briefs, Muse Spark + SAM 3.1 optical inspection), and renamed the product to **Twin**.

---

## Contents

1. [Quick start](#quick-start)
2. [Judge walkthrough (5 minutes)](#judge-walkthrough-5-minutes)
3. [What is implemented](#what-is-implemented)
4. [Architecture](#architecture)
5. [How the numbers are produced](#how-the-numbers-are-produced)
6. [AI agents](#ai-agents)
7. [Visual quality and cameras](#visual-quality-and-cameras)
8. [Twin Builder](#twin-builder)
9. [Playground](#playground)
10. [Copilot and MCP](#copilot-and-mcp)
11. [API reference](#api-reference)
12. [Integrations (Meta Model API, optional Google Cloud)](#integrations)
13. [Manufacturing intelligence backend & feature domains](#manufacturing-intelligence-backend--feature-domains)
14. [Deploy (Firebase App Hosting or Cloud Run)](#deploy-to-firebase-app-hosting)
15. [Testing](#testing)
16. [Project structure](#project-structure)
17. [Known limitations](#known-limitations)

The full architecture and design document is [docs/architecture.md](docs/architecture.md).

---

## Quick start

Requirements: **Node.js ≥ 20.9** and npm. Without a key everything runs deterministically; add a Meta Model API key to turn on the Muse models.

```bash
npm install
cp .env.example .env.local   # then set MODEL_API_KEY (from https://dev.meta.ai)
npm run dev                  # http://localhost:3000
```

Production mode:

```bash
npm run build
npm start              # http://localhost:3000  (PORT=xxxx to change)
```

Open <http://localhost:3000> and click **Launch Factory Demo**.

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm test` | Vitest unit/integration tests for the domain logic (40 tests) |
| `npm run test:e2e` | Playwright end-to-end tests (starts `npm start` if no server is running; run `npm run build` first) |
| `npm run typecheck` | TypeScript strict type check |
| `npm run reset-demo` | Delete the SQLite database (`.data/`); the demo factory and backend demo data are re-seeded on next start |

The first Playwright run needs a browser: `npx playwright install chromium`.

Tip — to run a dev server next to a running production build without them overwriting each other:
`NEXT_DIST_DIR=.next-dev TWIN_DATA_DIR=.data-dev npx next dev -p 3001` (then `E2E_PORT=3001 npm run test:e2e`).

---

### Run the intelligence backend (Python)

Twin runs as two services that share one SQLite database (`.data/twin.db`): the web app above, and the **intelligence backend** (FastAPI), which serves the **Intelligence Backend** page: maintenance copilot, AOI inspection, supply chain, demand planning, operations copilots and their configuration. Start it in a second terminal:

```bash
python -m venv .venv && .venv/bin/pip install fastapi "uvicorn[standard]" pydantic-settings numpy httpx python-multipart
cp backend/.env.example backend/.env   # set MODEL_API_KEY for the Muse models
npm run backend                        # http://localhost:8000  (BACKEND_PORT=xxxx to change)
```

If it runs on another port or host, set **Integrations → Intelligence backend → Service URL** (or `INTELLIGENCE_BACKEND_URL`). The browser only talks to the web app, which proxies allow-listed `/api/backend/*` calls. If the backend is down, the rest of the app keeps working and the Intelligence Backend page says how to start it.

### Data & persistence

Everything is stored in **one SQLite database** shared by both backends: the factory twins in normalised tables (assets, telemetry, incidents, scenario runs, recommendations, audit…), integration settings with change history, per-browser preferences and drafts, copilot conversations, every Meta Model API call, and all backend entities, configurations and run history. The full table catalogue and API → table map is in **[docs/data-model.md](docs/data-model.md)**.

## Judge walkthrough (5 minutes)

The fastest path is **Demo controls → Run Factory Crisis Demo** (top-right). It resets the factory, injects joint-4 bearing damage on robot **A-ROB-03**, and opens a guided panel that walks through each step:

1. **Command Center**: a critical incident banner appears. OEE, output, health, energy, scrap, incidents, inventory shortages and delivery risk all come from the same state. Delivery risk shows **ORD-1042 ≈700 units short** if nothing is done (a model estimate).
2. **AI Operations**: six agents run a real workflow: OBSERVE → INVESTIGATE → PREDICT → SIMULATE → RECOMMEND → HUMAN APPROVAL. Each stage streams its actual results: anomalies found, per-agent findings with an evidence table, the method, inputs and confidence, the no-intervention forecast (trip at ≈h+16), and the ranked plans.
3. **What-If Simulator**: compares the reference plan with *Continue*, *Stop for preventive maintenance*, and *Reroute to Line B + maintain*. Move any lever (maintenance start or duration, robot speed, Line B allocation, MCU-7 usable stock, expediting, order quantity or priority, repair duration, energy price, idle draw) and every scenario recalculates instantly. Try dropping **MCU-7 usable stock** to 85% to watch the reroute plan go late, then toggle **Expedite PO-7781**.
4. **Digital Twin Studio**: the selected plan's production path is highlighted. A3 shows a maintenance window, Line B is marked as rerouted, packaging is downstream, and the critical order is on the path. Switch between **Topology**, **Isometric**, **Floor plan** and **3D** views. In 3D, drag to orbit, right-drag to pan and scroll to zoom; mobile robots (AMRs) carry kits from stores to each line and pallets to the dock, and park with a reason when their line stops. Click any machine, rack, truck or robot for live telemetry, diagnostics, history, dependencies, documents and fault-injection controls.
5. **Cameras and Visual Quality**: in the Isometric view, click the thermal camera **THM-A1** above robot A3. A card shows what the camera sees (A-ROB-03 running hot); **Watch live stream** opens the live view, and the access is written to the audit trail. **Visual Quality** shows Line A's AOI reject rate rising from ≈1.7% to ≈3.3%, tracking A-ROB-03 vibration (r ≈ 0.89). **Review last 60 units** lists each reject with its IPC-A-610 criterion and waits for you to confirm or dismiss it.
6. **Approvals**: review actions, evidence, benefits, risks, the impact table and rollback information. Approve it, then **Fast-forward 8 h**: Line B changes over, A-ROB-03 goes into maintenance, returns healthy, and the incident resolves itself.
7. **Audit Trail**: every alert, agent finding, scenario run, decision, simulated action and resulting state change is listed with links.
8. **Ask Copilot** (top bar): ask "Why is Line A rejecting more boards?" The coordinator delegates to the maintenance, quality and planning agents, and every tool call is shown. The answer is checked figure by figure against the tool results. Then say "propose the reroute plan for approval": the copilot pauses for your confirmation and creates a pending recommendation in Approvals.
9. **CCTV Control Room** (Admin): unlock admin, press **All to reference footage** to put real factory video on every camera (each clip credited and labelled *not this plant*), then run **Muse review** or the **OpenCV motion check** on a feed. The findings land in Visual Quality for a person to confirm.
10. **Twin Builder** (sidebar): describe another plant, for example "two PET bottling lines, case packer and palletizer, OPC UA on the fillers, 3 AMRs bringing preforms from the warehouse", or upload its drawing. Review the draft with provenance badges on every element, plan a data connection, and build. The new twin runs with the same agents, simulator and cameras. **Reset Demo** brings back the crisis factory.

**Reset Demo** (Demo controls) restores the exact initial state at any time.

---

## What is implemented

| Area | Status |
|---|---|
| Landing page: Apple-style scroll story — the isometric twin stays pinned while the scripted crisis unfolds (build → detect → investigate → simulate → approve → audit); every figure is computed by running the engine on that scenario | ✅ |
| Light / dark theme toggle (persisted, no flash on load) across the app and landing page | ✅ |
| **Twin Builder**: Muse Spark reads a blueprint (labels, lines, flow) while **SAM 3.1** segments each machine's footprint; Muse Spark researches standard layouts (Responses web search, cited) and drafts a twin spec. **Muse Voice Transcribe** turns spoken requirements into text; **Muse Image** can draw a floor plan from a description. The user reviews it with provenance on every element, edits directly or by chat, plans data connections and builds. Deterministic validation and compile; template mode without AI | ✅ Meta Model API |
| **Twin Copilot on Muse Spark**: coordinator + maintenance, quality and planning specialists (specialists exposed to the coordinator as tools) over 12 deterministic tools; a live tool trace; every figure checked against tool results; `propose_plan` behind a human confirmation gate (creates a pending recommendation only); conversation memory | ✅ Meta Model API |
| **MCP server** (`/api/mcp`, Streamable HTTP): the same 12 tools with read-only hints for any agent; a **Python Muse Spark agent** (`services/agents`) that operates the twin over MCP | ✅ |
| 16 machine archetypes across industries (CNC, mixer, oven, filler, molding, welding, palletizer, pump, manual station, extruder + the original 6), each with physics, sensors, failure mode, defect classes and a 3D shape; 7 industry templates | ✅ |
| Factory Command Center: OEE, target vs. actual, health distribution, energy, scrap, incidents, shortages, delivery risk, line status, events | ✅ |
| Digital Twin Studio: React Flow topology (lines, machines, sensors, inventory and order nodes; add, edit and connect assets; drag; zoom, pan and fit), an **isometric view** (extruded machines with status stack-lights, animated belts, warehouse racks and order trucks; rotate, zoom, pan, select), a 2D floor plan, and a **3D view** (three.js: orbit, pan, zoom, top view, focus, turntable) with a realistic look: concrete floor, cutaway walls and steel columns, painted work zones with safety tape, rounded machine enclosures with HMI panels, jointed robot arms with grippers inside safety fencing, conveyors with frames and rollers, pallet racking, and animated mobile robots. High quality adds ambient occlusion and bloom; Standard is chosen automatically on slow or GPU-less devices. All with scenario highlighting | ✅ |
| **Playground**: a sandbox copy of the twin on a floor plan. Drag machines and robots from a palette, move, rotate and delete them, wire the flow by dragging between machines, split lines, draw robot routes, and set rules for robot movements, connector actions, inventory and maintenance, by hand or with AI help. Undo/redo, live checks, a 3D preview compiled in the browser, and **Apply** rebuilds the live twin. Rules run inside the plant model (live and What-If) and never touch real equipment | ✅ |
| Mobile robots (AMRs, AGVs, automated forklifts, tuggers): created by the Twin Builder from your requirements or drawing (count, move, line), reviewable and editable; the demo plant has a derived kitting and pallet fleet. Trip rates follow line output and are shared across a fleet, and robots park with the reason when a line stops or a part runs out | ✅ |
| Asset management: search, filters, sort, detail sheet linked to the twin | ✅ |
| Live simulated telemetry (deterministic noise) with pause/resume and fast-forward | ✅ |
| Anomaly detection: OLS trend, change-point test, z-score, threshold proximity, excess-power check | ✅ |
| Six agents (including Quality Inspection) and a streamed orchestration workflow | ✅ |
| Cameras in the twin: area CCTV, AOI / final-inspection, radiometric thermal, dock and stores cameras in all three views (iso cameras show their field of view). Click one for a card with its current view and analytics, then open the live view (every opening is audited) | ✅ simulated feeds |
| Live view plays a real HLS / MP4 / MJPEG stream when a camera is pointed at a gateway URL (https only) | ✅ implemented; needs a gateway |
| Visual Quality: FPY, DPMO, rolled throughput yield, defect Pareto, hourly reject trend, vibration ↔ reject correlation, camera wall, standards and privacy panel | ✅ |
| Visual reviews: deterministic station-log review, Muse Spark review of uploaded clips (as frame sheets) or photos with **SAM 3.1 defect localisation**, Muse Image synthetic test photos, human confirm / dismiss | ✅ AI part needs `MODEL_API_KEY` |
| Python vision service (FastAPI + OpenCV): golden-board comparison with alignment, barcode/QR reading with an indicative grade, image quality, video stoppage detection; results drawn over the upload and stored as reviews | ✅ runs locally / in Docker; Cloud Run deploy is Phase 2 of [the plan](docs/python-services-plan.md) |
| What-if engine: baseline plus three alternatives plus a custom plan, 10+ adjustable parameters, comparison table, charts, timeline, assumptions | ✅ |
| Human approval: approve, reject, rollback, execution status, directive tracking | ✅ |
| Sustainability: energy per unit, by-line energy, idle waste, scrap, avoidable-waste estimates, scenario energy and waste | ✅ |
| Audit trail: category filters, search, cross-links, JSON export | ✅ |
| **Muse Wonder** writes the orchestrator's decision briefing (Muse Spark as fallback), with schema validation, timeout, numeric grounding check and deterministic fallback | ✅ needs `MODEL_API_KEY` |
| **SQLite system of record** shared by both services: normalised twin tables with change-only writes, settings and configuration history, per-browser preferences and drafts, copilot conversations, AI call log, run history ([data model](docs/data-model.md)) | ✅ |
| **Intelligence Backend page** (via `/api/backend` proxy): fleet risk, maintenance copilot in 7 languages, recommendation approval, AOI inspection with defect boxes and dispositions, supply-chain what-if and assistant, mitigation approval, S&OP brief, shift handover, alarm triage, editable feature configs with history, live data model | ✅ needs the backend running |
| BigQuery, Pub/Sub, Cloud Storage and MQTT adapters with real connectivity tests | ✅ implemented; need configuration |
| Dockerfile and Cloud Run deploy script | ✅ |

---

## Architecture

Twin is two services and one database ([diagram](docs/architecture/twin-architecture.png), [data model](docs/data-model.md)):

- **Web app — Next.js 15 (App Router, TypeScript).** Serves the UI and the `/api/*` JSON API and runs the deterministic plant engine, the six agents, the what-if simulator, the copilot, the Twin Builder and the MCP server. Proxies the browser's calls to the intelligence backend (`/api/backend/*`, allow-listed).
- **Intelligence backend — Python 3.12+ / FastAPI (`backend/`).** Predictive maintenance, AOI inspection, supply chain intelligence, demand forecasting and S&OP planning, and operations copilots, each a hexagonal feature module.
- **SQLite (`.data/twin.db`) — the system of record for both.** WAL mode lets both processes use the same file; each owns and migrates its tables (`schema_migrations`). No state lives only in the browser or in memory.
- **Meta Model API.** Muse Spark, Muse Wonder, SAM 3.1, Muse Image and Muse Voice Transcribe, called by both services. Every call is logged in `ai_calls`.
- **Optional:** the Python **vision service** (`services/vision`, FastAPI + OpenCV) for deterministic machine-vision checks, called server-to-server; BigQuery / Pub/Sub / Cloud Storage / MQTT adapters.

```
Browser (React 19, Tailwind 4, React Flow, Recharts, Zustand)
 │  ▲  state mirror · live tick every 4 s · NDJSON streams · preferences synced to the server
 ▼  │
Next.js route handlers (/api/*)               ← validate (zod) → domain command → persist
 │
 ├── src/domain/   pure, isomorphic, unit-tested business logic
 │     world.ts        plant model (the physics) — shared by live twin AND simulator
 │     telemetry.ts    live advance, measured readings, trend estimation, incidents
 │     simulation.ts   scenario engine, calibration, metrics, scoring, ranking
 │     agents/*        maintenance · production · supply · energy · quality · orchestrator · pipeline
 │     recommendations.ts, actions.ts (approve/reject/rollback), commands.ts, kpis.ts, seed.ts
 │
 ├── src/server/   server-only adapters
 │     db/             SQLite: normalised twin tables (change-only writes), settings + history,
 │                     per-browser preferences, copilot sessions, AI call log, migrations
 │     ai/             Meta Model API: llm.ts (Muse Spark / Wonder), meta-media.ts (SAM 3.1, Muse Image, Voice)
 │     copilot/        multi-agent copilot on Muse Spark function calling
 │     integrations/*  intelligence backend proxy · vision service · BigQuery · Pub/Sub · Cloud Storage · MQTT
 │
 ├──► /api/backend/* ──► backend/ (Python, FastAPI)
 │     core/db         SQLite layer: declared tables, write-through collections, configs + history, run history
 │     core/ai         Meta Model API client, grounded narration (figure check + deterministic fallback)
 │     features/*      predictive_maintenance · visual_quality_inspection · supply_chain_intelligence ·
 │                     demand_forecasting · production_optimization · waste_reduction · operational_copilots
 │
 ├──► services/vision (Python, optional)   FastAPI + OpenCV, called with a Google ID token on Cloud Run
 │
 └──► SQLite .data/twin.db  ◄── shared by the web app and the intelligence backend (83 tables)
```

**Single source of truth.** Each plant twin is one `FactoryState` aggregate (`src/domain/types.ts`): lines, assets, telemetry, production history, inventory, orders, work orders, directives, incidents, analyses, scenario runs, recommendations and audit. The engine works on it in memory; SQLite is its system of record, one table per collection, and only changed rows are written. The simulator and dashboard forecast run the *same* domain code client-side on a snapshot, so what-if sliders respond instantly, and the server recomputes whenever a run is recorded.

**Persistence.** Everything is in SQLite (`TWIN_DB_PATH` or `TWIN_DATA_DIR` to move it): factory twins, integration settings with change history, per-browser preferences and drafts (UI layout, simulator workbench, Twin Builder and Playground drafts, copilot view, theme), copilot conversations, every Meta Model API call, and all intelligence-backend entities, configurations and run history. `npm run reset-demo` deletes the database; the demo data is re-seeded on the next start. The full catalogue is in [docs/data-model.md](docs/data-model.md).

---

## How the numbers are produced

All metrics come from an explicit, deterministic **plant model** (`src/domain/world.ts`). Language models never produce numbers.

- **Machines in series**: a line runs at the minimum of its machines' capacity × commanded speed. Any machine that is down or in maintenance stops the line. Changeovers block the line for their duration.
- **Wear**: degradation grows at `slope × speed²` while producing. Temperature rises 2.4 °C per mm/s of excess vibration plus any thermal drift. Crossing the **trip** threshold causes an unplanned stop (default 16 h, $24k plus labor). Planned maintenance restores the baseline condition.
- **Quality**: scrap rises 1.2 points per mm/s of vibration above 60% of the alarm level.
- **Materials**: every started unit consumes its BOM. Production is capped by stock, and inbound POs arrive at their ETA.
- **Energy**: active power scales with speed, idle draw applies while waiting, lock-out draws 0 kW, and degraded machines draw extra power (friction).
- **Orders**: packaged units are allocated by priority, then due date. Late units are measured at the due time and charged the per-unit contract penalty.

**Scenario engine** (`src/domain/simulation.ts`):

1. Clone the live state into a simulation world.
2. **Calibrate each machine from telemetry**: OLS over 6 h of running readings with a change-point test. The engine never reads the hidden ground-truth degradation.
3. Turn plan levers into directives (maintenance window, line re-allocation, speed).
4. Run the plant model in 15-minute steps over the horizon.
5. Compute output, downtime, trip time, delivery, energy, scrap and a cost breakdown.
6. Score each plan against the healthy **reference plan**: delivery 40, cost 30, risk 20, sustainability 10. Plans that run the asset to a predicted trip are ranked last (asset-protection policy).

The same inputs always produce the same outputs, and tests verify this. Every scenario lists its assumptions, and the UI labels all results as estimates from demo data.

---

## AI agents

| Agent | Inputs | Method | Output |
|---|---|---|---|
| Predictive Maintenance | Telemetry history, thresholds, maintenance records, power | OLS trend, change-point test, z-score, extrapolated time-to-alarm and time-to-trip, trip probability from slope SE plus 25% model error | Findings with evidence tables, maintenance proposal, confidence from R², n and t |
| Production Optimization | Hourly production, capabilities, allocations, orders | OEE, bottleneck, schedule slack, alternate-line slack | Reroute feasibility and proposal |
| Supply Chain | Inventory, BOMs, inbound POs, scrap projection | BOM explosion, coverage hours, exhaustion vs. ETA, scrap sensitivity | Binding component, shortage risk, expedite options |
| Energy & Sustainability | Energy records, power signals | Intensity, idle share, excess draw, idle exposure of a trip | Standby and lock-out proposals (assumptions stated) |
| Quality Inspection | AOI and pack-out results (24 h), defect classes, hourly vibration | FPY, DPMO and Pareto per station; recent vs. earlier reject rate; OLS trend; Pearson correlation of each machine's vibration with its line's reject rate | Containment proposal (hold and re-inspect), root-cause corroboration, MSA validation before any threshold change |
| Operations Orchestrator | All reports plus simulated scenarios | Scenario generation, scoring, policy, explicit conflict resolution | Ranked plans, one recommendation for approval, narrative |

The workflow (`src/domain/agents/pipeline.ts`) runs on a frozen snapshot, so live telemetry can't change results mid-run. It streams each stage's real output to the UI as NDJSON. Small pauses between stages exist only so people can follow along; the computations themselves are real.

**Muse Wonder's role.** When configured, Muse Wonder writes the orchestrator briefing from structured facts (Muse Spark takes over if it fails). Its output must pass a JSON schema (zod) and a **numeric grounding check**: any figure of 10 or more that does not appear in the simulation outputs causes the narrative to be rejected and replaced by the deterministic version, with the reason shown.

---

## Visual quality and cameras

**Where the cameras are.** Every generated factory gets an area CCTV per line, an inspection camera on each AOI / final-inspection station, a radiometric thermal camera on the first robot cell, and cameras on the shipping dock and component stores (9 in the demo). They appear in the Topology (camera chips), Isometric (pole-mounted cameras with field-of-view wedges) and Floor plan views, and in the asset panel of every machine they cover.

**Card first, then live.** Clicking a camera opens a card with its current view and what its analytics report: units counted, lock-out zones, reject rate, hottest target, trailer loading or rack fill. **Watch live stream** opens the full view and logs who opened it. With no real camera connected, the feed is rendered from the live twin state and labelled *Twin feed*.

**CCTV control room (admin).** **Admin → CCTV Control Room** shows every camera on one wall and switches each one between three sources:
- **Twin feed**: rendered from the twin (the default).
- **Reference footage**: a looped, openly licensed clip of a comparable real factory. It is badged *Reference footage*, credited with its author and license, and always described as *not this plant*, in the UI, the audit trail and the copilot's camera tool. Run **Muse review** or the **OpenCV motion check** on it to demonstrate visual QA on real video; results wait for a person in Visual Quality.
- **Plant gateway**: an HLS, MP4 or MJPEG URL over HTTPS. Browsers can't play RTSP, so run a gateway on the plant network (for example MediaMTX) that pulls the camera's ONVIF / RTSP stream and republishes it as HLS.

Switching needs the admin passcode (see [Admin access](#admin-access)); every switch is audited.

**How inspection results are produced.** The plant model attributes every scrapped unit to a cause: the baseline process or a specific degraded machine. Each cause maps to the defect classes an inspection station would report, for example a worn placement robot produces misalignment, missing parts and tombstoning. Station metrics (FPY, DPMO, RTY, Pareto) and the per-unit pass/fail frames come from that attribution, so camera evidence always agrees with the twin. They are demo values, not a trained vision model.

**Standards used**

| Standard | Used for |
|---|---|
| IPC-A-610J, Class 2 (with IPC J-STD-001) | Acceptance criteria behind the assembly AOI defect classes |
| ISO/IEC 15416 / 15415 | Barcode print-quality grade at pack-out (below C fails) |
| ISO 18434-1 | Condition-monitoring thermography (THM-A1) |
| ONVIF Profile S / T | Camera streaming and metadata interoperability |
| AIAG MSA (attribute agreement) | Validate the inspection system before trusting or tuning reject limits |

**Muse Spark visual review + SAM 3.1.** Upload a clip or photo (MP4, WebM, MOV, JPEG, PNG or WebP, up to 15 MB), or generate a synthetic test photo with **Muse Image**. Muse Spark returns findings restricted to a fixed category list, with a JSON schema and zod validation; clips are sent as a sheet of frames captured in the browser. For photos, **SAM 3.1** then localises each reported defect category and the box is drawn over the image. Results are advisory: every review lands as *awaiting human review*, and nothing is accepted or rejected automatically. Without the key the upload is disabled and the API returns 503; the deterministic station-log review still works.

**Machine-vision check (Python service).** With the vision service running, **Visual Quality → Machine-vision check** takes a part photo and, optionally, a photo of a known-good part (the *golden reference*). The service aligns the two, normalises lighting and boxes every region that differs. It also reads barcodes and QR codes, rates whether the photo is sharp and lit well enough to judge, and finds still periods in a clip. These are deterministic OpenCV measurements, not a trained model. See [services/vision](services/vision/README.md).

**Safety and privacy.** Video analytics are not safety functions (IEC 61496 / ISO 13849) and never replace guarding or interlocks. Area cameras blur faces, footage has a fixed retention period, analytics are limited to stated purposes, and every live view is audited. This reflects how India's DPDP Act, 2023 treats workplace video as personal data.

---

## Twin Builder

Open **Twin Builder** (sidebar, or **Create your twin** on the landing page). Give it any of:
- a drawing (floor plan, process-flow diagram, P&ID, layout sketch or photo; PNG, JPEG, WebP or PDF)
- requirements in plain language
- a standard layout to start from

The agent then works in four stages, each streamed live:
1. **Read** recognises machines, lines and flow on the drawing.
2. **Research** finds how plants like yours are set up, with citations.
3. **Draft** proposes lines, machines, products, materials, data connections and any mobile robots (AMRs, AGVs, automated forklifts, tuggers) you describe.
4. **Validate** runs deterministic checks.

**Review before build.** Every element shows where it came from: *blueprint*, *your requirement*, *cited source*, *template*, *assumption* or *your edit*. The model can only use the 16 known machine archetypes and may only state numbers that you, the drawing or a cited source provide. A claim it can't back is downgraded to *assumption*.

You can edit lines, machines, rates, products, robots and connections directly, or ask the agent ("add a second filler at 6,000 bottles/h", "make it 4 AMRs"). Its changes are applied as validated operations. **Build my digital twin** compiles the reviewed spec deterministically, with the same engine as the demo. The defaults it applies are recorded in the audit trail.

**Without AI** (no `MODEL_API_KEY`) the builder says so, matches your description to one of 7 industry templates by keywords, and the review and build work the same way.

**Connections.** Plan data connections per line or machine: Pub/Sub and camera streams work today; OPC UA, Modbus and MQTT are planned through an edge gateway. The Integrations page lists them as planned until they are verified.

Design, guarantees and limits: [docs/twin-builder.md](docs/twin-builder.md).

## Playground

Open **Playground** in the sidebar. It starts from a copy of the live twin (the demo plant is read back into an editable spec), or from any of the 7 templates. Nothing changes in the live twin until you press **Apply to twin**; the draft is kept in your browser.

- **Place.** Drag a machine or a robot fleet from the palette onto the floor. Dropped inside a line's bay, a machine joins that line before or after its nearest neighbour; dropped on empty floor, it starts a new process line. Clicking a palette item adds it after the selected machine instead.
- **Move, rotate, delete.** Drag machines anywhere (positions snap to 0.25 units, about 0.5 m), press **R** to rotate 90°, **Delete** to remove, **Ctrl/⌘ Z** to undo. The first hand placement pins every machine where the automatic layout had it, so nothing else jumps.
- **Wire the flow.** Drag from a machine's output port to the machine that should come next; select a conveyor to split the line there. Conveyors are drawn straight or L-shaped between hand-placed machines, and each process line merges into the side of the packing line.
- **Rules.** All four kinds run in the plant model every step, in the live twin and in What-If runs:
  - *Robot movements:* per fleet, trips either follow line output or run on a fixed schedule (every N minutes), with an optional drawn route.
  - *Connector actions:* when a line stops, another line takes over its work (re-allocation, with a changeover); when packing stops or the buffer before packing reaches a limit, the line slows down or pauses, and resumes when the buffer has drained to 80% of the limit.
  - *Inventory triggers:* when stock plus open orders falls below a level (default: the reorder point), a purchase order is placed in whole lots and arrives after the material's lead time.
  - *Maintenance rules:* when a machine's health falls below, or vibration rises above, a limit, the rule simulates the options and creates a **pending** preventive-maintenance recommendation (once per crossing). A person still approves it.
- **AI help.** Describe a change in plain words; the AI proposes the same validated edit operations the canvas uses, and every change can be undone. When AI is off, the panel says so and everything still works by hand.
- **Checks and preview.** Validation runs on every edit (missing references, overlapping machines, rules that can't fire), and the **3D preview** compiles the draft in the browser with the same deterministic compiler that Apply uses.

Every rule action is written to the audit trail as *Automation rule*.

## Copilot and MCP

**Copilot.** Click **Ask Copilot** in the top bar. It's a native multi-agent runtime on Meta's Muse Spark (Responses API function calling), running inside the app:
- **Agents.** A coordinator delegates to three specialist agents: maintenance, quality and planning.
- **Tools.** 12 deterministic Twin tools: plant overview, assets, diagnosis, incidents, orders, inventory, what-if simulation, quality, camera views, audit search, the latest analysis, and plan proposals.
- **Transparency.** Every tool call is shown above the answer.
- **Grounding.** Every figure in the answer is checked against the tool results, and figures that can't be traced are flagged.
- **Proposals.** The copilot can't approve or run anything. **propose_plan** pauses for your confirmation and then creates a *pending* recommendation that a person approves in Approvals.

**MCP.** `POST /api/mcp` serves the same tools over the Model Context Protocol (Streamable HTTP), so any agent can operate the twin: the Python Muse Spark agent, Claude Code or an IDE. Read tools carry `readOnlyHint`. Set `TWIN_MCP_TOKEN` to require a bearer token. For example, add an HTTP MCP server pointing to `https://<your-host>/api/mcp`.

**Python MCP agent.** `services/agents` is a separate Python agent on Muse Spark that reaches Twin only through MCP:

```bash
cd services/agents
cp twin_mcp_agent/.env.example twin_mcp_agent/.env   # MODEL_API_KEY, META_MODEL, MCP URL
uv sync && uv run python ask.py "Which machine is most at risk right now?"
```

Design details: [docs/architecture.md § 7](docs/architecture.md#7-agentic-layers).

---

## API reference

`GET /api` returns the endpoint list. The main operations:

| Method & path | Description |
|---|---|
| `GET /api/health` | Health and persistence info |
| `GET /api/factory` · `POST /api/factory` | Fetch state · create a twin from a blueprint |
| `POST /api/factory/reset` · `POST /api/demo/crisis` | Restore the demo · load the scripted crisis |
| `POST /api/telemetry/tick` · `POST /api/telemetry/live` · `POST /api/sim/advance` | Live tick (throttled) · start/stop · fast-forward `{hours}` |
| `GET/POST /api/assets` · `PATCH /api/assets/:id` · `GET /api/assets/:id/telemetry` | Assets · update · telemetry with diagnostics |
| `POST /api/connections` · `POST /api/faults` · `GET /api/anomalies` | Dependencies · fault injection · anomaly detection |
| `POST /api/agents/analyze` | Multi-agent investigation (NDJSON stream; `?fast=1` skips pacing) |
| `POST /api/scenarios` · `POST /api/scenarios/compare` | Run and record · stateless comparison |
| `GET/POST /api/recommendations` · `POST /api/recommendations/:id/{approve,reject,rollback}` | Recommendations and decisions |
| `GET /api/audit` · `GET /api/kpis` · `GET /api/integrations` · `POST /api/integrations/test` | Audit, KPIs, integration status (with each setting's source) and tests |
| `PUT /api/integrations/settings` | Change integration settings (admin): `{values: {KEY: "value" \| "" \| null}}`; `""` turns a setting off, `null` returns it to the deployment value |
| `GET/POST/DELETE /api/admin/session` | Admin status · unlock with `{passcode}` (sets an httpOnly cookie) · lock |
| `GET /api/documents?assetId=` · `GET /api/documents/:id` | Asset documents |
| `GET /api/cameras` · `PATCH /api/cameras/:id` · `POST /api/cameras/streams` · `POST /api/cameras/:id/view` | Cameras with their current views · set a camera's source (admin): `simulated`, `footage` + `clipId`, or an https gateway URL · switch several at once (admin) · log a live view |
| `POST /api/cameras/:id/analyze` | Visual QA on the camera's reference footage: `{engine: "ai" \| "opencv"}` |
| `GET /api/quality` | FPY, DPMO, RTY, Pareto and correlations (24 h) |
| `POST /api/vision/review-log` · `POST /api/vision/analyze` · `PATCH /api/vision/reviews/:id` · `POST /api/vision/sample` | Station-log review · Muse Spark (+ SAM 3.1) review of an uploaded file (multipart `file`, optional `cameraId`) · confirm or dismiss · Muse Image synthetic test photo |
| `GET /api/copilot` · `POST /api/copilot` | Copilot info · one multi-agent turn on Muse Spark (`{sessionId, message}` or `{sessionId, confirm}`), streamed as NDJSON |
| `POST /api/mcp` | MCP server (Streamable HTTP, stateless): `initialize`, `tools/list`, `tools/call` for the 12 Twin tools |
| `GET /api/builder` · `POST /api/builder/draft` · `POST /api/builder/refine` · `POST /api/builder/validate` · `POST /api/builder/build` | Twin Builder: capabilities and templates · agent draft (multipart, NDJSON stream) · chat edits · deterministic validation · build from a reviewed spec |
| `POST /api/vision/inspect` | Machine-vision check on the Python service (multipart `file` image or video, optional `reference` golden image and `cameraId`) |

Inputs are validated with zod. Errors return `{ error, issues? }` with 400, 401 (admin required), 404 or 409 status codes.

```bash
curl -s -X POST localhost:3000/api/demo/crisis >/dev/null
curl -s -X POST "localhost:3000/api/agents/analyze?fast=1" | tail -n 2
curl -s localhost:3000/api/kpis | jq .kpis.oee
```

---

## Integrations

Everything works **without credentials**. Turn integrations on from **Admin → Integrations → Configure** (admin): enter the service's URL, dataset, bucket or token and press **Test connection**, no redeploy needed. A value saved there overrides the environment variable of the same name (`.env.example`, `apphosting.yaml`), which remains the deployment default; secrets (Meta Model API key, MCP token) are write-only. Saved settings live in a private Cloud Storage bucket (`TWIN_CONFIG_BUCKET`), or in `.data/settings.json` locally. The **Integrations** page reports status honestly:

- **Active · simulated/local**: a local implementation is in use.
- **Not configured**: required environment variables are missing.
- **Configured · not yet verified**: variables are set but no call has succeeded yet.
- **Connected (verified)**: shown only after a real API call succeeded.
- **Connection failed**: the error is shown.

| Service | What it does here | Required configuration |
|---|---|---|
| **Meta Model API** | Muse Wonder decision briefings; Muse Spark for the multi-agent copilot (coordinator + specialists), the Twin Builder (drawings, cited web research, drafting, chat edits) and footage review; SAM 3.1 for floor-plan footprints and defect localisation; Muse Image for floor plans and test photos; Muse Voice Transcribe for speech-to-twin. Video is reviewed as frames captured in the browser. **Turn AI off** there to stop all AI spending. | `MODEL_API_KEY` (plus optional `META_MODEL`, `META_REASONING_MODEL`) |
| **BigQuery** | Mirrors scenario outcomes and decisions; schema for telemetry, production and health history | `BIGQUERY_DATASET`, then create tables with `infra/bigquery/schema.sql` |
| **Pub/Sub** | Telemetry ingestion: `{assetId, vibration, temperature, powerKw}` messages override simulated measurements | `PUBSUB_TELEMETRY_SUBSCRIPTION`, `TELEMETRY_SOURCE=pubsub` |
| **Cloud Storage** | Per-asset documents under `assets/<assetId>/` | `GCS_BUCKET` |
| **Cloud Run** | Hosting (detected via `K_SERVICE`) | See below |
| **Vision service** (Cloud Run, Python) | OpenCV checks behind `POST /api/vision/inspect` and the control room's motion check | Service URL (deployed privately as `twin-vision`); the web app's service account has `roles/run.invoker` ([plan, Phase 2](docs/python-services-plan.md#phase-2-deploy-to-cloud-run--done)) |
| **MCP server** | External agents use the twin's tools at `/api/mcp` | Optional access token, or turn the endpoint off |
| MQTT | TCP reachability probe only | Broker URL |

### Admin access

Camera sources and integration settings need an admin session. On App Hosting the passcode is the Secret Manager secret `twin-admin-key` (mapped to `TWIN_ADMIN_KEY`):

```bash
gcloud secrets versions access latest --secret twin-admin-key --project twin-ai   # read it
firebase apphosting:secrets:set twin-admin-key --project twin-ai                    # rotate it, then roll out
```

Unlock with **Unlock admin** on the control room or Integrations page; the session lasts 8 hours. Without a passcode, admin is open in local development and disabled on Cloud Run.

> **Model note.** Defaults are `muse-spark-1.3` (agents) and `muse-wonder-1.0` (briefings); change them with `META_MODEL` / `META_REASONING_MODEL` or in Integrations. SAM 3.1, Muse Image and Muse Voice Transcribe use `sam-3.1`, `muse-image-1.0` and `muse-voice-transcribe-1.0`.

Use **Integrations → Test connection** to verify each configured service.

---

## Manufacturing intelligence backend & feature domains

Twin includes an enterprise-grade, Hexagonal/DDD Python backend ([`backend/`](backend/README.md)) running on **Python 3.12+ / FastAPI**, with all AI on **Meta Model API** (`backend/core/ai`: Muse Spark, Muse Wonder, SAM 3.1, Muse Image; grounded, with deterministic fallbacks) and optional lakehouse adapters (BigQuery, Pub/Sub, object storage), with interactive Streamlit operations cockpits ([`dashboard/`](dashboard/README.md)).

Each intelligence domain is independently designed, fully documented, and backed by automated test suites:

| Intelligence Domain | Capabilities & Mathematical Foundations | Documentation & Specs |
|---|---|---|
| **Predictive Maintenance & ROI Intelligence** | ISO 10816-3 vibration severity classification, RUL Weibull hazard rates, bearing fault FFT spectral tracking, `fact_roi_ledger` financial tracking, a local versioned model registry, and a **Muse Spark** maintenance copilot (any language) grounded in RAG incident retrieval with a figure-level grounding check. | [📘 Predictive Maintenance README](backend/features/predictive_maintenance/README.md) |
| **Supply Chain Intelligence** | End-to-end supply chain ontology (Supplier → Part → PO → Shipment → Warehouse → Plant → Order), multi-factor delivery risk scoring, BOM downstream disruption propagation, plant operational vulnerability rankings, line starvation countdown ($TTD$), a grounded **Muse Spark** assistant and **Muse Wonder** what-if briefings. | [📘 Supply Chain Intelligence README](backend/features/supply_chain_intelligence/README.md) |
| **Demand Forecasting & Operations Planning** | Multi-horizon probabilistic forecasting ($P_{10}, P_{50}, P_{90}$) evaluating champion GBDT vs Seasonal-Naive baseline ($s=7$), out-of-time chronological validation (MAE, RMSE, WAPE, Bias, MAPE), constraint-aware production planning ($\text{Net} = \max(0, \text{Demand} + \text{SafetyStock} - \text{UsableStock} - \text{ConfirmedSupply}) / (1 - \text{Scrap})$), scheduled maintenance downtime deductions, DOI/ROP inventory optimization, and What-If scenario simulations. Muse Wonder writes a grounded S&OP planning brief from the plan, bottlenecks and stock-out risks. | [📘 Demand Forecasting README](backend/features/demand_forecasting/README.md) |
| **Production Optimization** | Real-time Overall Equipment Effectiveness ($\text{OEE} = \text{Availability} \times \text{Performance} \times \text{Quality}$), Theory of Constraints bottleneck station identification, and Little's Law throughput pacing ($\text{WIP} = \text{TH} \times \text{CT}$). | [📘 Production Optimization README](backend/features/production_optimization/README.md) |
| **Visual Quality Inspection** | Automated Optical Inspection (AOI): **Muse Spark** IPC-A-610 Class 2 defect classification with **SAM 3.1** pixel localisation, Muse Spark serial reading, OpenCV golden template alignment, a deterministic verdict engine, grounded advisory root cause, First-Pass Yield (FPY), DPMO and detector precision from human dispositions. | [📘 Visual Quality README](backend/features/visual_quality_inspection/README.md) |
| **Waste Reduction & Sustainability** | Machine idle friction energy losses, scrap root-cause attribution, and unit-level Scope 1 & Scope 2 greenhouse gas (GHG) carbon accounting. | [📘 Waste Reduction README](backend/features/waste_reduction/README.md) |
| **Operational Copilots** | Natural language standard operating procedure (SOP) guidance, OSHA Lockout/Tagout (LOTO) safety protocols, **Muse Spark** shift-handover briefings, and PLC alarm triage grounded in the maintenance manuals. | [📘 Operational Copilots README](backend/features/operational_copilots/README.md) |

### Architecture diagrams

| Domain | Diagram |
|---|---|
| Whole platform | [twin-architecture.png](docs/architecture/twin-architecture.png) |
| Predictive maintenance & copilot | [predictive-maintenance.png](docs/architecture/predictive-maintenance.png) |
| Visual quality inspection (AOI) | [visual-quality-inspection.png](docs/architecture/visual-quality-inspection.png) |
| Supply chain intelligence | [supply-chain-intelligence.png](docs/architecture/supply-chain-intelligence.png) |
| Demand forecasting & S&OP | [demand-forecasting.png](docs/architecture/demand-forecasting.png) |

Sources are in `docs/architecture/src` (`python docs/architecture/src/build_diagrams.py`, then render with Playwright via `src/render.mjs`).

### Supporting Backend Subsystems & Specifications:
- **[Hexagonal Backend Architecture & DI Container](backend/README.md)**: Ports and adapters blueprint, SOLID principles, and REST/WebSocket entrypoint.
- **[Feature Modules Overview](backend/features/README.md)**: Standardized hexagonal directory structure and domain guidelines.
- **[Industrial BigQuery Lakehouse DDL](backend/sql/demand_forecasting_lakehouse_schema.sql)**: Production lakehouse DDL with 18 time-partitioned and clustered tables.
- **[Streamlit Operations Cockpits](dashboard/README.md)**: Multi-page operations dashboard for live production, inventory, and forecasting.
- **[Infrastructure as Code (Terraform)](infra/terraform/demand_forecasting.tf)**: optional Terraform for the data adapters and hosting (BigQuery, object storage, Pub/Sub, Cloud Run, Scheduler); no cloud AI services.

---

## Deploy to Firebase App Hosting

The repo is configured for [Firebase App Hosting](https://firebase.google.com/docs/app-hosting) (Next.js on Cloud Run, managed by Firebase). The project needs the **Blaze** plan.

- `apphosting.yaml`: runtime settings. **`maxInstances: 1`**, because the SQLite database lives on the instance (`/tmp`); a multi-instance deployment needs a shared database (see Known limitations). App Hosting deploys the web app only; run the intelligence backend next to it (same host and database file) or point `INTELLIGENCE_BACKEND_URL` at it.
- `.firebaserc` / `firebase.json`: default project `twin-ai`, backend `twin` (region `asia-southeast1`).

Deploy the current local source:

```bash
firebase deploy --only apphosting --project twin-ai
```

To deploy automatically on every push to `main`, connect the GitHub repository to the backend: Firebase console → **App Hosting** → `twin` → **Settings → Deployment** → connect `The-OWLabs/twin-ai`, live branch `main`, root directory `/`.

**Cost.** App Hosting bills the underlying Cloud Build, Cloud Run, Artifact Registry and bandwidth usage. Light demo traffic stays inside Blaze's monthly no-cost allowances. Each open dashboard tab polls telemetry every 4 s, roughly 45 MB/hour of bandwidth against a 10 GiB free allowance. Set a budget alert in Cloud Billing.

## Deploy to Cloud Run

```bash
export GOOGLE_CLOUD_PROJECT=my-project
export REGION=us-central1                 # optional
# optional: BIGQUERY_DATASET, GCS_BUCKET, PUBSUB_TELEMETRY_SUBSCRIPTION, META_MODEL, META_REASONING_MODEL (MODEL_API_KEY comes from Secret Manager: twin-model-api-key)
./infra/cloudrun/deploy.sh
```

The script enables the required APIs and creates a least-privilege runtime service account with these roles: `secretmanager.secretAccessor` (for the Meta Model API key), `bigquery.dataEditor`, `bigquery.jobUser`, `pubsub.subscriber` and `storage.objectViewer`. It then builds from the `Dockerfile` (multi-stage, Node 22, standalone output) and deploys with **`--max-instances 1`**, because the SQLite database lives in the instance (deploys the web app; run the intelligence backend alongside it).

> **Security note.** The script deploys a **public, unauthenticated** service so judges can open it. The app has no user authentication. Anyone with the URL can reset the demo or approve plans (simulated only). Remove `--allow-unauthenticated` or put the service behind IAP for anything beyond a demo.

Local container:

```bash
docker build -t twin-ai .
docker run -p 8080:8080 twin-ai     # http://localhost:8080
```

---

## Testing

```bash
npm test               # 132 Vitest tests (web app)
npm run test:backend   # 75 pytest tests (intelligence backend)
npm run build && npm run test:e2e   # 18 Playwright tests against the production server
cd services/vision && uv run pytest # 16 pytest tests for the Python vision service
```

- **Unit and integration tests** (`tests/`, 132 tests; `tests/db.test.ts` covers the SQLite data model: exact round-trips, change-only writes, typed queries, cascades, legacy import, preferences, copilot sessions and the AI call log), including a check that the landing story's figures are engine-derived:
  - seed reproducibility and entity counts
  - health and status rules, OLS and trend estimation, change-point detection
  - KPIs
  - scenario outcomes for all plans, ranking, determinism and calibration
  - **parameter sensitivity**: maintenance duration, derating, repair duration, reroute allocation, MCU-7 availability with and without expediting, order quantity, energy price, idle factor, horizon
  - infeasible reroute
  - the agent pipeline's stage order, evidence and recommendation
  - approval execution through to completion, rejection, double-approval guard and rollback
  - commands (add, edit and connect assets; forced trip)
  - the LLM grounding check and deterministic fallback
  - visual quality: scrap fully attributed to causes, FPY / Pareto consistency, the robot ↔ AOI correlation in the crisis, deterministic inspection frames, thermal readings matching the twin
  - cameras: https-only stream URLs, audited live views, station-log reviews and the human disposition guard
  - mapping of vision-service results to review findings
  - Twin Builder: every template validates cleanly, builds, simulates and runs the six-agent analysis; deterministic builds; industry-appropriate defect classes; validation repairs and errors; and the agent workflow with recorded model responses (blueprint links, citation filtering, unsupported machine types, fallbacks, and chat edits as validated operations). The demo factory is checked byte-identical after the generator refactor.
- **Admin and settings** (`tests/admin.test.ts`): signed admin cookies (expiry, tampering, passcode rotation, rate limit); settings overriding the environment, turning off and returning to the deployment value; never overwriting saved settings that could not be read from Cloud Storage; validation (https only, no metadata host); secrets never returned; settings driving the AI and vision adapters; camera source switching with audit; every footage clip shipped with its file, poster and license; stock-outs reported once.
- **Playground and rules** (`tests/playground-rules.test.ts`): placing, connecting, splitting and deleting machines, with rules that lose their target removed; validation of rules that can't work; inventory triggers ordering whole lots once; a line taking over a stopped line's work and handing it back after the repair; pausing a line while the buffer before packing is full and resuming it after it drains; maintenance rules proposing once per crossing without scheduling anything; What-If runs using the same rules without touching the live plant.
- **Meta Model API** (`tests/ai-providers.test.ts`, recorded responses, no network): configuration and missing key; Responses API JSON with images, bearer key and reasoning effort; Muse Wonder for the reasoning tier; web search citations from `url_citation` annotations; refusal of video and PDFs; the schema-dialect retry; the copilot runtime delegating to specialists, executing tools and pausing `propose_plan` for confirmation. `tests/segmentation.test.ts`: SAM 3.1 box-token parsing and merging footprints into a blueprint reading.
- **Agent tools** (`tests/tools.test.ts`): every read tool leaves the twin unchanged; what-if matches the engine; the proposal only creates a pending recommendation; invalid arguments are rejected; no tool can approve, execute or command equipment; numeric grounding of answers.
- **Python vision service** (`services/vision/tests`, 16 tests, synthetic media): a missing IC found where it should be, a rotated and shifted part aligned, lighting changes ignored, QR and EAN-13 decoding with grades, deterministic output, a video stoppage found at the right time, and API limits.
- **End-to-end tests** (`e2e/`, 16 tests): the playground (drag from the palette, delete and undo, connect by dragging between machines, add rules, apply to the live twin); the phone notice and continuing past it; the 3D view rendering with mobile robots and layer toggles; Twin Builder robots from the requirements through review to the built twin; the CCTV control room switching all cameras to reference footage and back (audited, served as video/mp4); integration settings saved from the UI and returned to the deployment value; MCP protocol (initialize, tools/list with read-only hints, tools/call, errors); the Muse Spark copilot giving a grounded answer with a tool trace (when MODEL_API_KEY is set); Twin Builder from description to built twin with a planned connection; camera card → audited live view → Visual Quality review confirmed by a person; camera API validation and honest AI status; isometric selection and rotation, theme persistence, every landing-story chapter appearing on scroll; every page renders with no console errors; the full guided crisis demo (incident → agents → scenario sensitivity → twin highlight → approval → fast-forward → audit); reset reproducibility; API validation.

---

## Project structure

```
src/
  app/                 routes: landing, onboarding, (platform)/{dashboard,twin,playground,assets,quality,agents,simulator,approvals,sustainability,audit,control-room,integrations}, api/*
  components/          ui primitives, shell, theme toggle, dashboard, twin (graph, nodes, canvas, floor view), iso (isometric renderer),
                       assets, agents, simulator, vision (camera feeds, camera card, live view, reviews), landing (scroll story),
                       playground (floor plan, palette, inspector, rules, AI help, 3D preview), three (3D view)
  client/              API client, Zustand stores (factory, UI prefs, simulator workbench), hooks
  domain/              plant model (with inventory and connector rules), telemetry, simulation, agents, quality, vision,
                       archetypes, rules (maintenance rules), builder/ (spec, validation, compile, templates, edit
                       operations, agent workflow, spec from a running twin), tools/ (agent tool layer, grounding),
                       recommendations, actions, KPIs, seed
  server/              persistence, AI provider, integrations, documents, request schemas
backend/               Enterprise Hexagonal Python backend (FastAPI, BigQuery Lakehouse, ML models)
  core/                Cross-cutting abstractions, DI container, event bus
  connectors/          Industrial OT (OPC UA, MQTT, Modbus) and IT bridges
  mcp/                 Model Context Protocol (MCP) server & tool definitions
  rag/                 Industrial hybrid RAG & knowledge graph engine
  features/            7 domain intelligence platforms with dedicated sub-READMEs:
    predictive_maintenance/    RUL estimation, ISO 10816, fact_roi_ledger, Muse Spark copilot
    supply_chain_intelligence/ Disruption tracer, line starvation (TTD), plant vulnerability
    demand_forecasting/        Multi-horizon ML forecasting, constraint planning, BigQuery lakehouse
    production_optimization/   OEE analysis, bottleneck detection, Little's Law pacing
    visual_quality_inspection/ AOI, OpenCV golden template alignment, IPC-A-610 grading
    waste_reduction/           Scrap causal attribution, machine friction, Scope 1 & 2 carbon
    operational_copilots/      Digital SOP conversational guidance, LOTO protocols, shift handover
dashboard/             Streamlit manufacturing operations cockpits
services/vision/       Python vision service (FastAPI + OpenCV), tests, Dockerfile
services/agents/       Python Muse Spark agent that operates the twin over MCP
docs/                  architecture.md, twin-builder.md, python-services-plan.md
content/docs/          demo maintenance manuals and procedures (fictional)
infra/                 Terraform scripts (GCP BigQuery, Pub/Sub, Cloud Run), schemas, deploy scripts
tests/ e2e/            Vitest, Playwright, and Pytest suites
```

---

## Known limitations

- **Simulated plant.** All telemetry, production and costs come from a deterministic model with fictional demo data. Results are estimates, not validated forecasts.
- **No real cameras in the demo.** Camera feeds are rendered from the twin, or play reference footage of other factories, which is labelled as such. Inspection results come from the plant model's scrap attribution, not a trained vision model, and are not derived from the footage. Real streams need a plant-side gateway (HLS / MP4 / MJPEG over HTTPS). Muse Spark footage review and SAM 3.1 localisation are advisory and unvalidated; run an attribute-agreement study before relying on them. Muse Image test photos are synthetic and labelled as such.
- **No real equipment control.** Approval changes only the digital twin. The platform never writes to PLCs or commands machines; that would need a separately authenticated, authorized and safety-validated integration.
- **Two demo datasets.** The intelligence backend has its own demo plants (Bangalore, Stuttgart, Detroit) and machines; they are not the same plant as the web app's twin. Both live in the same database but are not linked yet.
- **One database file, one host.** Both services share one SQLite file, so they must run on the same machine (or share a volume), and a serverless deployment keeps it in the instance's `/tmp` (hence max-instances 1; state resets when the instance is recycled). Tables are keyed by facility and use plain SQL, so moving to a server database (Cloud SQL / PostgreSQL) is a driver change rather than a redesign.
- **No per-user login.** Configuration changes (camera sources, integration settings) need the admin passcode; everything else is open to anyone with the URL.
- **Mobile robots are simulated.** Fleets come from the Twin Builder spec (the demo plant has a derived kitting and pallet fleet); missions and trip rates follow the plant model; no fleet manager is connected (a VDA 5050 or vendor-API adapter would supply real positions). The 3D animation runs at real speed while the plant clock runs 30× faster.
- **No automatic re-ordering in the demo plant.** Its parts without an open purchase order run out after about 55–61 hours of plant time (about 2 hours of an open tab after a reset), and the lines starve. Use **Reset Demo**, or add inventory rules in the Playground and apply them.
- **Playground limits.** Machines on a line still run in series in the model, whatever their positions; positions and conveyor shapes are visual. Rules act on the simulation only. A connector rule watches the line and the buffer before packing; there are no buffers between machines.
- **Cloud adapters are not verified against live services in this build.** BigQuery, Pub/Sub and Cloud Storage calls are implemented and are exercised only when configured. MQTT is a reachability probe; subscription is not implemented.
- **Twin Builder limits.** Machines on a line run in series, with up to 4 process lines plus one packing area and 8 machines per line. Parallel or batch steps are approximated. Default rates, prices, stock and the sample orders are typical values until real systems are connected. Drawings must be images (PNG, JPEG, WebP); export PDFs as images. Without `MODEL_API_KEY`, template mode is used.
- **Time model.** Live telemetry advances 2 minutes of plant time every 4 seconds while the app is open in a visible tab. Fast-forward runs the same model in larger jumps.
- **Desktop-first.** On phones, the demo and the Twin Builder open with a full-page notice that Twin is best viewed on a computer, with **Continue on this device** (remembered for the session) and a link to send to a computer. Pages still work on phones (no horizontal page scrolling), but the twin canvas and wide tables are best on a laptop or larger screen.
