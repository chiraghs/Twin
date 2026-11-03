"""Feature engineering pipeline computing rolling statistics and physics-based degradation indicators."""
import math
import statistics
from typing import Any, Union

try:
    import pandas as pd
    import numpy as np
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False


class FeatureEngineeringPipeline:
    """Transforms raw time-series sensor events into machine health features."""

    @classmethod
    def extract_features(cls, data: Any, window_size: int = 5) -> Any:
        """Computes rolling statistics per machine to capture dynamic degradation signatures."""
        if HAS_PANDAS and isinstance(data, pd.DataFrame):
            return cls._extract_pandas(data, window_size)
        elif isinstance(data, list):
            return cls._extract_dicts(data, window_size)
        elif HAS_PANDAS:
            return cls._extract_pandas(pd.DataFrame(data), window_size)
        else:
            return cls._extract_dicts(list(data), window_size)

    @classmethod
    def _extract_pandas(cls, df: Any, window_size: int) -> Any:
        if df.empty:
            return df
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.sort_values(by=["machine_id", "timestamp"]).reset_index(drop=True)

        features = []
        for machine_id, group in df.groupby("machine_id"):
            group = group.copy()
            group["roll_mean_vib"] = group["vibration_mm_s"].rolling(window=window_size, min_periods=1).mean()
            group["roll_max_vib"] = group["vibration_mm_s"].rolling(window=window_size, min_periods=1).max()
            group["roll_std_vib"] = group["vibration_mm_s"].rolling(window=window_size, min_periods=1).std().fillna(0.0)

            group["roll_mean_temp"] = group["temperature_celsius"].rolling(window=window_size, min_periods=1).mean()
            group["roll_max_temp"] = group["temperature_celsius"].rolling(window=window_size, min_periods=1).max()

            group["roll_mean_pressure"] = group["pressure_bar"].rolling(window=window_size, min_periods=1).mean()
            group["roll_mean_rpm"] = group["rpm"].rolling(window=window_size, min_periods=1).mean()

            group["friction_indicator"] = (group["roll_mean_vib"] * group["roll_mean_temp"]) / 100.0
            group["stability_index"] = group["roll_mean_rpm"] / (group["roll_mean_vib"] + 0.1)
            group["vib_slope"] = group["vibration_mm_s"].diff().fillna(0.0)

            features.append(group)

        return pd.concat(features, ignore_index=True)

    @classmethod
    def _extract_dicts(cls, records: list[dict], window_size: int) -> list[dict]:
        """Pure-Python fallback implementation when pandas is not installed."""
        if not records:
            return []

        # Group by machine_id
        grouped: dict[str, list[dict]] = {}
        for r in records:
            m_id = r["machine_id"]
            if m_id not in grouped:
                grouped[m_id] = []
            grouped[m_id].append(dict(r))

        result = []
        for m_id, group in grouped.items():
            vibs: list[float] = []
            temps: list[float] = []
            pressures: list[float] = []
            rpms: list[float] = []
            prev_vib = None

            for r in group:
                v = float(r["vibration_mm_s"])
                t = float(r["temperature_celsius"])
                p = float(r["pressure_bar"])
                rpm = float(r["rpm"])

                vibs.append(v)
                temps.append(t)
                pressures.append(p)
                rpms.append(rpm)

                w_vibs = vibs[-window_size:]
                w_temps = temps[-window_size:]
                w_press = pressures[-window_size:]
                w_rpms = rpms[-window_size:]

                roll_mean_vib = sum(w_vibs) / len(w_vibs)
                roll_max_vib = max(w_vibs)
                roll_std_vib = statistics.stdev(w_vibs) if len(w_vibs) > 1 else 0.0

                roll_mean_temp = sum(w_temps) / len(w_temps)
                roll_max_temp = max(w_temps)

                roll_mean_press = sum(w_press) / len(w_press)
                roll_mean_rpm = sum(w_rpms) / len(w_rpms)

                friction_indicator = (roll_mean_vib * roll_mean_temp) / 100.0
                stability_index = roll_mean_rpm / (roll_mean_vib + 0.1)
                vib_slope = (v - prev_vib) if prev_vib is not None else 0.0
                prev_vib = v

                out = dict(r)
                out.update({
                    "roll_mean_vib": round(roll_mean_vib, 3),
                    "roll_max_vib": round(roll_max_vib, 3),
                    "roll_std_vib": round(roll_std_vib, 3),
                    "roll_mean_temp": round(roll_mean_temp, 2),
                    "roll_max_temp": round(roll_max_temp, 2),
                    "roll_mean_pressure": round(roll_mean_press, 2),
                    "roll_mean_rpm": round(roll_mean_rpm, 1),
                    "friction_indicator": round(friction_indicator, 3),
                    "stability_index": round(stability_index, 2),
                    "vib_slope": round(vib_slope, 3),
                })
                result.append(out)

        return result

    @staticmethod
    def get_feature_columns() -> list[str]:
        return [
            "roll_mean_vib", "roll_max_vib", "roll_std_vib",
            "roll_mean_temp", "roll_max_temp",
            "roll_mean_pressure", "roll_mean_rpm",
            "friction_indicator", "stability_index", "vib_slope",
            "operating_hours",
        ]
