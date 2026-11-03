# Model Context Protocol (MCP) Server (`backend/mcp`)

The **MCP** module implements an open, standardized interface exposing Twin's analytical tools, plant resources, and diagnostic prompts to any MCP-compliant AI client (Claude Desktop, Claude Code, Cursor, Windsurf, or custom enterprise agents).

---

## Directory Structure

```
backend/mcp/
├── server/          # MCP Server bootstrap supporting Streamable HTTP and stdio transports
├── tools/           # Granular tool definitions partitioned by feature domain
│   ├── maintenance_tools.py   # RUL, vibration diagnosis, ISO classification
│   ├── quality_tools.py       # Camera inspection, defect Pareto, golden comparison
│   ├── production_tools.py    # Line OEE, bottleneck analysis, dispatch schedule
│   ├── supply_tools.py        # Stockout simulation, supplier risk, PO recommendations
│   ├── demand_tools.py        # Forecast generation, backlog analysis, capacity headroom
│   ├── waste_tools.py         # Scrap root cause, energy waste, carbon accounting
│   └── copilot_tools.py       # SOP retrieval, shift report generation, alarm explanation
├── resources/       # Real-time resource URIs (e.g. plant://assets/{id}/telemetry)
└── prompts/         # Standardized industrial prompt templates (e.g. shift_handover, root_cause_investigation)
```

---

## Tool Contracts & Guardrails

1. **Read-Only Guarantees**: All inspection and analytical tools are marked `readOnlyHint: true`. They cannot mutate plant state, schedule directives, or alter database records.
2. **Human-in-the-Loop Confirmation Gate**: Any tool that proposes action (e.g., `propose_maintenance_work_order`, `propose_reroute_directive`) returns a *PendingProposal* requiring explicit human operator approval before execution.
3. **Strict JSON Schema Validation**: Tool arguments are parsed and validated using Pydantic models before executing domain logic.
4. **Numeric Provenance**: Every metric returned includes its source timestamp and calculation formula trace to prevent hallucination.
