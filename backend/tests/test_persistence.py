"""Backend data survives a restart: new repository / service instances read SQLite, not memory."""
import asyncio

from fastapi.testclient import TestClient

from backend.core.db.connection import connection


def test_supply_chain_approval_and_config_survive_restart():
    from backend.features.supply_chain_intelligence.config.models import SupplyChainConfig, SupplyConfigStore
    from backend.features.supply_chain_intelligence.repositories.local_mock_repo import LocalMockSupplyChainRepository

    repo = LocalMockSupplyChainRepository()
    rec = repo.list_mitigations()[0]
    repo.approve_mitigation(rec.recommendation_id, "planner_asha")
    again = LocalMockSupplyChainRepository()  # a "restart": loads from SQLite
    assert again.mitigations[rec.recommendation_id].status == "APPROVED"
    assert again.mitigations[rec.recommendation_id].approved_by == "planner_asha"
    row = connection().execute("SELECT status FROM sc_mitigations WHERE key = ?", (rec.recommendation_id,)).fetchone()
    assert row["status"] == "APPROVED"

    store = SupplyConfigStore()
    cfg = store.get_config().model_copy(deep=True)
    store.update_config(cfg, "tester")
    assert len(SupplyConfigStore().history()) >= 1


def test_inspection_and_disposition_persist():
    from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
    from backend.features.visual_quality_inspection.domain.models import HumanDispositionRequest
    from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService

    svc = VisualQualityService(history_store=InMemoryInspectionStore())
    res = asyncio.run(svc.inspect_part("CAM_AOI_L1", "PART-ECU-777-DEF"))
    asyncio.run(svc.record_human_disposition(HumanDispositionRequest(inspection_id=res.inspection_id, auditor_id="qc9", action="CONFIRM_DEFECT", rationale="Bridge confirmed")))
    fresh = InMemoryInspectionStore()
    stored = next(r for r in fresh._history if r.inspection_id == res.inspection_id)
    assert stored.human_disposition_status == "CONFIRM_DEFECT"
    n = connection().execute("SELECT COUNT(*) FROM vq_defects WHERE inspection_id = ?", (res.inspection_id,)).fetchone()[0]
    assert n == len(res.defects) >= 1


def test_endpoint_outputs_and_data_model_api():
    from backend.main import app

    c = TestClient(app)
    assert c.post("/api/v1/supply-chain/assistant/what-if", json={"target_entity_id": "SUP-MICRO-01", "duration_days": 5}).status_code == 200
    runs = c.get("/api/v1/data/runs/sc_what_if_runs?subject_id=SUP-MICRO-01").json()
    assert runs and runs[0]["result"]["scenario_title"]
    assert c.put("/api/v1/quality/config", json=c.get("/api/v1/quality/config").json()).status_code == 200
    assert c.get("/api/v1/data/config-history/visual_quality_inspection").json()
    model = c.get("/api/v1/data/model").json()
    names = {t["table"] for t in model["tables"]}
    assert {"sc_suppliers", "pm_sensor_readings", "vq_inspections", "df_demand_history", "sc_what_if_runs"} <= names
    assert all(t["rows"] >= 0 for t in model["tables"])


def test_run_history_before_first_run_and_supplier_routes():
    from backend.main import app

    c = TestClient(app)
    assert c.get("/api/v1/data/runs/oc_alarm_triages").status_code == 200  # empty, not an error
    assert c.get("/api/v1/supply-chain/suppliers/concentration").status_code == 200
    assert c.get("/api/v1/supply-chain/suppliers/risks/evaluated").status_code == 200
    assert c.get("/api/v1/supply-chain/suppliers/SUP-MICRO-01").status_code == 200
