"""Local, versioned model registry for the predictive-maintenance classifier.

The failure-risk model is a small scikit-learn forest served inside the backend container, so it
needs no external model host. Each training run is registered with its artifact hash, metrics and
feature list; promotion to "production" is an explicit, audited step (never automatic).
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

REGISTRY_FILE = "registry.json"


class LocalModelRegistry:
    def __init__(self, artifacts_dir: Path) -> None:
        self.dir = Path(artifacts_dir)
        self.file = self.dir / REGISTRY_FILE

    def _load(self) -> dict[str, Any]:
        if self.file.exists():
            return json.loads(self.file.read_text())
        return {"models": [], "production": None}

    def _save(self, data: dict[str, Any]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps(data, indent=2))

    def register(self, artifact: Path, metadata: dict[str, Any], name: str = "predictive-maintenance-rf") -> dict[str, Any]:
        data = self._load()
        digest = hashlib.sha256(Path(artifact).read_bytes()).hexdigest()
        version = len(data["models"]) + 1
        entry = {
            "name": name,
            "version": version,
            "artifact": Path(artifact).name,
            "sha256": digest,
            "metrics": metadata.get("metrics", {}),
            "feature_columns": metadata.get("feature_columns", []),
            "registered_at": datetime.now(timezone.utc).isoformat(),
            "stage": "candidate",
        }
        data["models"].append(entry)
        self._save(data)
        return entry

    def promote(self, version: int, approved_by: str) -> dict[str, Any]:
        """Human-approved promotion of a candidate to production."""
        data = self._load()
        entry = next((m for m in data["models"] if m["version"] == version), None)
        if entry is None:
            raise KeyError(f"model version {version} not registered")
        for m in data["models"]:
            if m["stage"] == "production":
                m["stage"] = "archived"
        entry.update(stage="production", approved_by=approved_by, promoted_at=datetime.now(timezone.utc).isoformat())
        data["production"] = version
        self._save(data)
        return entry

    def production(self) -> Optional[dict[str, Any]]:
        data = self._load()
        return next((m for m in data["models"] if m["version"] == data.get("production")), None)

    def list(self) -> list[dict[str, Any]]:
        return self._load()["models"]
