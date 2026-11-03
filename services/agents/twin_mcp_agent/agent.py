"""A Python agent that operates Twin only through its MCP server, running on Meta's Muse Spark.

It shows that the twin's deterministic tools are usable by any agent, not just the in-app
copilot: this agent runs in a separate process, discovers Twin's tools over MCP Streamable HTTP,
and lets Muse Spark (Meta Model API, Responses API function calling) decide which to call.
It is read-only by design: plan proposals are left to the in-app copilot, which has a human
confirmation step.
"""
from __future__ import annotations

import json
import os
from typing import Any, Awaitable, Callable

import contextlib

import httpx
from mcp import ClientSession

try:  # MCP Python SDK 2.x
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared._httpx_utils import create_mcp_http_client

    @contextlib.asynccontextmanager
    async def _connect(url: str, headers: dict[str, str] | None):
        async with create_mcp_http_client(headers=headers) as http:
            async with streamable_http_client(url, http_client=http) as streams:
                yield streams[0], streams[1]

except ImportError:  # MCP Python SDK 1.x
    from mcp.client.streamable_http import streamablehttp_client

    @contextlib.asynccontextmanager
    async def _connect(url: str, headers: dict[str, str] | None):
        async with streamablehttp_client(url, headers=headers) as (read, write, _):
            yield read, write

MCP_URL = os.environ.get("TWIN_MCP_URL", "http://localhost:3000/api/mcp")
TOKEN = os.environ.get("TWIN_MCP_TOKEN")
META_API_BASE = os.environ.get("META_API_BASE", "https://api.meta.ai/v1").rstrip("/")
META_MODEL = os.environ.get("META_MODEL", "muse-spark-1.3")
MAX_STEPS = 8

READ_ONLY_TOOLS = {
    "get_plant_overview",
    "list_assets",
    "diagnose_asset",
    "list_incidents",
    "get_orders",
    "get_inventory",
    "run_what_if",
    "get_quality",
    "get_camera_view",
    "search_audit",
    "get_latest_analysis",
}

INSTRUCTIONS = (
    "You are an operations analyst with read-only access to the Twin industrial digital twin through MCP tools. "
    "Always call tools before answering factual questions; start with get_plant_overview. "
    "Report only figures that appear in tool results, with units and ids exactly as returned; never estimate numbers. "
    "The twin runs a deterministic plant model on simulated demo data, so forecasts are estimates. "
    "You cannot change anything. If asked to act, explain that plans are proposed and approved inside the Twin app. "
    "Answer with a one-line summary followed by up to 5 bullets of evidence."
)

OnToolCall = Callable[[str, dict[str, Any]], None]


async def _muse(input_items: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
    key = os.environ.get("MODEL_API_KEY")
    if not key:
        raise RuntimeError("Set MODEL_API_KEY (Meta Model API) in twin_mcp_agent/.env")
    body = {"model": META_MODEL, "instructions": INSTRUCTIONS, "input": input_items, "tools": tools,
            "reasoning": {"effort": "low"}, "max_output_tokens": 4096}
    async with httpx.AsyncClient(timeout=90) as http:
        r = await http.post(f"{META_API_BASE}/responses", headers={"authorization": f"Bearer {key}"}, json=body)
    if r.status_code >= 400:
        raise RuntimeError(f"Meta Model API {r.status_code}: {r.text[:300]}")
    return r.json()


def _tool_text(result: Any) -> str:
    parts = [getattr(c, "text", "") for c in getattr(result, "content", []) or []]
    text = "\n".join(p for p in parts if p)
    return text or json.dumps(getattr(result, "structured_content", None) or getattr(result, "structuredContent", None) or {})


async def ask(question: str, on_tool_call: OnToolCall | None = None) -> str:
    """Answer one question by letting Muse Spark call Twin's read-only MCP tools."""
    headers = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else None
    async with _connect(MCP_URL, headers) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            listed = await session.list_tools()
            tools = [
                {"type": "function", "name": t.name, "description": t.description or "", "parameters": getattr(t, "input_schema", None) or getattr(t, "inputSchema", None) or {"type": "object", "properties": {}}}
                for t in listed.tools if t.name in READ_ONLY_TOOLS
            ]
            items: list[dict[str, Any]] = [{"role": "user", "content": [{"type": "input_text", "text": question}]}]
            for _ in range(MAX_STEPS):
                data = await _muse(items, tools)
                calls = [o for o in data.get("output", []) if o.get("type") == "function_call"]
                text = "".join(
                    c.get("text", "") for o in data.get("output", []) if o.get("type") == "message" for c in o.get("content", []) if c.get("type") == "output_text"
                )
                if not calls:
                    return text
                for c in calls:
                    items.append({"type": "function_call", "call_id": c["call_id"], "name": c["name"], "arguments": c.get("arguments") or "{}"})
                    args = json.loads(c.get("arguments") or "{}")
                    if on_tool_call:
                        on_tool_call(c["name"], args)
                    if c["name"] not in READ_ONLY_TOOLS:
                        output = json.dumps({"error": f"{c['name']} is not available to this read-only agent"})
                    else:
                        output = _tool_text(await session.call_tool(c["name"], args))
                    items.append({"type": "function_call_output", "call_id": c["call_id"], "output": output[:20000]})
            return "I couldn't finish within the step limit."
