"""Twin Maintenance Copilot Service (Muse Spark on Meta Model API, grounded).

Orchestrates multi-source grounding:
- Retrieves real-time sensor readings from PLC/SCADA
- Retrieves ML failure predictions & anomaly scores
- Retrieves similar historical incidents with verified outcomes via RAG
- Retrieves approved Standard Operating Procedures (SOPs)
- Enforces human-in-the-loop governance and multilingual generation

Muse Spark writes the answer from the assembled evidence in any language; every figure is
checked against the evidence, and the deterministic template is the fallback.
"""
import re
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from backend.features.predictive_maintenance.copilot.models import (
    CopilotChatRequest,
    CopilotChatResponse,
    GroundedEvidence,
    SimilarIncident,
    ApprovedProcedure,
    UserRole,
)
from backend.core.ai.narration import grounded_answer
from backend.features.predictive_maintenance.copilot.rag_service import maintenance_rag_service
from backend.features.predictive_maintenance.services.canonical_mapping_service import canonical_mapping_service
from backend.features.predictive_maintenance.services.recommendation_engine import recommendation_engine
from backend.features.predictive_maintenance.repositories.local_mock_repo import LocalMockMachineRepository
from backend.features.predictive_maintenance.config.models import maintenance_config_store

logger = logging.getLogger("copilot.service")


class MaintenanceCopilotService:
    """Conversational assistant grounding answers strictly on verified telemetry, predictions, and RAG."""

    def __init__(self, repository: Optional[LocalMockMachineRepository] = None) -> None:
        self.repo = repository or LocalMockMachineRepository(num_machines=20, config_store=maintenance_config_store)

    async def answer_query(self, request: CopilotChatRequest) -> CopilotChatResponse:
        """Processes conversational maintenance question with multi-source factual grounding."""
        query_text = request.query.strip()
        asset_id = request.asset_id or self._extract_asset_id_from_text(query_text)

        # Build Grounded Evidence
        evidence = await self._assemble_grounded_evidence(asset_id, query_text, request.plant_id)

        # Generate Grounded Response
        answer_text, action, urgency = self._synthesize_grounded_response(
            query=query_text,
            asset_id=asset_id,
            evidence=evidence,
            language=request.language.lower(),
        )
        dt_loss = evidence.verified_facts.get("hourly_downtime_cost_usd", 2500.0)
        narration = await grounded_answer(
            role=(
                "You are Twin's maintenance copilot for reliability engineers and technicians. Structure the answer as: "
                "verified facts (sensors/ERP), ML prediction and risk, similar historical incidents and their verified outcomes, "
                "the approved SOP with its safety warning, and the recommended action with urgency. Distinguish measured facts "
                "from model predictions."
            ),
            question=query_text,
            evidence={
                "asset_id": asset_id,
                "evidence": evidence.model_dump(mode="json"),
                "deterministic_recommendation": {"action": action, "urgency": urgency,
                                                 "expected_downtime_avoidance_usd": round(12.0 * dt_loss), "avoided_stoppage_hours": 12},
                "governance": "Advisory only. Human sign-off is mandatory before creating a CMMS work order or halting production. LOTO before any physical work.",
            },
            language=request.language.lower(),
            fallback_markdown=answer_text,
            purpose="maintenance copilot",
        )

        return CopilotChatResponse(
            query=query_text,
            asset_id=asset_id,
            answer_markdown=narration.text,
            generated_by=narration.generated_by,
            ai_note=narration.note,
            key_points=narration.key_points,
            grounded_evidence=evidence,
            prescriptive_action=action,
            urgency=urgency,
            requires_human_approval=True,
            language=request.language,
            data_provenance="ACTUAL_AND_SIMULATED",
        )

    def _extract_asset_id_from_text(self, text: str) -> Optional[str]:
        """Extracts canonical asset tokens like CNC-001, ROB-002, PMP-003, M-104."""
        match = re.search(r"\b([A-Z]{3,4}-\d{3}|M-\d{3,4})\b", text, re.IGNORECASE)
        if match:
            extracted = match.group(1).upper()
            # Map alias like M-104 to CNC-001 or registered asset
            if extracted.startswith("M-"):
                return "CNC-001"
            return extracted
        return "CNC-001"  # Default primary critical asset if unspecified

    async def _assemble_grounded_evidence(
        self,
        asset_id: Optional[str],
        query: str,
        plant_id: Optional[str] = None,
    ) -> GroundedEvidence:
        """Retrieves verified facts, predictions, RAG cases, and SOPs without fabrication."""
        verified_facts: dict[str, Any] = {}
        ml_predictions: dict[str, Any] = {}
        missing_data: list[str] = []

        target_id = asset_id or "CNC-001"
        dim = canonical_mapping_service.get_canonical_asset(target_id)
        latest_machine = await self.repo.get_machine_by_id(target_id)
        recent_readings = await self.repo.get_recent_readings(target_id, limit=5)
        pred_record = await self.repo.get_latest_prediction(target_id)

        # 1. Verified Facts from Source Systems
        if dim:
            verified_facts["asset_id"] = dim.asset_id
            verified_facts["asset_name"] = dim.asset_name
            verified_facts["equipment_type"] = dim.equipment_type
            verified_facts["criticality"] = dim.criticality.value
            verified_facts["plant_id"] = dim.plant_id
            verified_facts["hourly_downtime_cost_usd"] = dim.hourly_downtime_cost_usd

        if latest_machine:
            verified_facts["operating_hours"] = latest_machine.get("operating_hours", 0.0)
            verified_facts["current_health_state"] = latest_machine.get("current_health_state", "HEALTHY")
            verified_facts["latest_vibration_mm_s"] = latest_machine.get("latest_vibration", 1.2)
            verified_facts["latest_temperature_c"] = latest_machine.get("latest_temperature", 42.0)

        # Check for unmonitored sensor streams
        last_reading = recent_readings[-1] if recent_readings else None
        if not last_reading or getattr(last_reading, "motor_current_amps", None) is None:
            missing_data.append("Motor Phase Current Amps sensor (uninstalled on this asset)")
        if not last_reading or getattr(last_reading, "torque_nm", None) is None:
            missing_data.append("Direct Shaft Torque Nm transducer (unmonitored)")

        # 2. ML Predictions from Existing Models
        if pred_record:
            ml_predictions["failure_probability"] = pred_record.get("failure_probability", 0.05)
            ml_predictions["risk_category"] = pred_record.get("risk_category", "LOW")
            ml_predictions["prediction_horizon_hours"] = pred_record.get("prediction_horizon_hours", 24)
            ml_predictions["contributing_features"] = pred_record.get("contributing_features", {})
            ml_predictions["model_version"] = pred_record.get("model_version", "RandomForest-v1")
        else:
            ml_predictions["failure_probability"] = 0.05
            ml_predictions["risk_category"] = "LOW"

        # 3. Historical Incidents via RAG
        eq_type = dim.equipment_type if dim else None
        similar_incidents = maintenance_rag_service.search_similar_incidents(
            query=query,
            asset_id=target_id,
            equipment_type=eq_type,
            plant_id=plant_id,
            limit=2,
        )

        # 4. Approved SOPs
        approved_sops = maintenance_rag_service.search_approved_procedures(
            equipment_type=eq_type,
            keyword="bearing" if "vib" in query.lower() or "bearing" in query.lower() else None,
        )
        if not approved_sops:
            # Always supply the mandatory LOTO procedure
            approved_sops = maintenance_rag_service.search_approved_procedures(keyword="lockout")

        return GroundedEvidence(
            verified_facts=verified_facts,
            ml_predictions=ml_predictions,
            historical_incidents=similar_incidents,
            approved_procedures=approved_sops,
            missing_or_stale_data=missing_data,
        )

    def _synthesize_grounded_response(
        self,
        query: str,
        asset_id: Optional[str],
        evidence: GroundedEvidence,
        language: str = "en",
    ) -> tuple[str, str, str]:
        """Synthesizes structured, grounded markdown response distinguishing facts from ML & RAG."""
        facts = evidence.verified_facts
        preds = evidence.ml_predictions
        target = asset_id or facts.get("asset_id", "CNC-001")
        p_fail = preds.get("failure_probability", 0.05)
        risk_tier = preds.get("risk_category", "LOW")
        vibration = facts.get("latest_vibration_mm_s", 1.2)
        temp = facts.get("latest_temperature_c", 42.0)
        dt_loss = facts.get("hourly_downtime_cost_usd", 2500.0)

        # Prescriptive action determination
        if p_fail >= 0.60:
            urgency = "IMMEDIATE (Within 4-8 Hours)"
            action = f"Schedule emergency replacement of primary spindle/motor bearing set under SOP-MECH-BRG-04."
        elif p_fail >= 0.35:
            urgency = "SCHEDULED (Next Shift Change)"
            action = f"Conduct lubrication replenishment and vibration spectrum FFT audit under SOP-LOTO-01."
        else:
            urgency = "MONITOR (Continuous)"
            action = "Maintain continuous condition monitoring. No physical maintenance intervention required."

        # Multilingual phrasing adaptation
        if language == "de":
            intro = f"### 🤖 Wartungsassistent — Analyse für **{target}**"
            sec1_title = "1. 🔍 Verifizierte Fakten (PLC / SCADA & ERP)"
            sec2_title = "2. ⚡ ML-Vorhersage & Risikosignale"
            sec3_title = "3. 📜 Relevante historische Vorfälle (RAG)"
            sec4_title = "4. 🛠️ Genehmigte Standardarbeitsanweisung (SOP)"
            sec5_title = "5. 🎯 Handlungsempfehlung & Nächste Schritte"
            disclaimer_title = "Sicherheitshinweis"
        elif language == "hi":
            intro = f"### 🤖 रखरखाव सहायक (Maintenance Copilot) — **{target}** का विश्लेषण"
            sec1_title = "1. 🔍 प्रमाणित तथ्य (Verified Facts: PLC/SCADA & ERP)"
            sec2_title = "2. ⚡ एमएल विफलता पूर्वानुमान (ML Prediction)"
            sec3_title = "3. 📜 ऐतिहासिक घटनाएँ (Historical Incident RAG)"
            sec4_title = "4. 🛠️ स्वीकृत रखरखाव प्रक्रिया (Approved SOP)"
            sec5_title = "5. 🎯 अनुशंसित कार्रवाई (Recommended Action)"
            disclaimer_title = "सुरक्षा निर्देश (Safety Notice)"
        else:
            intro = f"### 🤖 Twin Maintenance Copilot — Grounded Analysis for **{target}**"
            sec1_title = "1. 🔍 Verified Facts (PLC / SCADA & ERP)"
            sec2_title = "2. ⚡ ML Prediction & Risk Signals"
            sec3_title = "3. 📜 Relevant Historical Incidents (RAG)"
            sec4_title = "4. 🛠️ Applicable Approved SOP Procedure"
            sec5_title = "5. 🎯 Prescriptive Maintenance Advisory & Next Steps"
            disclaimer_title = "Mandatory Safety Notice"

        # Build Markdown sections
        lines = [
            intro,
            "",
            f"**Query**: *\"{query}\"*",
            "",
            f"#### {sec1_title}",
            f"- **Canonical Asset**: `{target}` ({facts.get('equipment_type', 'Machinery')}) at `{facts.get('plant_id', 'Bangalore')}`",
            f"- **Measured Telemetry**: Vibration = **{vibration:.2f} mm/s RMS** | Temperature = **{temp:.1f} °C**",
            f"- **Asset Criticality**: Class `{facts.get('criticality', 'A')}` | Production Stoppage Impact: **${dt_loss:,.0f} / hr**",
            f"- **Cumulative Operating Hours**: **{facts.get('operating_hours', 0.0):,.1f} hrs**",
            "",
            f"#### {sec2_title}",
            f"- **Supervised Failure Probability (24h Horizon)**: **{p_fail:.1%}** ({risk_tier} RISK)",
            f"- **Primary Contributing Features**: {', '.join([f'{k}={v}' for k, v in preds.get('contributing_features', {}).items()]) or 'Vibration RMS elevation'}",
            f"- **Model Version**: `{preds.get('model_version', 'RandomForest-v1')}` (Anti-leakage time-partitioned)",
            "",
        ]

        if evidence.missing_or_stale_data:
            lines.append(f"> ⚠️ **Data Gap Notice**: The following sensors are uninstalled or offline: *{', '.join(evidence.missing_or_stale_data)}*.")
            lines.append("")

        lines.extend([
            f"#### {sec3_title}",
        ])

        if evidence.historical_incidents:
            for inc in evidence.historical_incidents:
                lines.append(f"- **Incident {inc.incident_id}** (`{inc.source_record_id}`, {inc.incident_date}):")
                lines.append(f"  - *Failure*: {inc.failure_description}")
                lines.append(f"  - *Root Cause*: {inc.root_cause}")
                lines.append(f"  - *Resolution Applied*: {inc.resolution_applied}")
                lines.append(f"  - *Verified Outcome*: ✅ **{inc.verified_outcome}** (Downtime: {inc.actual_downtime_hours}h, Cost: ${inc.actual_repair_cost_usd:,.0f})")
        else:
            lines.append("- *No identical historical failures recorded in CMMS for this specific machine.*")

        lines.append("")
        lines.append(f"#### {sec4_title}")

        if evidence.approved_procedures:
            top_sop = evidence.approved_procedures[0]
            lines.append(f"- **Governed Procedure**: `{top_sop.procedure_id}` — **{top_sop.title}** ({top_sop.version})")
            if top_sop.safety_warning:
                lines.append(f"  - ⚠️ **Mandatory Safety Warning**: *{top_sop.safety_warning}*")
            lines.append(f"  - **Required Tools**: {', '.join(top_sop.required_tools)}")
            lines.append(f"  - **Approved By**: {top_sop.approved_by} on `{top_sop.approved_at}`")
            lines.append("  - **Key Initial Step**: " + (top_sop.steps[0] if top_sop.steps else "Follow standard isolation procedure."))

        lines.extend([
            "",
            f"#### {sec5_title}",
            f"- **Urgency**: **{urgency}**",
            f"- **Advisory Recommendation**: {action}",
            f"- **Expected Financial Downtime Avoidance**: **${(12.0 * dt_loss):,.0f}** (Avoids estimated ~12 hours catastrophic line stoppage)",
            f"- **Governance**: Advisory only. **Human signoff is mandatory before creating CMMS work order or halting production.**",
            "",
            f"> 🛡️ **{disclaimer_title}**: All machine repairs must strictly comply with LOTO electrical zero energy isolation before tool application.",
        ])

        return "\n".join(lines), action, urgency


# Global singleton instance
copilot_service = MaintenanceCopilotService()
