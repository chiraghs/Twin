"""Generate Twin architecture diagrams as HTML (rendered to PNG by render.mjs).

    python docs/architecture/src/build_diagrams.py && node docs/architecture/src/render.mjs
"""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parent

CSS = """
*{box-sizing:border-box} body{margin:0;background:#fff;font-family:Inter,"Segoe UI",Helvetica,Arial,sans-serif;color:#0f172a}
.wrap{width:1560px;padding:28px 30px 26px}
h1{margin:0;font-size:25px;letter-spacing:-.4px} h1 span{color:#2f6fed}
.sub{margin:6px 0 18px;color:#475569;font-size:13.5px}
.grid{display:grid;grid-template-columns:1fr 26px 1.05fr 26px 1.25fr 26px 1.15fr 26px 1.05fr;align-items:stretch}
.arrow{display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:22px;font-weight:700}
.col{border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:9px}
.col>.t{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin:0 2px 2px}
.c-in{background:#f8fafc;border:1.5px solid #e2e8f0} .c-in>.t{color:#475569}
.c-data{background:#f0f9ff;border:1.5px solid #bae6fd} .c-data>.t{color:#0369a1}
.c-eng{background:#f0fdf4;border:1.5px solid #bbf7d0} .c-eng>.t{color:#15803d}
.c-meta{background:#eff5ff;border:2px solid #2f6fed} .c-meta>.t{color:#1d4ed8}
.c-out{background:#fffbeb;border:1.5px dashed #f59e0b} .c-out>.t{color:#b45309}
.b{background:#fff;border:1.3px solid #cbd5e1;border-radius:11px;padding:8px 10px}
.c-meta .b{border-color:#93b4f7}
.b h3{margin:0 0 3px;font-size:13.5px} .b p{margin:0;font-size:11.8px;color:#475569;line-height:1.38}
.b code{font-size:10.5px;color:#64748b;margin-left:4px;font-family:ui-monospace,Menlo,monospace}
.rule{margin-top:14px;padding:10px 14px;border-radius:12px;background:#0f172a;color:#e2e8f0;font-size:12.8px}
.rule b{color:#8db6ff}
.api{margin-top:10px;font-size:11.5px;color:#475569} .api code{background:#f1f5f9;border-radius:5px;padding:1px 5px;margin-right:6px;font-family:ui-monospace,Menlo,monospace}
"""


def box(title, text, code=None):
    c = f"<code>{escape(code)}</code>" if code else ""
    return f'<div class="b"><h3>{escape(title)}{c}</h3><p>{escape(text)}</p></div>'


def col(kind, title, boxes):
    return f'<div class="col {kind}"><div class="t">{escape(title)}</div>{"".join(box(*b) for b in boxes)}</div>'


def page(name, title, sub, cols, guarantee, apis):
    arrow = '<div class="arrow">➜</div>'
    kinds = ["c-in", "c-data", "c-eng", "c-meta", "c-out"]
    heads = ["Inputs", "Data & ingestion", "Deterministic engines", "Meta Model API", "Outputs & human approval"]
    body = arrow.join(col(k, h, c) for k, h, c in zip(kinds, heads, cols))
    api = "".join(f"<code>{escape(a)}</code>" for a in apis)
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>{escape(title)}</title><style>{CSS}</style></head>
<body><div class="wrap"><h1>Twin <span>AI</span> · {escape(title)}</h1><div class="sub">{escape(sub)}</div>
<div class="grid">{body}</div><div class="api">API: {api}</div>
<div class="rule"><b>Guarantees:</b> {escape(guarantee)}</div></div></body></html>"""
    (OUT / f"{name}.html").write_text(html, encoding="utf-8")


page(
    "predictive-maintenance",
    "Predictive maintenance & maintenance copilot",
    "Sensor data → features → failure-risk model and RUL → prescriptive work orders; Muse Spark explains with grounded evidence in any language.",
    [
        [("PLC / SCADA", "Vibration, temperature, current, speed via OPC UA, MQTT, Modbus adapters"),
         ("MES / CMMS / ERP", "Work orders, downtime, spares, costs through connector adapters"),
         ("Technicians", "Questions to the copilot; feedback on recommendations")],
        [("Ingestion", "MQTT telemetry and a local buffer; simulated readings offline"),
         ("Canonical mapping", "Source tags → canonical assets, sensors and units"),
         ("Feature engineering", "Rolling RMS vibration, mean temperature, stability index, friction drift"),
         ("Repositories", "SQLite pm_ tables (sensor readings, predictions, ROI ledger…), DuckDB reports")],
        [("Failure-risk model", "RandomForest, 24 h horizon, time-partitioned anti-leakage training"),
         ("Condition rules", "ISO 10816-3 severity, Weibull RUL, FFT bearing-fault tracking"),
         ("Recommendation engine", "Urgency, SOP and spare parts for each risk tier"),
         ("ROI intelligence", "Avoided downtime and repair cost per decision"),
         ("Model registry", "Local, versioned: sha256, metrics, human-approved promotion"),
         ("RAG retrieval", "Similar historical incidents with verified outcomes; approved SOPs")],
        [("Muse Spark", "Maintenance copilot: answers from sensors, ML risk, incidents and SOPs, in the user's language", "muse-spark-1.3"),
         ("Grounding check", "Every figure in the answer must appear in the evidence, else the deterministic template is returned"),
         ("Muse Spark · operations", "Shift-handover briefings and alarm triage grounded in the maintenance manuals")],
        [("Prescriptive advisory", "Urgency, action and SOP with LOTO safety notice"),
         ("Human sign-off", "Required before a CMMS work order or a production halt"),
         ("Feedback loop", "Technician ratings and outcomes improve retrieval and recommendations"),
         ("Twin app & dashboards", "Fleet health, recommendations, ROI, copilot")],
    ],
    "the risk model and rules compute every number · Muse Spark only explains the evidence · invented figures are rejected · LOTO and human approval before any physical work · deterministic fallback without MODEL_API_KEY",
    ["POST /api/v1/maintenance/copilot/chat", "GET /api/v1/copilot/shift-handover/{line_id}", "GET /api/v1/copilot/alarm-triage/{asset_id}/{alarm_code}", "GET /ai/status"],
)

page(
    "supply-chain-intelligence",
    "Supply chain intelligence",
    "A supply-chain ontology with risk scoring and BOM impact propagation; Muse Spark answers planners and Muse Wonder briefs every what-if disruption.",
    [
        [("ERP & procurement", "Suppliers, parts, BOMs, purchase orders, contracts"),
         ("Logistics", "Shipments, carriers, ports, warehouses"),
         ("Sales", "Customer orders, SLAs and penalties"),
         ("Planners", "Questions and what-if scenarios")],
        [("Ontology", "Supplier → Part → PO → Shipment → Warehouse → Plant → Order"),
         ("Repositories", "In-memory demo data or optional lakehouse (supply_chain_lakehouse_schema.sql)"),
         ("Input sanitisation", "Prompt-injection patterns redacted before any model call")],
        [("Risk engine", "Multi-factor delivery risk per supplier and part"),
         ("Impact analyzer", "BOM disruption propagation to assemblies and customer orders"),
         ("Line starvation", "Time-to-depletion (TTD) per critical part and plant"),
         ("KPI service", "OTIF, lead-time drift, coverage, plant vulnerability ranking"),
         ("What-if simulator", "Supplier failure / port closure: downtime and financial exposure")],
        [("Muse Spark", "Supply-chain assistant: risk, coverage, affected orders and mitigation in any language", "muse-spark-1.3"),
         ("Muse Wonder", "Executive briefing of each simulated disruption and its contingency plan", "muse-wonder-1.0"),
         ("Grounding check", "Answers that state figures not in the evidence fall back to the deterministic text")],
        [("Mitigation recommendations", "Alternative sources, expedites, safety-stock moves"),
         ("Procurement approval", "Required before any purchase order commit"),
         ("Streamlit cockpit & Twin app", "Risk map, starvation countdown, assistant")],
    ],
    "the risk, impact and simulation engines compute every number · Muse models explain and brief, never decide · purchase orders need human authorisation · deterministic fallback without MODEL_API_KEY",
    ["POST /api/v1/supply-chain/assistant/chat", "POST /api/v1/supply-chain/assistant/what-if"],
)

page(
    "demand-forecasting",
    "Demand forecasting & operations planning",
    "Probabilistic demand forecasts drive constraint-aware production and inventory plans; Muse Wonder writes the S&OP decision brief.",
    [
        [("Sales history & orders", "CSV / JSON batches, customer orders"),
         ("Capacity & maintenance", "Lines, shifts, planned downtime"),
         ("Inventory & suppliers", "Stock, safety stock, lead times"),
         ("Quality", "Yield and scrap by product")],
        [("Ingestion pipeline", "Schema validation, data-quality report, quarantine of bad rows"),
         ("Lakehouse repository", "18 partitioned tables (demand_forecasting_lakehouse_schema.sql); in-memory locally"),
         ("Pipeline status", "Run history and freshness")],
        [("Forecasting engine", "Champion GBDT vs seasonal-naive baseline; P10 / P50 / P90 quantiles"),
         ("Out-of-time validation", "MAE, RMSE, WAPE, bias, MAPE; model registry entries"),
         ("Production planning", "Net requirements with capacity and maintenance deductions; bottlenecks"),
         ("Inventory optimisation", "Days of inventory, reorder point, stock-out ETA, replenishment"),
         ("What-if scenarios", "Demand spike, capacity loss, lead-time drift")],
        [("Muse Wonder", "S&OP planning brief: demand vs capacity, binding bottleneck, stock-out risks, decisions and trade-offs", "muse-wonder-1.0"),
         ("Grounding check", "Every figure traced to the plan, bottleneck and inventory outputs; deterministic brief otherwise")],
        [("Production plan & replenishment", "Released to MES / ERP only after planner approval"),
         ("S&OP brief", "For the weekly planning meeting, labelled as model forecasts"),
         ("Streamlit cockpit", "8-tab operations dashboard")],
    ],
    "forecasts and plans are computed by the deterministic engines · Muse Wonder only writes the brief from them · plans need planner approval · deterministic brief without MODEL_API_KEY",
    ["GET /api/v1/production/brief", "POST /api/v1/forecasts/run", "POST /api/v1/scenarios/simulate"],
)

page(
    "visual-quality-inspection",
    "Visual quality inspection (AOI)",
    "Muse Spark and SAM 3.1 detect, localise and explain IPC-A-610 defects; a deterministic rule engine decides; a person disposes every flagged unit.",
    [
        [("AOI / line cameras", "Part images from inspection stations"),
         ("Golden templates", "Registered known-good images per part and revision"),
         ("Quality engineers", "Dispositions: confirm, dismiss, override, reclassify")],
        [("Inspection API", "Multipart image upload per part and camera"),
         ("History store", "Inspections, defects, dispositions (in-memory or lakehouse)"),
         ("Lakehouse schema", "fact_inspection_events, fact_defect_detections, fact_detector_feedback")],
        [("OpenCV comparison", "Golden-template alignment and pixel difference (deterministic)"),
         ("IPC-A-610 rule engine", "Decisive PASS / FAIL / REVIEW_REQUIRED from findings and thresholds"),
         ("Reference detector", "Deterministic detector when there is no image or no key"),
         ("Quality KPIs", "FPY, DPMO, RTY, defect Pareto, hourly trend")],
        [("Muse Spark · vision", "Classifies defects into IPC-A-610 classes with confidence; reads serials and codes", "muse-spark-1.3"),
         ("SAM 3.1", "Pixel boxes for each reported defect class (one concept per request)", "sam-3.1"),
         ("Muse Spark · advisory", "Root cause and containment, grounding-checked, never authoritative")],
        [("Verdict & overlay", "Findings drawn on the image; low-confidence → REVIEW_REQUIRED"),
         ("Human disposition", "Mandatory rationale; immutable audit trail"),
         ("Detector feedback", "Precision from dispositions; threshold advice before any auto-reject"),
         ("Twin app & dashboards", "Camera wall, reviews, FPY / DPMO")],
    ],
    "pass/fail is decided by deterministic rules, never by a model · print-quality grades are measured, never guessed · every flagged unit waits for a person · reference detector without MODEL_API_KEY",
    ["POST /api/v1/quality/inspect", "POST /api/v1/quality/disposition", "GET /api/v1/quality/mlops/detector-feedback"],
)
print("written:", ", ".join(p.name for p in sorted(OUT.glob("*.html"))))
