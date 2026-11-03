"""Unit tests for FastAPI endpoints."""
try:
    import pytest
except ImportError:
    class _MockPytest:
        class mark:
            @staticmethod
            def asyncio(f):
                return f
    pytest = _MockPytest()
from httpx import AsyncClient, ASGITransport
from backend.main import app


@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "HEALTHY"


@pytest.mark.asyncio
async def test_list_machines():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/machines")
    assert response.status_code == 200
    machines = response.json()
    assert len(machines) >= 20


@pytest.mark.asyncio
async def test_machine_details_and_readings():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res_list = await ac.get("/machines")
        first_machine = res_list.json()[0]["machine_id"]

        res_detail = await ac.get(f"/machines/{first_machine}")
        assert res_detail.status_code == 200

        res_readings = await ac.get(f"/machines/{first_machine}/readings?limit=10")
        assert res_readings.status_code == 200
        assert len(res_readings.json()) <= 10

        res_pred = await ac.get(f"/machines/{first_machine}/predictions")
        assert res_pred.status_code == 200
        assert "failure_probability" in res_pred.json()


@pytest.mark.asyncio
async def test_analytics_summary():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/analytics/summary")
    assert response.status_code == 200
    summary = response.json()
    assert summary["total_machines_monitored"] >= 20
