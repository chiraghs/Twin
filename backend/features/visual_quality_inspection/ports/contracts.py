"""Ports for visual quality inspection following Hexagonal Architecture."""
from abc import ABC, abstractmethod
from typing import Optional
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.visual_quality_inspection.domain.models import (
    InspectionResult,
    LineQualitySummary,
    DefectFinding,
    AdvisoryExplanation,
    GoldenTemplate,
    HumanDispositionRequest,
    HumanDispositionRecord,
)


class IVisualQualityUseCase(IInputPort, ABC):
    @abstractmethod
    async def inspect_part(
        self, camera_id: str, part_id: str, frame_bytes: Optional[bytes] = None
    ) -> InspectionResult:
        pass

    @abstractmethod
    async def get_line_quality_summary(self, line_id: str) -> LineQualitySummary:
        pass

    @abstractmethod
    async def record_human_disposition(
        self, request: HumanDispositionRequest
    ) -> HumanDispositionRecord:
        pass

    @abstractmethod
    async def register_golden_template(
        self, template: GoldenTemplate
    ) -> GoldenTemplate:
        pass

    @abstractmethod
    async def get_golden_template(
        self, part_number: str
    ) -> Optional[GoldenTemplate]:
        pass


class IInspectionHistoryStore(IOutputPort, ABC):
    @abstractmethod
    async def record_result(self, result: InspectionResult) -> None:
        pass

    @abstractmethod
    async def get_recent_results(self, line_id: str, limit: int = 100) -> list[InspectionResult]:
        pass

    @abstractmethod
    async def record_disposition(self, record: HumanDispositionRecord) -> None:
        pass

    @abstractmethod
    async def get_disposition_audit_trail(self, limit: int = 50) -> list[HumanDispositionRecord]:
        pass

    @abstractmethod
    async def save_golden_template(self, template: GoldenTemplate) -> None:
        pass

    @abstractmethod
    async def get_golden_template(self, part_number: str) -> Optional[GoldenTemplate]:
        pass


class IDefectDetector(IOutputPort, ABC):
    """Detects and localises IPC-A-610 defects (Muse Spark + SAM 3.1, or the local reference detector)."""

    @abstractmethod
    async def predict_defects(self, image_bytes: bytes, part_id: str) -> list[DefectFinding]:
        pass


class IVisualReasoningClient(IOutputPort, ABC):
    """Advisory explanations of an inspection (never the pass/fail authority)."""

    @abstractmethod
    async def generate_inspection_explanation(
        self, part_id: str, defects: list[DefectFinding], similarity: float, image_bytes: Optional[bytes] = None
    ) -> AdvisoryExplanation:
        pass


class IOCRClient(IOutputPort, ABC):
    """Reads serial numbers and barcodes from the part image."""

    @abstractmethod
    async def read_barcode_and_text(self, image_bytes: bytes) -> tuple[Optional[str], Optional[str]]:
        pass


class IOpenCVAlignmentClient(IOutputPort, ABC):
    """Deterministic OpenCV operations: Keypoint homography alignment & pixel difference."""

    @abstractmethod
    def align_and_compute_difference(
        self, live_image_bytes: bytes, golden_template_bytes: Optional[bytes] = None
    ) -> tuple[float, list[DefectFinding]]:
        pass
