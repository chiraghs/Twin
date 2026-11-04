from fastapi.testclient import TestClient

from backend.main import app


def test_duckdb_reports_run_over_sqlite():
    client = TestClient(app)
    reports = client.get("/api/v1/data/analytics").json()
    assert {r["id"] for r in reports} >= {"demand-monthly", "sensor-health", "supplier-exposure", "ai-usage"}
    for r in reports:
        body = client.get(f"/api/v1/data/analytics/{r['id']}").json()
        assert body["id"] == r["id"]
        assert isinstance(body["rows"], list)
    assert client.get("/api/v1/data/analytics/nope").status_code == 404


def test_service_token_required_when_set(monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_BACKEND_TOKEN", "svc-token-123")
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/data/analytics").status_code == 401
    ok = client.get("/api/v1/data/analytics", headers={"authorization": "Bearer svc-token-123"})
    assert ok.status_code == 200
