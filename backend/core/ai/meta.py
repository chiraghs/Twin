"""Meta Model API client shared by every backend feature.

- Muse Spark / Muse Wonder through the Responses API (structured JSON via ``text.format``)
- SAM 3.1 promptable segmentation (``<|box;…|>`` tokens) through the Responses API
- Muse Image through ``/images/generations``

Design rules, the same as the web app:
  * deterministic engines compute every number; models only explain, extract or localise;
  * every structured output is validated by the caller (pydantic);
  * :func:`ungrounded_figures` rejects text that states numbers absent from the evidence;
  * without ``MODEL_API_KEY`` (or with ``AI_ENABLED=false``) ``enabled`` is False and callers
    use their deterministic fallbacks.
"""
from __future__ import annotations

import base64
import json
import logging
import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Optional

import httpx

from backend.core.config.settings import BackendSettings, settings as default_settings

logger = logging.getLogger("core.ai.meta")

_BOX_RE = re.compile(
    r"<\|box;x1=(-?[\d.]+);y1=(-?[\d.]+);x2=(-?[\d.]+);y2=(-?[\d.]+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>"
)
_RETRYABLE = re.compile(r"\b(429|500|502|503|504)\b|timed out|timeout|connection", re.I)


class MetaAIError(RuntimeError):
    """Raised when Meta Model API is unavailable or returns an unusable result."""


@dataclass(frozen=True)
class SegmentBox:
    """A SAM 3.1 instance box in source-image pixels."""
    x1: float
    y1: float
    x2: float
    y2: float
    w: int
    h: int
    confidence: Optional[float] = None

    def normalized(self) -> dict[str, float]:
        """Box as fractions of the image: {x, y, w, h} in 0–1."""
        return {
            "x": round(self.x1 / self.w, 4),
            "y": round(self.y1 / self.h, 4),
            "w": round((self.x2 - self.x1) / self.w, 4),
            "h": round((self.y2 - self.y1) / self.h, 4),
        }


def parse_sam_boxes(text: str) -> list[SegmentBox]:
    """Parse SAM 3.1 special-token output: one box token (then a mask token) per matched object."""
    out = []
    for m in _BOX_RE.finditer(text or ""):
        out.append(SegmentBox(float(m[1]), float(m[2]), float(m[3]), float(m[4]), int(m[5]), int(m[6]),
                              float(m[7]) if m[7] else None))
    return out


def _numbers(value: Any, acc: set[str]) -> None:
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        for v in (value, round(value), round(value, 1), round(value, 2), round(value * 100), round(value * 100, 1), abs(value)):
            acc.add(_norm(v))
    elif isinstance(value, str):
        for m in re.findall(r"-?\d[\d,]*\.?\d*", value):
            try:
                _numbers(float(m.replace(",", "")), acc)
            except ValueError:
                pass
    elif isinstance(value, dict):
        for v in value.values():
            _numbers(v, acc)
    elif isinstance(value, (list, tuple, set)):
        for v in value:
            _numbers(v, acc)
    elif hasattr(value, "model_dump"):
        _numbers(value.model_dump(mode="json"), acc)


def _norm(v: float) -> str:
    f = float(v)
    return str(int(f)) if f.is_integer() else repr(round(f, 4))


def ungrounded_figures(text: str, evidence: Any, min_value: float = 10.0) -> list[str]:
    """Numbers ≥ ``min_value`` in ``text`` that do not appear (at any common rounding) in ``evidence``."""
    allowed: set[str] = set()
    _numbers(evidence, allowed)
    bad = []
    for raw in re.findall(r"\d[\d,]*\.?\d*", text or ""):
        s = raw.replace(",", "").rstrip(".")
        try:
            n = float(s)
        except ValueError:
            continue
        if n < min_value:
            continue
        if _norm(n) not in allowed and _norm(round(n)) not in allowed and _norm(round(n, 1)) not in allowed:
            bad.append(s)
    return bad


def _response_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    text = ""
    for item in data.get("output") or []:
        for c in item.get("content") or []:
            if isinstance(c, dict) and isinstance(c.get("text"), str) and c.get("type", "output_text") == "output_text":
                text += c["text"]
    return text


def _parse_json(text: str) -> Any:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        start = t.find("{")
        end = t.rfind("}")
        if start >= 0 and end > start:
            return json.loads(t[start:end + 1])
        raise


class MetaModelClient:
    """Thin async client for Meta Model API with call bookkeeping for status pages."""

    def __init__(self, config: Optional[BackendSettings] = None, transport: Optional[httpx.AsyncBaseTransport] = None) -> None:
        self.config = config or default_settings
        self._transport = transport
        self.calls: deque[dict[str, Any]] = deque(maxlen=100)

    # ------------------------------------------------------------------ status
    @property
    def enabled(self) -> bool:
        return bool(self.config.ai_enabled and self.config.model_api_key)

    def status(self) -> dict[str, Any]:
        return {
            "provider": "Meta Model API",
            "enabled": self.enabled,
            "reason": None if self.enabled else ("AI_ENABLED=false" if not self.config.ai_enabled else "MODEL_API_KEY not set"),
            "models": {
                "agent": self.config.meta_model,
                "reasoning": self.config.meta_reasoning_model,
                "segmentation": self.config.meta_segmentation_model,
                "image": self.config.meta_image_model,
            },
            "recent_calls": list(self.calls)[:20],
        }

    def _record(self, model: str, purpose: str, started: float, ok: bool, detail: str = "") -> None:
        self.calls.appendleft({"model": model, "purpose": purpose, "ok": ok, "ms": int((time.perf_counter() - started) * 1000),
                               "detail": detail[:200]})

    # ------------------------------------------------------------------ transport
    async def _post(self, path: str, body: dict[str, Any], timeout: Optional[float] = None) -> dict[str, Any]:
        if not self.enabled:
            raise MetaAIError("Meta Model API is not configured (set MODEL_API_KEY)")
        url = f"{self.config.meta_api_base.rstrip('/')}{path}"
        headers = {"authorization": f"Bearer {self.config.model_api_key}", "content-type": "application/json"}
        last: Exception | None = None
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=timeout or self.config.ai_timeout_s, transport=self._transport) as http:
                    r = await http.post(url, headers=headers, json=body)
                if r.status_code >= 400:
                    try:
                        err = r.json().get("error", {})
                        msg = err.get("message") or err.get("type") or r.text
                    except ValueError:
                        msg = r.text
                    raise MetaAIError(f"{r.status_code} {str(msg)[:300]}")
                return r.json()
            except (MetaAIError, httpx.HTTPError) as e:
                last = e
                if attempt == 0 and _RETRYABLE.search(str(e)):
                    continue
                break
        raise MetaAIError(str(last))

    # ------------------------------------------------------------------ Muse Spark / Wonder
    async def generate_json(
        self,
        *,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        name: str = "result",
        images: Optional[list[tuple[bytes, str]]] = None,
        reasoning: bool = False,
        effort: str = "low",
        max_output_tokens: int = 4096,
        purpose: str = "generate",
    ) -> dict[str, Any]:
        """One structured call. ``reasoning=True`` uses Muse Wonder; otherwise Muse Spark."""
        model = self.config.meta_reasoning_model if reasoning else self.config.meta_model
        content: list[dict[str, Any]] = [
            {"type": "input_image", "image_url": f"data:{mime};base64,{base64.b64encode(data).decode()}"} for data, mime in images or []
        ]
        content.append({"type": "input_text", "text": prompt})
        body = {
            "model": model,
            "instructions": system,
            "input": [{"role": "user", "content": content}],
            "text": {"format": {"type": "json_schema", "name": name, "schema": schema, "strict": False}},
            "reasoning": {"effort": effort},
            "max_output_tokens": max_output_tokens,
        }
        started = time.perf_counter()
        try:
            data = await self._post("/responses", body)
            out = _parse_json(_response_text(data))
            if not isinstance(out, dict):
                raise MetaAIError("model returned non-object JSON")
            self._record(model, purpose, started, True)
            return out
        except (MetaAIError, ValueError) as e:
            self._record(model, purpose, started, False, str(e))
            raise MetaAIError(f"{model} {purpose} failed: {e}") from e

    # ------------------------------------------------------------------ SAM 3.1
    async def segment(self, image: bytes, mime: str, concept: str) -> list[SegmentBox]:
        """Every instance of one concept (e.g. "solder bridge") in an image. One concept per request."""
        model = self.config.meta_segmentation_model
        body = {
            "model": model,
            "input": [{"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": concept[:60]},
                {"type": "input_image", "image_url": f"data:{mime};base64,{base64.b64encode(image).decode()}"},
            ]}],
        }
        started = time.perf_counter()
        try:
            boxes = parse_sam_boxes(_response_text(await self._post("/responses", body)))
            self._record(model, f"segment '{concept}'", started, True, f"{len(boxes)} instance(s)")
            return boxes
        except MetaAIError as e:
            self._record(model, f"segment '{concept}'", started, False, str(e))
            raise

    # ------------------------------------------------------------------ Muse Image
    async def generate_image(self, prompt: str, size: str = "1024x1024") -> tuple[bytes, str]:
        model = self.config.meta_image_model
        started = time.perf_counter()
        try:
            data = await self._post("/images/generations", {"model": model, "prompt": prompt[:3800], "n": 1, "size": size,
                                                            "output_format": "png"}, timeout=120)
            b64 = (data.get("data") or [{}])[0].get("b64_json")
            if not b64:
                raise MetaAIError("Muse Image returned no image")
            self._record(model, "generate image", started, True)
            return base64.b64decode(b64), f"image/{data.get('output_format', 'png')}"
        except MetaAIError as e:
            self._record(model, "generate image", started, False, str(e))
            raise


meta_client = MetaModelClient()
