"""In-memory store adapter for visual quality records, golden templates, and audit logs."""
from typing import Optional
from datetime import datetime, timezone, timedelta
from backend.features.visual_quality_inspection.ports.contracts import IInspectionHistoryStore
from backend.features.visual_quality_inspection.domain.models import (
    InspectionResult,
    InspectionVerdict,
    DefectFinding,
    DefectClass,
    InferenceSource,
    GoldenTemplate,
    HumanDispositionRecord,
)


class InMemoryInspectionStore(IInspectionHistoryStore):
    def __init__(self) -> None:
        self._history: list[InspectionResult] = []
        self._templates: dict[str, GoldenTemplate] = {}
        self._audit_trail: list[HumanDispositionRecord] = []
        self._seed_default_data()

    def _seed_default_data(self) -> None:
        """Seeds realistic historical SMT assembly inspection records with IPC-A-610 defects."""
        now = datetime.now(timezone.utc)

        # 1. Seed Golden Templates
        self._templates["PART-ECU-REV-B"] = GoldenTemplate(
            template_id="GT-ECU-001",
            part_number="PART-ECU-REV-B",
            revision="REV_B",
            template_uri="artifacts://golden-templates/ECU_REV_B_GOLDEN.png",
            keypoints_count=640,
            similarity_tolerance_pct=0.88,
            registered_at=now - timedelta(days=30),
            registered_by="QC_LEAD_ENG",
        )
        self._templates["PART-SERVO-PCB"] = GoldenTemplate(
            template_id="GT-SRV-002",
            part_number="PART-SERVO-PCB",
            revision="REV_C",
            template_uri="artifacts://golden-templates/SERVO_DRIVE_PCB_REV_C.png",
            keypoints_count=820,
            similarity_tolerance_pct=0.90,
            registered_at=now - timedelta(days=20),
            registered_by="QC_LEAD_ENG",
        )

        # 2. Seed 60 recent inspection results (FPY ~ 96.5%)
        for i in range(1, 61):
            ts = now - timedelta(minutes=(60 - i) * 8)
            is_def = (i % 16 == 0)
            if is_def:
                def_class = DefectClass.SOLDER_BRIDGE if i == 16 else (DefectClass.TOMBSTONING if i == 32 else DefectClass.LIFTED_LEAD)
                defects = [
                    DefectFinding(
                        finding_id=f"FND-{i:03d}",
                        defect_class=def_class,
                        confidence=0.94,
                        bounding_box=(140, 95, 38, 22),
                        severity="HIGH",
                        ipc_clause="IPC-A-610 7.3.5 Solder Bridging",
                        source=InferenceSource.LOCAL_REFERENCE_MODEL,
                        area_pixels=836,
                    )
                ]
                verdict = InspectionVerdict.FAIL
                sim = 0.74
            else:
                defects = []
                verdict = InspectionVerdict.PASS
                sim = 0.98

            self._history.append(
                InspectionResult(
                    inspection_id=f"INSP-{i:04d}",
                    camera_id="CAM_AOI_L1",
                    part_id=f"PART-ECU-{i:03d}" + ("-DEF" if is_def else ""),
                    plant_id="PLANT_BANGALORE",
                    line_id="LINE-1",
                    timestamp=ts,
                    verdict=verdict,
                    defects=defects,
                    similarity_score_to_golden=sim,
                    raw_image_uri=f"artifacts://raw-frames/CAM_AOI_L1_{i:04d}.png",
                    annotated_overlay_uri=f"artifacts://overlays/CAM_AOI_L1_{i:04d}_overlay.png" if is_def else None,
                    barcode_decoded=f"SN-ECU-2026-{i:05d}",
                    barcode_grade="A" if not is_def else "B",
                    human_disposition_status="PENDING_REVIEW" if is_def else "AUTO_ACCEPTED",
                )
            )

        # 3. Seed sample human disposition records
        self._audit_trail.append(
            HumanDispositionRecord(
                audit_id="AUD-001",
                inspection_id="INSP-0016",
                auditor_id="AUDITOR-EMP-4091",
                action="CONFIRM_DEFECT",
                prior_verdict=InspectionVerdict.FAIL,
                final_verdict=InspectionVerdict.FAIL,
                rationale="Confirmed solder bridging on QFP-64 pins 12-14. Rework ticket WO-9042 created.",
                timestamp=now - timedelta(hours=3),
            )
        )

    async def record_result(self, result: InspectionResult) -> None:
        self._history.append(result)

    async def get_recent_results(self, line_id: str, limit: int = 100) -> list[InspectionResult]:
        # Filter by line_id if present, else return recent
        matches = [r for r in self._history if r.line_id == line_id]
        if not matches:
            matches = self._history
        return matches[-limit:]

    async def record_disposition(self, record: HumanDispositionRecord) -> None:
        self._audit_trail.append(record)
        # Update matching inspection
        for r in self._history:
            if r.inspection_id == record.inspection_id:
                r.verdict = record.final_verdict
                r.human_disposition_status = record.action
                break

    async def get_disposition_audit_trail(self, limit: int = 50) -> list[HumanDispositionRecord]:
        return self._audit_trail[-limit:]

    async def save_golden_template(self, template: GoldenTemplate) -> None:
        self._templates[template.part_number] = template

    async def get_golden_template(self, part_number: str) -> Optional[GoldenTemplate]:
        return self._templates.get(part_number)
