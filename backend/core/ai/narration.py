"""Grounded narration: Muse writes the prose, deterministic code owns the facts.

``grounded_answer`` sends structured evidence (already computed by deterministic services) to
Muse Spark (or Muse Wonder for planning), asks for a markdown answer in the user's language,
and rejects it if it states any figure that is not in the evidence. Callers keep their
deterministic template as the fallback, so the API never depends on a model being available.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Optional

from backend.core.ai.meta import MetaAIError, MetaModelClient, meta_client, ungrounded_figures

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "answer_markdown": {"type": "string", "description": "The answer in markdown, in the requested language."},
        "key_points": {"type": "array", "items": {"type": "string"}, "description": "2-5 short evidence bullets."},
    },
    "required": ["answer_markdown", "key_points"],
}

BASE_RULES = (
    "Rules: use ONLY the JSON evidence provided. Every number you state must appear in the evidence "
    "(you may round). Never invent ids, costs, probabilities or dates. If the evidence does not answer "
    "the question, say so. Keep safety and human-approval notices from the evidence. Do not tell anyone "
    "to bypass interlocks or lock-out/tag-out. Answer concisely in markdown with short headings."
)


@dataclass
class NarrationResult:
    text: str
    key_points: list[str]
    generated_by: str
    note: Optional[str] = None


async def grounded_answer(
    *,
    role: str,
    question: str,
    evidence: Any,
    language: str = "en",
    fallback_markdown: str,
    reasoning: bool = False,
    client: Optional[MetaModelClient] = None,
    purpose: str = "copilot answer",
) -> NarrationResult:
    """Muse-written, grounding-checked answer; the deterministic markdown when AI is off or fails."""
    c = client or meta_client
    if not c.enabled:
        return NarrationResult(fallback_markdown, [], "deterministic-template", "Meta Model API not configured; deterministic answer.")
    model = c.config.meta_reasoning_model if reasoning else c.config.meta_model
    try:
        out = await c.generate_json(
            system=f"{role}\n{BASE_RULES}\nRespond in the language with code '{language}'.",
            prompt=f"QUESTION: {question}\n\nEVIDENCE (JSON):\n{json.dumps(evidence, default=str)[:60000]}",
            schema=ANSWER_SCHEMA,
            name="grounded_answer",
            reasoning=reasoning,
            purpose=purpose,
        )
        text = str(out.get("answer_markdown") or "").strip()
        points = [str(p) for p in (out.get("key_points") or [])][:5]
        if len(text) < 20:
            raise MetaAIError("empty answer")
        bad = ungrounded_figures(text + " " + " ".join(points), [evidence, question])
        if bad:
            raise MetaAIError(f"grounding check failed: {', '.join(bad[:3])} not in evidence")
        return NarrationResult(text, points, model, "Muse-written from the evidence; every figure traced to it.")
    except MetaAIError as e:
        return NarrationResult(fallback_markdown, [], "deterministic-template", f"{model} unavailable ({str(e)[:140]}); deterministic answer.")
