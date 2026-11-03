"""Model evaluation metrics: Precision, Recall, F1, ROC-AUC, and calibration analysis."""
import numpy as np
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix, brier_score_loss


class ModelEvaluator:
    @staticmethod
    def evaluate(y_true, y_pred, y_prob) -> dict:
        report = classification_report(y_true, y_pred, output_dict=True, zero_division=0)
        cm = confusion_matrix(y_true, y_pred).tolist()
        
        try:
            auc = float(roc_auc_score(y_true, y_prob))
        except Exception:
            auc = 0.5
            
        brier = float(brier_score_loss(y_true, y_prob))

        return {
            "accuracy": report["accuracy"],
            "precision_class_1": report.get("1", {}).get("precision", 0.0),
            "recall_class_1": report.get("1", {}).get("recall", 0.0),
            "f1_class_1": report.get("1", {}).get("f1-score", 0.0),
            "roc_auc": auc,
            "brier_score": brier,
            "confusion_matrix": cm,
        }
