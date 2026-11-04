"""Runs the backend's feature engines on the web twin's plant.

Each feature reuses its existing engine through an adapter that implements the feature's port
over the snapshot, so the same code that serves the demo plants serves the twin:

- maintenance: PredictiveMaintenanceService (ISO 10816-3 zone, health score, RUL) per asset
- supply:      SupplyChainService (days of supply, stock-out risk, PO recommendation) per material
- demand:      DemandForecastingEngine (P10/P50/P90) per product, on a generated history
- vision:      VisualQualityService.inspect_part (AOI) per uploaded image

Everything is deterministic given the snapshot; nothing here changes the twin.
"""
from __future__ import annotations

import asyncio
import math
import random
import zlib
from datetime import date, datetime, timedelta
from typing import Any

from backend.features.demand_forecasting.config.models import demand_config_store
from backend.features.demand_forecasting.models.forecasting_engine import DemandForecastingEngine
from backend.features.demand_forecasting.schemas.manufacturing import ModelType
from backend.features.predictive_maintenance.config.models import ISO10816Thresholds, maintenance_config_store
from backend.features.predictive_maintenance.ports.contracts import ITelemetryReader
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.supply_chain_intelligence.config.models import supply_config_store
from backend.features.supply_chain_intelligence.ports.contracts import IERPInventoryReader
from backend.features.supply_chain_intelligence.services.supply_service import SupplyChainService
from backend.features.twin_bridge import store
from backend.features.twin_bridge.models import TwinAsset, TwinItem, TwinSnapshot

HISTORY_DAYS = 730
AVAILABILITY = 0.85  # share of the day a line produces (changeovers, breaks)

# ───────────────────────────── maintenance ─────────────────────────────


class _AssetTelemetry(ITelemetryReader):
    """ITelemetryReader over one twin asset's 10-minute history."""

    def __init__(self, asset: TwinAsset) -> None:
        self.asset = asset

    async def get_latest_vibration_rms(self, asset_id: str) -> float:
        return self.asset.history[-1].vibration if self.asset.history else self.asset.baseline_vibration

    async def get_latest_temperature(self, asset_id: str) -> float:
        return self.asset.history[-1].temperature if self.asset.history else self.asset.baseline_temperature

    async def get_vibration_history(self, asset_id: str, limit: int = 60) -> list[float]:
        return [r.vibration for r in self.asset.history[-limit:]]


class _AssetConfig:
    """The feature's configuration with the asset's own limits: ISO 10816-3 zones are class-specific,
    so zone B ends at the asset's alarm limit, zone C at its trip limit (zone A at 40% of the alarm)."""

    def __init__(self, asset: TwinAsset) -> None:
        base = maintenance_config_store.get_config()
        self.cfg = base.model_copy(update={
            "trip_threshold_rms": asset.vibration_trip,
            "nominal_temperature_c": asset.baseline_temperature,
            "max_temperature_c": asset.temperature_trip,
            "iso_thresholds": ISO10816Thresholds(
                zone_a_good_max=round(asset.vibration_alarm * 0.4, 2),
                zone_b_acceptable_max=asset.vibration_alarm,
                zone_c_unsatisfactory_max=asset.vibration_trip,
            ),
        })

    def get_config(self):
        return self.cfg


async def maintenance_insights(snap: TwinSnapshot) -> dict[str, Any]:
    cfg = maintenance_config_store.get_config()
    cm = snap.cost_model
    preventive_cost = 4 * cm.maintenance_labor_per_hour + cm.maintenance_parts_cost
    assets: list[dict[str, Any]] = []
    for a in snap.assets:
        if a.mode != "running" or len(a.history) < 6:
            assets.append({"assetId": a.id, "name": a.name, "lineId": a.line_id, "kind": a.kind, "criticality": a.criticality,
                           "status": a.mode if a.mode != "running" else "insufficient-history", "risk": "n/a"})
            continue
        svc = PredictiveMaintenanceService(_AssetTelemetry(a), _AssetConfig(a))
        rep = await svc.diagnose_asset(a.id)
        trending = rep.rul.degradation_rate_per_hour > 0.0101
        hours = rep.rul.hours_to_trip if trending else None
        zone = rep.health.iso_zone.value
        risk = "high" if rep.is_trip_imminent else "medium" if zone == "ZONE_C_UNSATISFACTORY" or (hours is not None and hours < 72) else "low"
        assets.append({
            "assetId": a.id, "name": a.name, "lineId": a.line_id, "kind": a.kind, "criticality": a.criticality, "status": "running",
            "vibration": rep.health.vibration_rms, "temperature": rep.health.temperature_c, "healthScore": rep.health.health_score,
            "isoZone": zone, "hoursToTrip": hours, "tripHour": round(snap.sim_hour + hours, 2) if hours is not None else None,
            "degradationPerHour": rep.rul.degradation_rate_per_hour if trending else 0.0, "confidence": rep.rul.confidence,
            "tripImminent": rep.is_trip_imminent, "risk": risk, "recommendedAction": rep.recommended_action,
            "faultSignature": rep.health.primary_fault_signature,
            "avoidableCost": round(max(0.0, cm.unplanned_repair_cost - preventive_cost), 0) if risk != "low" else 0.0,
            "limits": {"alarm": a.vibration_alarm, "trip": a.vibration_trip},
        })
    order = {"high": 0, "medium": 1, "low": 2, "n/a": 3}
    assets.sort(key=lambda x: (order[x["risk"]], x.get("hoursToTrip") if x.get("hoursToTrip") is not None else 1e9))
    store.record_asset_health(snap.facility_id, round(snap.sim_hour, 3), [
        (x["assetId"], x["healthScore"], x["vibration"], x["temperature"], x["hoursToTrip"] if x["hoursToTrip"] is not None else -1, x["isoZone"], x["risk"])
        for x in assets if x["status"] == "running"
    ])
    counts = {k: sum(1 for x in assets if x["risk"] == k) for k in ("high", "medium", "low")}
    return {
        "feature": "maintenance", "simHour": snap.sim_hour, "engine": "PredictiveMaintenanceService (ISO 10816-3, linear-trend RUL)",
        "assets": assets, "counts": counts, "preventiveCost": preventive_cost, "unplannedCost": cm.unplanned_repair_cost,
        "imminentHours": cfg.imminent_trip_hours_threshold,
        "zoneMix": {z: sum(1 for x in assets if x.get("isoZone") == z) for z in ("ZONE_A_GOOD", "ZONE_B_ACCEPTABLE", "ZONE_C_UNSATISFACTORY", "ZONE_D_UNACCEPTABLE")},
    }


# ───────────────────────────── supply ─────────────────────────────


class _ItemERP(IERPInventoryReader):
    """IERPInventoryReader over one twin material."""

    def __init__(self, item: TwinItem) -> None:
        self.item = item

    async def get_inventory_record(self, part_number: str) -> dict[str, Any]:
        # The ERP contract counts whole units; the twin's stock is fractional while lines consume it.
        return {"part_name": self.item.name, "stock_on_hand": int(math.floor(self.item.on_hand)),
                "daily_consumption": self.item.consumption_per_hour * 24.0, "safety_stock": int(round(self.item.reorder_point))}

    async def get_supplier_performance(self, supplier_id: str) -> dict[str, Any]:
        return {}


def _runway_hours(item: TwinItem, sim_hour: float) -> float:
    """Hours until the material runs out at the current consumption, counting inbound that arrives in time."""
    rate = item.consumption_per_hour
    if rate <= 0:
        return math.inf
    stock = item.on_hand
    for inb in sorted(item.inbound, key=lambda i: i.eta_hour):
        if stock / rate > inb.eta_hour - sim_hour:
            stock += inb.qty
        else:
            break
    return stock / rate


async def supply_insights(snap: TwinSnapshot) -> dict[str, Any]:
    cfg = supply_config_store.get_config()
    items: list[dict[str, Any]] = []
    for it in snap.items:
        svc = SupplyChainService(_ItemERP(it), supply_config_store)
        risk = await svc.evaluate_stockout_risk(it.id)
        runway = _runway_hours(it, snap.sim_hour)
        pipeline = sum(i.qty for i in it.inbound)
        next_eta = min((i.eta_hour for i in it.inbound), default=None)
        # Units still needed to cover the lead time plus two days and restore the reorder point, after what is on order.
        cover_qty = it.consumption_per_hour * (it.lead_time_hours + 48) + it.reorder_point - it.on_hand - pipeline
        needs_order = it.consumption_per_hour > 0 and runway < it.lead_time_hours * 1.25 and cover_qty > 0
        # Already ordered, but the first delivery lands after the stock runs out: expedite rather than order again.
        expedite = it.consumption_per_hour > 0 and next_eta is not None and (next_eta - snap.sim_hour) > runway
        po = None
        if needs_order:
            base = await svc.generate_po_recommendation(it.id)
            qty = int(math.ceil(max(base.suggested_order_qty, cover_qty, cfg.min_recommended_po_qty) / 10.0) * 10)
            po = {"qty": qty, "supplier": it.supplier, "etaInHours": round(it.lead_time_hours, 1), "cost": round(qty * it.unit_cost, 2),
                  "urgency": "CRITICAL" if runway < it.lead_time_hours else base.urgency}
        items.append({
            "itemId": it.id, "name": it.name, "unit": it.unit, "category": it.category, "supplier": it.supplier,
            "onHand": round(it.on_hand, 1), "reorderPoint": it.reorder_point, "consumptionPerHour": round(it.consumption_per_hour, 3),
            "daysOfSupply": risk.days_of_supply_remaining if it.consumption_per_hour > 0 else None,
            "runwayHours": round(runway, 1) if math.isfinite(runway) else None, "leadTimeHours": it.lead_time_hours,
            "inboundQty": pipeline, "nextInboundHour": next_eta, "atRisk": bool(risk.is_at_risk_of_stockout and it.consumption_per_hour > 0),
            "usedBy": [u.model_dump(by_alias=True) for u in it.used_by], "unitCost": it.unit_cost, "purchaseOrder": po,
            "expediteNeeded": bool(expedite),
        })
    items.sort(key=lambda x: x["runwayHours"] if x["runwayHours"] is not None else 1e9)
    store.record_stock_levels(snap.facility_id, round(snap.sim_hour, 3), [
        (x["itemId"], x["onHand"], x["daysOfSupply"] if x["daysOfSupply"] is not None else -1, int(x["atRisk"])) for x in items
    ])
    lines = []
    for ln in snap.lines:
        used = [x for x in items if any(u["lineId"] == ln.id for u in x["usedBy"]) and x["runwayHours"] is not None]
        crit = min(used, key=lambda x: x["runwayHours"], default=None)
        lines.append({"lineId": ln.id, "name": ln.name, "runwayHours": crit["runwayHours"] if crit else None, "criticalItemId": crit["itemId"] if crit else None})
    suppliers: dict[str, dict[str, Any]] = {}
    for x in items:
        s = suppliers.setdefault(x["supplier"], {"supplier": x["supplier"], "items": 0, "atRisk": 0, "dailySpend": 0.0, "maxLeadTimeHours": 0.0, "inboundQty": 0.0})
        s["items"] += 1
        s["atRisk"] += int(x["atRisk"])
        s["dailySpend"] = round(s["dailySpend"] + x["consumptionPerHour"] * 24 * x["unitCost"], 2)
        s["maxLeadTimeHours"] = max(s["maxLeadTimeHours"], x["leadTimeHours"])
        s["inboundQty"] += x["inboundQty"]
    return {
        "feature": "supply", "simHour": snap.sim_hour, "engine": "SupplyChainService (days of supply, stock-out risk, PO recommendation)",
        "items": items, "lines": lines, "suppliers": sorted(suppliers.values(), key=lambda s: -s["dailySpend"]),
        "criticalDays": cfg.critical_days_of_supply_threshold,
        "counts": {"atRisk": sum(1 for x in items if x["atRisk"]), "toOrder": sum(1 for x in items if x["purchaseOrder"]), "toExpedite": sum(1 for x in items if x["expediteNeeded"])},
    }


# ───────────────────────────── demand ─────────────────────────────

WEEKDAY = [1.06, 1.08, 1.1, 1.07, 1.02, 0.78, 0.62]


def _sim_date(snap: TwinSnapshot) -> date:
    try:
        anchor = datetime.fromisoformat(snap.anchor_iso.replace("Z", "+00:00"))
    except ValueError:
        anchor = datetime(2026, 1, 1)
    return (anchor + timedelta(hours=snap.sim_hour)).date()


def _capacity_per_day(snap: TwinSnapshot, product_id: str) -> float:
    """Units/day the plant can make of the product at its current line allocation."""
    total = 0.0
    for ln in snap.lines:
        if ln.kind != "assembly":
            continue
        cap = next((c for c in ln.capabilities if c.product_id == product_id), None)
        if cap:
            total += cap.rate_per_hour * ln.allocation.get(product_id, 0.0) * 24 * AVAILABILITY
    return total


def _max_capacity_per_day(snap: TwinSnapshot, product_id: str) -> float:
    """Units/day if every capable assembly line made only this product."""
    return sum(next((c.rate_per_hour for c in ln.capabilities if c.product_id == product_id), 0.0) * 24 * AVAILABILITY
               for ln in snap.lines if ln.kind == "assembly")


def _ensure_history(snap: TwinSnapshot, product_id: str, today: date) -> list[dict[str, Any]]:
    """Daily demand history up to yesterday: generated once per facility and product (seeded, labelled simulated)."""
    hist = store.demand_history(snap.facility_id, product_id)
    last = date.fromisoformat(hist[-1]["date"]) if hist else None
    if last is not None and last >= today - timedelta(days=1):
        return hist
    base = _capacity_per_day(snap, product_id) * 0.8 or _max_capacity_per_day(snap, product_id) * 0.25
    if base <= 0:
        open_qty = sum(o.quantity - o.fulfilled for o in snap.orders if o.product_id == product_id)
        base = max(1.0, open_qty / 7.0)
    rng = random.Random(zlib.crc32(f"{snap.facility_id}:{product_id}".encode()))
    start = (last + timedelta(days=1)) if last else today - timedelta(days=HISTORY_DAYS)
    rows: list[tuple[str, float]] = []
    d = start
    while d < today:
        age = (today - d).days
        trend = 1.0 - 0.1 * (age / HISTORY_DAYS)  # ~10% growth over two years
        season = 1.0 + 0.08 * math.sin(2 * math.pi * d.timetuple().tm_yday / 365.25)
        units = max(0.0, base * trend * season * WEEKDAY[d.weekday()] * rng.gauss(1.0, 0.07))
        rows.append((d.isoformat(), round(units, 1)))
        d += timedelta(days=1)
    if rows:
        store.save_demand_history(snap.facility_id, product_id, rows)
    return store.demand_history(snap.facility_id, product_id)


def demand_insights(snap: TwinSnapshot) -> dict[str, Any]:
    cfg = demand_config_store.get_config()
    today = _sim_date(snap)
    previous = store.load_insight(snap.facility_id, "demand")
    cfg_key = "champion-v2:" + cfg.model_dump_json()  # bump when the method changes
    if previous and previous.get("asOf") == today.isoformat() and previous.get("configKey") == cfg_key:
        return previous  # forecasts change once per simulated day
    horizon = cfg.default_horizon_weeks * 7
    engine = DemandForecastingEngine()
    products = []
    for p in snap.products:
        hist = _ensure_history(snap, p.id, today)
        if len(hist) < 14:
            continue
        # Champion / challenger: keep the main model only if it beats the seasonal-naive baseline out of time.
        res = engine.run_forecast(product_id=p.id, product_name=p.name, plant_id=snap.facility_id, history_records=hist,
                                  horizon_days=horizon, model_type=ModelType.GRADIENT_BOOSTED_TREES)
        challenger = None
        if res.metrics.wape > res.metrics.baseline_wape:
            challenger = {"model": res.model_name, "wape": res.metrics.wape}
            res = engine.run_forecast(product_id=p.id, product_name=p.name, plant_id=snap.facility_id, history_records=hist,
                                      horizon_days=horizon, model_type=ModelType.SEASONAL_NAIVE)
        pts = res.time_series_points
        p50 = sum(x.p50_units for x in pts) / max(1, len(pts))
        p90 = sum(x.p90_units for x in pts) / max(1, len(pts))
        capacity = _capacity_per_day(snap, p.id)
        max_capacity = _max_capacity_per_day(snap, p.id)
        open_due = sum(o.quantity - o.fulfilled for o in snap.orders if o.product_id == p.id and o.due_hour - snap.sim_hour <= horizon * 24)
        util = (p50 / capacity * 100) if capacity > 0 else None
        products.append({
            "productId": p.id, "name": p.name, "sku": p.sku, "model": res.model_name, "challenger": challenger,
            "metrics": {"wape": res.metrics.wape, "bias": res.metrics.bias, "mae": res.metrics.mae, "baselineWape": res.metrics.baseline_wape},
            "forecast": [x.model_dump() for x in pts], "history": hist[-90:],
            "dailyP50": round(p50, 1), "dailyP90": round(p90, 1), "totalP50": res.total_forecasted_units,
            "capacityPerDay": round(capacity, 1), "maxCapacityPerDay": round(max_capacity, 1),
            "utilizationPct": round(util, 1) if util is not None else None,
            "capacityWarning": util is not None and util >= cfg.capacity_warning_threshold_pct,
            "p90ExceedsCapacity": capacity > 0 and p90 > capacity,
            "openOrderUnits": round(open_due, 1), "orderCoveragePct": round(open_due / res.total_forecasted_units * 100, 1) if res.total_forecasted_units else None,
            "revenueP50": round(res.total_forecasted_units * p.unit_price, 0),
        })
    out = {
        "feature": "demand", "simHour": snap.sim_hour, "asOf": today.isoformat(), "configKey": cfg_key, "horizonDays": horizon,
        "engine": "DemandForecastingEngine (champion vs seasonal-naive baseline, out-of-time validation)",
        "provenance": "SIMULATED history generated from the plant's capacity and product mix (seeded, reproducible)",
        "capacityWarningPct": cfg.capacity_warning_threshold_pct, "products": products,
        "counts": {"products": len(products), "capacityWarnings": sum(1 for p in products if p["capacityWarning"])},
    }
    return out


# ───────────────────────────── vision ─────────────────────────────


def vision_insights(facility_id: str) -> dict[str, Any]:
    rows = store.inspections(facility_id)
    by_line: dict[str, dict[str, Any]] = {}
    pareto: dict[str, int] = {}
    confirmed = dismissed = 0
    for r in rows:
        ln = by_line.setdefault(r["line_id"] or "unassigned", {"lineId": r["line_id"] or "unassigned", "inspected": 0, "failed": 0, "review": 0, "defects": 0})
        ln["inspected"] += 1
        ln["failed"] += int(r["verdict"] == "FAIL")
        ln["review"] += int(r["verdict"] == "REVIEW_REQUIRED")
        ln["defects"] += r["defect_count"]
        for d in r["data"].get("defects", []):
            pareto[d.get("defect_class", "UNKNOWN")] = pareto.get(d.get("defect_class", "UNKNOWN"), 0) + 1
        if r["defect_count"] and r["disposition"] == "confirmed":
            confirmed += 1
        elif r["defect_count"] and r["disposition"] == "dismissed":
            dismissed += 1
    for ln in by_line.values():
        ln["fpyPct"] = round((ln["inspected"] - ln["failed"] - ln["review"]) / ln["inspected"] * 100, 1) if ln["inspected"] else None
        ln["defectsPerUnit"] = round(ln["defects"] / ln["inspected"], 3) if ln["inspected"] else None
    recent = [{k: r[k] for k in ("inspection_id", "camera_id", "line_id", "product_id", "at", "sim_hour", "verdict", "defect_count", "disposition", "auditor")}
              | {"advisory": (r["data"].get("advisory") or {}).get("summary"), "detector": r["data"].get("detector"),
                 "defects": [{"class": d.get("defect_class"), "confidence": d.get("confidence"), "box": d.get("bounding_box")} for d in r["data"].get("defects", [])]}
              for r in rows[:40]]
    decided = confirmed + dismissed
    return {
        "feature": "vision", "engine": "VisualQualityService (Muse Spark + SAM 3.1 detection, OpenCV golden comparison, IPC-A-610 verdict rules)",
        "lines": sorted(by_line.values(), key=lambda x: x["lineId"]),
        "pareto": sorted(({"defectClass": k, "count": v} for k, v in pareto.items()), key=lambda x: -x["count"]),
        "detectorPrecisionPct": round(confirmed / decided * 100, 1) if decided else None,
        "dispositions": {"confirmed": confirmed, "dismissed": dismissed, "pending": sum(1 for r in rows if r["disposition"] == "pending" and r["defect_count"])},
        "recent": recent, "counts": {"inspected": len(rows), "failed": sum(1 for r in rows if r["verdict"] == "FAIL")},
    }


# ───────────────────────────── sync ─────────────────────────────


async def sync(snap: TwinSnapshot) -> dict[str, Any]:
    """Store the snapshot and compute insights for the enabled features."""
    synced_at = store.save_snapshot(snap.facility_id, snap.facility_name, snap.sim_hour, list(snap.features), snap.model_dump(by_alias=True))
    insights: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for feature in snap.features:
        try:
            if feature == "maintenance":
                data = await maintenance_insights(snap)
            elif feature == "supply":
                data = await supply_insights(snap)
            elif feature == "demand":
                data = await asyncio.to_thread(demand_insights, snap)
            else:
                data = vision_insights(snap.facility_id)
            store.save_insight(snap.facility_id, feature, snap.sim_hour, data)
            insights[feature] = data
        except Exception as e:  # one feature failing must not hide the others
            errors[feature] = f"{type(e).__name__}: {e}"[:300]
    return {"facilityId": snap.facility_id, "syncedAt": synced_at, "simHour": snap.sim_hour, "insights": insights, "errors": errors}
