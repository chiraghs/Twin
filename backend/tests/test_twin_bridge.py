"""Twin bridge: the four features run on a plant snapshot from the web twin."""
import io

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _history(start: float, slope: float, n: int = 60) -> list[dict]:
    return [{"t": i / 6, "vibration": round(start + slope * i, 3), "temperature": 60 + 0.05 * i} for i in range(n)]


def snapshot(features=("maintenance", "supply", "demand", "vision"), facility="F-TEST", sim_hour=10.0) -> dict:
    return {
        "facilityId": facility, "facilityName": "Test plant", "simHour": sim_hour, "anchorIso": "2026-10-01T06:00:00Z",
        "features": list(features),
        "costModel": {"maintenanceLaborPerHour": 380, "maintenancePartsCost": 2400, "unplannedRepairCost": 24000, "unplannedRepairHours": 16},
        "assets": [
            {"id": "ROB-1", "name": "Robot 1", "kind": "robot", "lineId": "L1", "criticality": "A", "mode": "running",
             "vibrationAlarm": 4.5, "vibrationTrip": 7.1, "temperatureAlarm": 70, "temperatureTrip": 85,
             "baselineVibration": 1.6, "baselineTemperature": 55, "history": _history(2.0, 0.07)},
            {"id": "CNV-1", "name": "Conveyor 1", "kind": "conveyor", "lineId": "L1", "criticality": "C", "mode": "running",
             "vibrationAlarm": 4.5, "vibrationTrip": 7.1, "temperatureAlarm": 70, "temperatureTrip": 85,
             "baselineVibration": 1.2, "baselineTemperature": 40, "history": _history(1.2, 0.0)},
            {"id": "PRS-1", "name": "Press 1", "kind": "press", "lineId": "L1", "mode": "maintenance",
             "vibrationAlarm": 5.6, "vibrationTrip": 9.0, "temperatureAlarm": 80, "temperatureTrip": 92, "history": []},
        ],
        "items": [
            {"id": "MCU-7", "name": "MCU", "unit": "pcs", "onHand": 300.6, "reorderPoint": 800, "unitCost": 6.5, "supplier": "Acme",
             "leadTimeHours": 72, "consumptionPerHour": 20, "inbound": [], "usedBy": [{"lineId": "L1", "productId": "P1", "qty": 1}]},
            {"id": "BOX", "name": "Carton", "unit": "pcs", "onHand": 50000, "reorderPoint": 2000, "unitCost": 0.4, "supplier": "PackCo",
             "leadTimeHours": 24, "consumptionPerHour": 20, "inbound": [{"poId": "PO-1", "qty": 1000, "etaHour": 20}],
             "usedBy": [{"lineId": "L2", "productId": "P1", "qty": 1}]},
        ],
        "products": [{"id": "P1", "name": "Controller", "sku": "CTL-100", "unitPrice": 120, "unitMaterialCost": 40}],
        "lines": [
            {"id": "L1", "name": "Assembly 1", "kind": "assembly", "capabilities": [{"productId": "P1", "ratePerHour": 20}], "allocation": {"P1": 1}},
            {"id": "L2", "name": "Packing", "kind": "packaging", "capabilities": [{"productId": "P1", "ratePerHour": 40}], "allocation": {"P1": 1}},
        ],
        "orders": [{"id": "SO-1", "customer": "Acme", "productId": "P1", "quantity": 2000, "fulfilled": 100, "dueHour": 96}],
        "cameras": [{"id": "CAM-AOI", "name": "AOI", "kind": "aoi", "lineId": "L1"}],
    }


def test_sync_computes_enabled_features_only():
    out = client.post("/api/v1/twin/sync", json=snapshot(features=["maintenance"])).json()
    assert set(out["insights"]) == {"maintenance"} and out["errors"] == {}


def test_maintenance_uses_asset_limits_and_trend():
    m = client.post("/api/v1/twin/sync", json=snapshot(features=["maintenance"]))
    m = m.json()["insights"]["maintenance"]
    rob = next(a for a in m["assets"] if a["assetId"] == "ROB-1")
    cnv = next(a for a in m["assets"] if a["assetId"] == "CNV-1")
    prs = next(a for a in m["assets"] if a["assetId"] == "PRS-1")
    # 2.0 + 0.07 * 59 = 6.13 mm/s, between the alarm (4.5) and trip (7.1): zone C, trending at 0.42 mm/s/h
    assert rob["isoZone"] == "ZONE_C_UNSATISFACTORY" and rob["risk"] in ("high", "medium")
    assert abs(rob["hoursToTrip"] - (7.1 - 6.13) / (0.07 * 6)) < 0.2
    assert cnv["hoursToTrip"] is None and cnv["risk"] == "low"
    assert prs["status"] == "maintenance"
    assert m["assets"][0]["assetId"] == "ROB-1"


def test_supply_runway_and_purchase_order():
    out = client.post("/api/v1/twin/sync", json=snapshot(features=["supply"])).json()
    assert out["errors"] == {}  # fractional stock (300.6) is fine
    s = out["insights"]["supply"]
    mcu = next(i for i in s["items"] if i["itemId"] == "MCU-7")
    box = next(i for i in s["items"] if i["itemId"] == "BOX")
    assert mcu["runwayHours"] == 15.0 and mcu["atRisk"] is True
    po = mcu["purchaseOrder"]
    assert po["supplier"] == "Acme" and po["etaInHours"] == 72 and po["urgency"] == "CRITICAL"
    assert po["qty"] >= 20 * (72 + 48) + 800 - 300 and po["cost"] == round(po["qty"] * 6.5, 2)
    assert box["purchaseOrder"] is None and box["runwayHours"] == 2550.0
    assert next(line for line in s["lines"] if line["lineId"] == "L1")["criticalItemId"] == "MCU-7"


def test_supply_does_not_order_twice_and_flags_late_inbound():
    snap = snapshot(features=["supply"], facility="F-LATE")
    snap["items"][0]["inbound"] = [{"poId": "PO-9", "qty": 10800, "etaHour": 10.0 + 72}]
    s = client.post("/api/v1/twin/sync", json=snap).json()["insights"]["supply"]
    mcu = next(i for i in s["items"] if i["itemId"] == "MCU-7")
    assert mcu["purchaseOrder"] is None and mcu["expediteNeeded"] is True
    assert s["counts"]["toExpedite"] == 1


def test_demand_forecast_is_reproducible_and_cached_per_day():
    a = client.post("/api/v1/twin/sync", json=snapshot(features=["demand"], facility="F-DEM")).json()["insights"]["demand"]
    p = a["products"][0]
    assert len(p["forecast"]) == a["horizonDays"] and p["capacityPerDay"] == round(20 * 24 * 0.85, 1)
    assert all(pt["p10_units"] <= pt["p50_units"] <= pt["p90_units"] for pt in p["forecast"])
    assert "SIMULATED" in a["provenance"]
    b = client.post("/api/v1/twin/sync", json=snapshot(features=["demand"], facility="F-DEM", sim_hour=11.0)).json()["insights"]["demand"]
    assert b["products"][0]["forecast"] == p["forecast"]


def test_vision_inspection_and_disposition():
    png = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5e1d6f50000000049454e44ae426082")
    r = client.post("/api/v1/twin/F-VIS/inspect", data={"camera_id": "CAM-AOI", "line_id": "L1", "product_id": "P1", "sim_hour": "3"},
                    files={"image": ("board.png", io.BytesIO(png), "image/png")})
    assert r.status_code == 200
    insp = r.json()
    assert insp["plant_id"] == "F-VIS" and insp["line_id"] == "L1"
    v = client.get("/api/v1/twin/F-VIS/analytics/vision").json()["insights"]
    assert v["counts"]["inspected"] == 1 and v["lines"][0]["lineId"] == "L1"
    d = client.post(f"/api/v1/twin/F-VIS/inspections/{insp['inspection_id']}/disposition", json={"action": "dismiss", "auditor": "QA"})
    assert d.status_code == 200
    assert client.post("/api/v1/twin/F-VIS/inspections/NOPE/disposition", json={"action": "dismiss", "auditor": "QA"}).status_code == 404


def test_analytics_returns_series():
    client.post("/api/v1/twin/sync", json=snapshot(features=["maintenance", "supply"], facility="F-SER", sim_hour=1.0))
    client.post("/api/v1/twin/sync", json=snapshot(features=["maintenance", "supply"], facility="F-SER", sim_hour=2.0))
    m = client.get("/api/v1/twin/F-SER/analytics/maintenance").json()
    assert {r["sim_hour"] for r in m["series"]} == {1.0, 2.0}
    s = client.get("/api/v1/twin/F-SER/analytics/supply").json()
    assert len(s["series"]) == 4
    assert client.get("/api/v1/twin/F-SER/analytics/nope").status_code == 404
