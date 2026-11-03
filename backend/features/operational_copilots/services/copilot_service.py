"""Operational copilot service: deterministic records, Muse Spark briefings (Meta Model API)."""
from pathlib import Path
from typing import Optional

from backend.core.ai.narration import grounded_answer
from backend.features.operational_copilots.ports.contracts import (
    IOperationalCopilotUseCase,
    IShiftLogReader,
)
from backend.features.operational_copilots.domain.models import (
    SOPStep,
    ShiftHandoverReport,
    AlarmDiagnostic,
)
from backend.features.operational_copilots.config.models import (
    CopilotConfigStore,
    copilot_config_store,
)


class OperationalCopilotService(IOperationalCopilotUseCase):
    def __init__(
        self,
        log_reader: IShiftLogReader,
        config_store: Optional[CopilotConfigStore] = None,
    ) -> None:
        self.reader = log_reader
        self.config_store = config_store or copilot_config_store

    async def get_sop_step(self, procedure_id: str, step_number: int) -> SOPStep:
        cfg = self.config_store.get_config()
        warning = "DANGER: Arc flash hazard. Wear Level 2 arc flash shield." if cfg.enable_safety_lockout_enforcement else None

        return SOPStep(
            step_number=step_number,
            title="Lockout / Tagout (LOTO) & Bearing Decoupling",
            instruction="Isolate 480V main power disconnect breaker switch Q1. Attach safety padlock and verify zero energy state with multimeter.",
            safety_warning=warning,
            required_tools=["Torque Wrench 45 Nm", "Fluke Multimeter", "Lockout Padlock #4"],
        )

    async def generate_shift_handover(self, line_id: str, shift_name: Optional[str] = None) -> ShiftHandoverReport:
        cfg = self.config_store.get_config()
        active_shift = shift_name or cfg.default_shift_name
        units, scrap_pct, incidents = await self.reader.get_shift_metrics(line_id)

        report = ShiftHandoverReport(
            line_id=line_id,
            shift_name=active_shift,
            units_produced=units,
            scrap_rate_pct=scrap_pct,
            major_incidents=incidents,
            pending_work_orders=["WO-2026-88: Bearing replacement for A-ROB-03"],
            next_shift_priorities=[
                "Monitor vibration on robot cell 2 after changeover",
                "Replenish SMT component reel CMP-PWR-04",
            ],
        )
        narration = await grounded_answer(
            role="You are Twin's shift-handover assistant. Write a short handover for the incoming shift lead: output, scrap, incidents, open work orders and priorities.",
            question=f"Shift handover for line {line_id}, {active_shift} shift",
            evidence=report.model_dump(mode="json", exclude={"summary_markdown", "generated_by"}),
            fallback_markdown="",
            purpose="shift handover",
        )
        if narration.text:
            report.summary_markdown, report.generated_by = narration.text, narration.generated_by
        return report

    async def diagnose_alarm(self, asset_id: str, alarm_code: str) -> AlarmDiagnostic:
        diag = AlarmDiagnostic(
            alarm_code=alarm_code,
            asset_id=asset_id,
            severity="CRITICAL",
            description=f"High vibration excursion detected on {asset_id} joint 2 actuator.",
            recommended_troubleshooting_steps=[
                "Halt line before trip threshold breach.",
                "Inspect harmonic drive gearbox for metal shavings or grease degradation.",
                "Perform mechanical backlash verification test.",
            ],
            relevant_manual_section="AX6 Technical Service Bulletin Sec 4.2: Drive Maintenance",
        )
        diag.manual_excerpt = _manual_excerpt(("vibration", "gearbox", "bearing", "drive"))
        narration = await grounded_answer(
            role="You are Twin's alarm triage assistant for maintenance technicians. Explain the alarm, the likely cause and the troubleshooting steps, citing the manual excerpt. Safety first: never skip lock-out/tag-out.",
            question=f"Explain alarm {alarm_code} on {asset_id}",
            evidence=diag.model_dump(mode="json", exclude={"explanation_markdown", "generated_by"}),
            fallback_markdown="",
            purpose="alarm triage",
        )
        if narration.text:
            diag.explanation_markdown, diag.generated_by = narration.text, narration.generated_by
        return diag


_DOCS = Path(__file__).resolve().parents[4] / "content" / "docs"


def _manual_excerpt(keywords: tuple[str, ...], max_chars: int = 1500) -> Optional[str]:
    """Best-matching paragraph from the local maintenance manuals (keyword overlap)."""
    best, score = None, 0
    for f in sorted(_DOCS.glob("*.md")) if _DOCS.exists() else []:
        for para in f.read_text(encoding="utf-8").split("\n\n"):
            s = sum(para.lower().count(k) for k in keywords)
            if s > score:
                best, score = f"[{f.stem}] {para.strip()}", s
    return best[:max_chars] if best else None
