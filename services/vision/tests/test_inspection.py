import cv2
import numpy as np
import pytest

from app.inspection import InspectionError, compare_to_reference, image_quality, inspect_image, inspect_video, read_codes
from tests.conftest import board, ean13, iou, png, qr


def test_sharp_board_is_usable():
    img, _ = board()
    q = image_quality(img)
    assert q["usable"], q


def test_blur_and_exposure_are_flagged():
    img, _ = board()
    assert "blurry" in image_quality(cv2.GaussianBlur(img, (0, 0), 6))["issues"]
    assert "underexposed" in image_quality((img * 0.15).astype(np.uint8))["issues"]
    assert "low contrast" in image_quality(np.full_like(img, 128))["issues"]


def test_identical_images_have_no_defects():
    img, _ = board()
    cmp = compare_to_reference(img, img)
    assert cmp["alignment"] == "homography"
    assert cmp["defects"] == []


def test_missing_component_is_found_where_it_should_be():
    ref, rects = board()
    test, _ = board(missing=8)  # an IC (every 4th component is an IC)
    cmp = compare_to_reference(test, ref)
    assert len(cmp["defects"]) >= 1
    x, y, w, h = rects[8]
    expected = (x / 900, (y - 5) / 600, w / 900, (h + 10) / 600)
    assert max(iou(d["box"], expected) for d in cmp["defects"]) > 0.4


def test_alignment_handles_a_shifted_and_rotated_part():
    ref, rects = board()
    test, _ = board(missing=12)
    M = cv2.getRotationMatrix2D((450, 300), 3.0, 1.0)
    M[:, 2] += (18, -11)
    moved = cv2.warpAffine(test, M, (900, 600), borderValue=(40, 110, 30))
    cmp = compare_to_reference(moved, ref)
    assert cmp["alignment"] == "homography"
    assert cmp["inliers"] > 50
    # The reported box is in the moved image's frame: map the expected rect with the same transform.
    x, y, w, h = rects[12]
    corners = np.array([[x, y - 5], [x + w, y - 5], [x + w, y + h + 5], [x, y + h + 5]], np.float32).reshape(-1, 1, 2)
    moved_corners = cv2.transform(corners, M)
    bx, by, bw, bh = cv2.boundingRect(moved_corners)
    assert max(iou(d["box"], (bx / 900, by / 600, bw / 900, bh / 600)) for d in cmp["defects"]) > 0.35


def test_global_lighting_change_is_not_a_defect():
    ref, _ = board()
    darker = cv2.convertScaleAbs(ref, alpha=0.8, beta=5)
    assert compare_to_reference(darker, ref)["defects"] == []


def test_qr_code_is_read_with_indicative_grade():
    codes = read_codes(qr("ORD-1042|ECU-200|LOT 7781"))
    assert [c["data"] for c in codes] == ["ORD-1042|ECU-200|LOT 7781"]
    assert codes[0]["format"] == "QR_CODE"
    assert codes[0]["contrastGrade"] == "A"


def test_ean13_barcode_is_read_and_low_contrast_print_is_graded_down():
    img, code = ean13("400638133393")
    codes = read_codes(img)
    assert [(c["format"], c["data"]) for c in codes] == [("EAN_13", code)]
    assert codes[0]["contrastGrade"] == "A"
    faded, _ = ean13("400638133393", contrast=70)
    graded = read_codes(faded)
    if graded:  # a very faint print may not decode at all, which is also a fail
        assert graded[0]["contrastGrade"] in {"D", "F"}


def test_results_are_deterministic():
    ref, _ = board()
    test, _ = board(missing=4)
    a = inspect_image(png(test), png(ref))
    b = inspect_image(png(test), png(ref))
    a.pop("durationMs"), b.pop("durationMs")
    assert a == b


def test_undecodable_input_is_rejected():
    with pytest.raises(InspectionError):
        inspect_image(b"not an image")


def test_video_still_period_is_reported_as_possible_stoppage(tmp_video):
    r = inspect_video(tmp_video, sample_fps=2)
    assert r["framesAnalysed"] >= 18
    assert len(r["stillPeriods"]) == 1
    still = r["stillPeriods"][0]
    assert 3.4 <= still["startSec"] <= 4.6
    assert 7.4 <= still["endSec"] <= 8.6
    assert [s["state"] for s in r["segments"]] == ["moving", "still", "moving"]
