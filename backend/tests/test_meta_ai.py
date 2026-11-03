"""Shared Meta Model API layer (backend/core/ai) with recorded responses: no network."""
import json

import httpx
import pytest

from backend.core.ai.meta import MetaModelClient, parse_sam_boxes, ungrounded_figures
from backend.core.ai.narration import grounded_answer
from backend.core.config.settings import BackendSettings


def _client(replies, seen=None):
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(req.content))
        body = replies.pop(0)
        return httpx.Response(200, json={"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(body)}]}]})

    return MetaModelClient(BackendSettings(model_api_key="meta-test-key-0123456789"), transport=httpx.MockTransport(handler))


EVIDENCE = {"asset": "CNC-001", "failure_probability": 0.72, "hourly_downtime_cost_usd": 2500, "avoided_stoppage_hours": 12}


@pytest.mark.asyncio
async def test_grounded_answer_uses_muse_spark_when_figures_trace():
    seen = []
    c = _client([{"answer_markdown": "CNC-001 has a 72% failure risk; downtime costs $2,500 per hour.", "key_points": ["72% risk"]}], seen)
    r = await grounded_answer(role="Maintenance copilot", question="Is CNC-001 at risk?", evidence=EVIDENCE, language="de",
                              fallback_markdown="template", client=c)
    assert r.generated_by == "muse-spark-1.3"
    assert "72%" in r.text
    body = seen[0]
    assert body["model"] == "muse-spark-1.3"
    assert "language with code 'de'" in body["instructions"]
    assert body["text"]["format"]["type"] == "json_schema"


@pytest.mark.asyncio
async def test_grounded_answer_rejects_invented_figures_and_uses_muse_wonder_for_reasoning():
    seen = []
    c = _client([{"answer_markdown": "Replacing the spindle saves $480,000 this year.", "key_points": []}], seen)
    r = await grounded_answer(role="Planner", question="Brief me", evidence=EVIDENCE, fallback_markdown="template", reasoning=True, client=c)
    assert seen[0]["model"] == "muse-wonder-1.0"
    assert r.generated_by == "deterministic-template" and r.text == "template"
    assert "grounding check failed" in (r.note or "")


@pytest.mark.asyncio
async def test_no_key_means_deterministic():
    c = MetaModelClient(BackendSettings(model_api_key=""))
    assert not c.enabled and c.status()["reason"] == "MODEL_API_KEY not set"
    r = await grounded_answer(role="x", question="y", evidence={}, fallback_markdown="template", client=c)
    assert r.text == "template" and r.generated_by == "deterministic-template"


def test_grounding_and_sam_parsing():
    assert ungrounded_figures("72% risk, $2,500/h, 12 hours", EVIDENCE) == []
    assert ungrounded_figures("costs $9,999", EVIDENCE) == ["9999"]
    boxes = parse_sam_boxes("<0f>0<|box;x1=10;y1=20;x2=110;y2=70;w=200;h=100|><|mask;x=0|>1<|box;x1=0;y1=0;x2=50;y2=50;w=200;h=100;c=0.8|>")
    assert len(boxes) == 2 and boxes[1].confidence == 0.8
    assert boxes[0].normalized() == {"x": 0.05, "y": 0.2, "w": 0.5, "h": 0.5}
