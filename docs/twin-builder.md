# Twin Builder

**Status (Nov 2026):** runs on Meta Model API: Muse Spark reads, researches, drafts and edits; SAM 3.1 segments equipment footprints; Muse Image can draw a plan from a description; Muse Voice Transcribe takes spoken requirements. Template mode remains the fallback when AI is unavailable.

New users build their own digital twin by giving the agent what they have:
- a drawing of the plant: floor plan, process-flow diagram, P&ID, equipment layout, hand sketch or photo
- requirements in plain language
- optionally, a standard layout to start from

The agent does most of the work: it reads the drawing, researches how plants like it are set up, and drafts the twin. The user reviews every element, sees where each one came from, edits it directly or by chatting with the agent, plans data connections, and builds. Open it at **/onboarding** or from **Twin Builder** in the sidebar.

## How it avoids made-up twins

A language model can misread a drawing or invent a number. The builder is designed so that neither reaches the twin unnoticed.

| Rule | How it is enforced |
|---|---|
| The model only proposes; code decides | Muse Spark fills fixed JSON schemas (zod-validated). IDs, links between elements, blueprint boxes and citations are resolved in code (`src/domain/builder/draft.ts`). |
| Only known machine types | Every machine maps to one of 16 archetypes with physics templates (`src/domain/archetypes.ts`). An unknown type becomes a manual station and is listed as an assumption for the user to fix. |
| Every element says where it came from | Each line, machine, product, material and connection carries a provenance tag: blueprint, your requirement, cited source, template, assumption, or your edit. The review screen shows it on every row. |
| Claims must be backed | "From the blueprint" requires a matching element on the drawing. "Cited source" requires a valid `url_citation` from the Meta Model API web search results. Otherwise the tag is downgraded to *assumption*. |
| No invented numbers | The model may only give rates, prices and costs that the user, the drawing or a cited source states. Everything else stays empty and is filled by stated, deterministic defaults, which are listed in the build's audit entry. |
| Deterministic validation | `validateSpec` checks structure, references, typical rate ranges and bottlenecks, repairs what is safe to repair, and reports everything it changed. Only a spec without errors can be built. |
| Human review before build | Nothing is built until the user presses **Build my digital twin**. |
| Deterministic build | `compileSpec` turns a reviewed spec into the twin with the same engine as the demo. The same spec and seed always give the same twin, and the demo factory is byte-identical after the refactor (fingerprint-tested). |
| Honest fallbacks | Without the Meta Model API key, or if a call fails, the builder says so and starts from a template matched by keywords. It never pretends to have read a drawing or searched the web. |

## Workflow

```
 drawing + requirements + (template)
            │
  READ      │  Muse Spark → machines, lines, flows; SAM 3.1 → footprint boxes        ┐
  RESEARCH  │  Muse Spark + web_search → notes with [R#] citations                   │ model proposes
  DRAFT     │  Muse Spark (JSON schema) → lines, machines, products, connections     ┘
            ▼
  VALIDATE  │  deterministic checks, repairs, rate derivation                        ┐
  REVIEW    │  person edits directly or chats ("add a second filler") →              │ code decides,
            │  validated edit operations, attributed to the user                     │ person approves
  BUILD     ▼  deterministic compile → live twin + planned data connections          ┘
```

The workflow is `runBuilder` in `src/domain/builder/pipeline.ts`. The model sits behind an injected interface (`BuilderAi`), so the same code runs with Muse Spark and SAM 3.1 (`src/server/builder/ai.ts`), with recorded responses in tests, and without AI. Each stage streams its real output to the browser as NDJSON.

## The twin spec

`TwinSpec` (`src/domain/builder/spec.ts`) is the reviewable contract between the agent and the compiler:

- **site:** name, industry, location, production type.
- **lines:** 1–4 process lines and an optional packing / end-of-line area that receives their output. Each has up to 8 machines in flow order, each with an archetype, an optional rate and an optional box on the drawing.
- **products:** unit, rate, price, material cost and bill of materials. **materials:** unit, cost, lead time and stock.
- **integrations:** planned data connections per line, machine or site (simulated, MQTT, camera RTSP, OPC UA, Modbus, historian, ERP). Never credentials.
- **mobileRobots:** fleets of AMRs, AGVs, automated forklifts or tuggers, each with a count (up to 12 per fleet, 24 in all), a move (kitting: stores → a process line; line-transfer: a process line → the packing line; finished-goods: the packing line → the dock), the line it serves, and optional units per trip and speed. Only added when your requirements or the drawing mention robots. Validation points each fleet at a line that suits its move.
- **references, assumptions, questions, options:** the options are the rehearsal incident and whether lines can run each other's products.

Edits from the review screen and from the agent's chat use the same 21 edit operations (`src/domain/builder/ops.ts`). Each one is validated, and invalid ones are rejected with a reason.

## Machine archetypes

The original 6 archetypes are conveyor, press, robot, inspection camera, packaging machine and labeler. The builder adds 10 more:
- CNC machine
- mixer / blender
- oven / furnace / dryer
- filling machine
- molding machine (injection or blow)
- welding cell
- palletizer
- pump / transfer unit
- manual / semi-automatic station
- extruder

Each archetype has:
- representative physics (rate, power, vibration and temperature baselines and limits, maintenance interval)
- sensors
- a failure mode
- defect classes (for example ISO 5817 weld imperfections, molding short shots and flash, fill-level tolerance)
- a typical rate range
- an isometric 3D shape

The defaults are labelled as simulation values, not OEM data. Inspection cameras cite IPC-A-610 only in electronics plants; other industries use their machines' own defect classes.

## Templates

Seven reviewable starting layouts:
- electronics SMT
- PET bottling
- automotive CNC machining
- plastics injection molding
- industrial bakery
- stamping and welding
- pharma oral solid dose

They are labelled as typical configurations, not real plants. All seven pass validation with no warnings and run the full six-agent analysis in tests.

## Mobile robots

Describe them the way you would to a colleague: "3 AMRs bring components from the warehouse to Line 1, two AGVs take pallets to the dock". With AI on, the draft maps each fleet to a type, a move, a line and the stated count, tagged *your requirement* (or *blueprint* when the drawing shows AGV paths or charging stations). Without AI, or if the model leaves them out, the same request is read by keyword matching (`src/domain/builder/robots.ts`), and the spec says so; robots you asked for are never dropped silently. A plant whose requirements don't mention robots gets none.

On the review screen the **Mobile robots** card lists each fleet with its source, and lets you change the type, move, line and count, add or remove fleets; or ask the agent ("make it 4 AMRs", "add a tugger for kitting on Line 2"). In the built twin, each robot appears in the 3D view on an aisle route, its trips per hour follow its line's output and are shared across the fleet, and it parks with the reason when its line stops or a part runs out. Robots are simulated: no fleet manager is connected yet (a VDA 5050 or vendor-API adapter would supply real positions).

## Playground

The Playground (`/playground`) edits a sandbox copy of a spec on a floor plan, with the same edit operations as chat and the review screen:

| Operation | What it does |
|---|---|
| `place_machine` | Sets a machine's floor position and rotation (multiples of 90°). `add_machine` and `add_line` accept a position too. |
| `connect` | Makes one machine the next step after another, moving it into that line; an emptied line is removed. |
| `disconnect` | Splits a process line after a machine; the rest becomes a new line next to it. |
| `set_robot_route` | Waypoints a robot fleet passes between pick-up and drop-off. Fleets also take a trigger (`output` or `schedule` every N minutes). |
| `add_rule`, `update_rule`, `remove_rule` | Inventory, maintenance and connector rules (see the README). Removing a line or machine removes the rules and connections that pointed at it. |

Validation drops rules whose references are gone, a divert to a line that isn't a process line, and warns about overlapping machines and rules that can't fire. The demo plant, which predates the builder, is read back into a spec (`specFromState`), so it can be edited the same way.

## Data connections ("integrate whatever you want")

Connections are planned per line, machine or site and saved with the twin. The **Integrations** page lists them as *planned · not connected* until a connector is configured and verified.

| Kind | Status today |
|---|---|
| Simulated | Active |
| MQTT telemetry | Implemented. Set `MQTT_BROKER_URL` and `TELEMETRY_SOURCE=mqtt`; messages `{assetId, vibration, temperature, powerKw}` on `MQTT_TOPIC` drive the twin. Specs that say `pubsub` are read as `mqtt`. |
| Camera (RTSP/ONVIF) | Implemented for viewing, through an HLS gateway URL on the camera. |
| OPC UA, Modbus | Planned: a read-only edge gateway ([Python services plan](python-services-plan.md), Phase 4) |
| Historian, ERP | Planned |

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/builder` | AI availability, templates, archetypes, connection kinds |
| `POST /api/builder/draft` | Multipart (`blueprint` PNG/JPEG/WebP/PDF ≤ 15 MB, `requirements`, `name`, `industry`, `location`, `templateId`, `research`). Streams the agent's stages as NDJSON. The drawing is not stored. |
| `POST /api/builder/refine` | `{spec, instruction}`: the agent's edit operations, applied and validated (needs an AI provider) |
| `POST /api/builder/validate` | `{spec}`: deterministic checks (no AI) |
| `POST /api/builder/build` | `{spec}`: builds the twin and replaces the current factory |

## Enabling the AI steps

1. Set `MODEL_API_KEY` (Meta Model API) in `.env`, or on the Integrations page.
2. Optionally change `META_MODEL` (default `muse-spark-1.3`).

Calls retry once on 429/5xx. Muse models always reason and reasoning tokens count toward the output limit, so each call leaves headroom for them. SAM 3.1 runs in parallel with the read and never blocks it: if it fails, the boxes are Muse Spark estimates and the reading says so.

Web research uses the Meta Model API's `web_search` tool; only results returned as `url_citation` annotations become citations.

## Limitations

- **Lines run in series.** Parallel stations are modelled by their combined rate. Branching flows, buffers between stations and batch steps are approximated. A full process-graph engine was considered and deferred.
- **Up to 4 process lines** and one packing area per twin, with up to 8 machines per line, and up to 24 mobile robots for three kinds of move (kitting, transfer to packing, finished goods to the dock).
- **Typical values.** Default rates, prices, stock and the sample order book are typical values until real systems are connected. They are listed in the build's audit entry and in the review's assumptions.
- **Drawings are interpreted, not measured.** Element positions on the drawing are shown for checking. They do not set the twin's geometry, which uses the standard isometric layout.
- **Model behaviour varies between runs.** Unit tests use recorded responses. Against an earlier model, a two-line bottling drawing was read correctly: 11 machines with accurate boxes and utilities excluded; SAM 3.1 now supplies the footprint boxes. A full draft with research takes about 70 s, and chat edits 5–15 s. Each chat edit shows exactly which operations were applied or rejected, whatever the model says.
