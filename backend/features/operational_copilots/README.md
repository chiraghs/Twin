# Operational Copilots Domain (`backend/features/operational_copilots`)

## 1. Domain Overview & Purpose
The **Operational Copilots** module acts as an intelligent assistant for floor operators, maintenance technicians, and shift supervisors. It provides conversational Standard Operating Procedure (SOP) guidance, generates automated shift-handover summaries, and troubleshoots active alarm codes.

---

## 2. Domain Models & Conversational Workflows

### Core Entities & Value Objects (`domain/`)
- `SOPProcedure`: Structured standard work document with ordered steps, safety warnings, required PPE, Lockout/Tagout (LOTO) requirements, and validation checklists.
- `ShiftHandoverReport`: Structured summary of a completed shift including total production, scrap rate, open alarms, maintenance actions taken, and directives passed to the incoming shift.
- `AlarmDiagnostic`: Alarm code, severity, triggering sensor threshold, recommended corrective actions, and reference manual page numbers.
- `CopilotSession`: State-managed conversation context retaining active line and machine focus.

---

## 3. Ports & Contracts (`ports/`)

### Driving Ports (`ports/input/`)
- `IOperationalCopilotUseCase`:
  - `guide_sop_step(procedure_id: str, current_step: int, user_query: str) -> SOPGuidanceResponse`
  - `generate_shift_handover(shift_id: str, line_id: str) -> ShiftHandoverReport`
  - `triage_alarm(alarm_code: str, asset_id: str) -> AlarmDiagnostic`

### Driven Ports (`ports/output/`)
- `IKnowledgeRetrievalPort`: Interfaces with the RAG module to query OEM manuals and SOP documents.
- `IShiftTelemetryAggregator`: Aggregates incidents, work orders, and production counts over the shift duration.
- `IAuditLogger`: Logs copilot questions and answers for continuous operational auditing.

---

## 4. MCP Tools & Agent Interfaces
- `lookup_sop_instructions(procedure_id, step)`: Retrieves verified procedural steps and safety warnings.
- `compile_shift_handover(line_id, shift_start, shift_end)`: Generates structured shift report.
- `explain_plc_alarm(asset_id, alarm_code)`: Provides verified OEM troubleshooting steps for an active alarm.
