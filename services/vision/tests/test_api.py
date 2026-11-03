from fastapi.testclient import TestClient

import app.main as main
from tests.conftest import board, png, qr

client = TestClient(main.app)


def test_health_reports_engine():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["engine"].startswith("OpenCV ")


def test_image_with_golden_reference():
    ref, _ = board()
    test, _ = board(missing=0)
    r = client.post(
        "/v1/inspect/image",
        files={"image": ("unit.png", png(test), "image/png"), "reference": ("golden.png", png(ref), "image/png")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "image" and body["quality"]["usable"]
    assert body["comparison"]["alignment"] == "homography"
    assert len(body["comparison"]["defects"]) >= 1


def test_image_without_reference_reads_codes():
    r = client.post("/v1/inspect/image", files={"image": ("label.png", png(qr("PO-7781")), "image/png")})
    assert r.status_code == 200
    assert r.json()["comparison"] is None
    assert [c["data"] for c in r.json()["codes"]] == ["PO-7781"]


def test_rejects_wrong_type_garbage_and_oversize(monkeypatch):
    assert client.post("/v1/inspect/image", files={"image": ("a.gif", b"GIF89a", "image/gif")}).status_code == 415
    assert client.post("/v1/inspect/image", files={"image": ("a.png", b"not really a png", "image/png")}).status_code == 422
    monkeypatch.setattr(main, "MAX_IMAGE_BYTES", 1024)
    big = png(board()[0])
    assert client.post("/v1/inspect/image", files={"image": ("a.png", big, "image/png")}).status_code == 413


def test_video_endpoint(tmp_video):
    with open(tmp_video, "rb") as f:
        r = client.post("/v1/inspect/video", files={"video": ("line.avi", f.read(), "video/x-msvideo")}, data={"sample_fps": "2"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "video"
    assert len(body["stillPeriods"]) == 1
    assert client.post("/v1/inspect/video", files={"video": ("a.mkv", b"x", "video/x-matroska")}).status_code == 415
