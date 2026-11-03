"""Synthetic, deterministic test media: PCB-like boards, barcodes, QR codes and videos."""

from __future__ import annotations

import cv2
import numpy as np
import pytest

COMPONENTS = 40


def board(missing: int | None = None, seed: int = 7) -> tuple[np.ndarray, list[tuple[int, int, int, int]]]:
    """A green board with dark ICs, small chips and silkscreen text. Returns (image, component rects)."""
    rng = np.random.default_rng(seed)
    img = np.full((600, 900, 3), (40, 110, 30), np.uint8)
    cv2.rectangle(img, (20, 20), (880, 580), (30, 90, 25), 3)
    rects: list[tuple[int, int, int, int]] = []
    for i in range(COMPONENTS):
        w, h = (int(rng.integers(50, 90)), int(rng.integers(40, 70))) if i % 4 == 0 else (int(rng.integers(18, 30)), int(rng.integers(10, 16)))
        x, y = int(rng.integers(40, 860 - w)), int(rng.integers(40, 560 - h))
        rects.append((x, y, w, h))
    for i, (x, y, w, h) in enumerate(rects):
        if i == missing:
            continue
        if i % 4 == 0:
            cv2.rectangle(img, (x, y), (x + w, y + h), (25, 25, 28), -1)
            for p in range(x + 4, x + w - 4, 8):
                cv2.rectangle(img, (p, y - 5), (p + 3, y), (200, 200, 200), -1)
                cv2.rectangle(img, (p, y + h), (p + 3, y + h + 5), (200, 200, 200), -1)
            cv2.circle(img, (x + 6, y + 6), 2, (90, 90, 90), -1)
        else:
            cv2.rectangle(img, (x, y), (x + w, y + h), (200, 200, 200), -1)
            cv2.rectangle(img, (x + 4, y), (x + w - 4, y + h), (40, 70, 110), -1)
    for k, label in enumerate(["U1", "U2", "R14", "C7", "TWIN", "REV B"]):
        cv2.putText(img, label, (60 + k * 130, 590 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
    return img, rects


def png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def iou(a: dict, b: tuple[float, float, float, float]) -> float:
    ax0, ay0, ax1, ay1 = a["x"], a["y"], a["x"] + a["w"], a["y"] + a["h"]
    bx0, by0, bx1, by1 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    ix = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    iy = max(0.0, min(ay1, by1) - max(ay0, by0))
    inter = ix * iy
    union = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / union if union > 0 else 0.0


# EAN-13 encoding tables
L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]


def ean13(digits12: str, module: int = 3, height: int = 140, contrast: int = 255) -> tuple[np.ndarray, str]:
    d = [int(c) for c in digits12]
    check = (10 - (sum(d[0::2]) + 3 * sum(d[1::2])) % 10) % 10
    code = digits12 + str(check)
    bits = "101"
    for i, ch in enumerate(code[1:7]):
        bits += (L if PARITY[d[0]][i] == "L" else G)[int(ch)]
    bits += "01010"
    for ch in code[7:]:
        bits += R[int(ch)]
    bits += "101"
    quiet = 12 * module
    bar = 255 - contrast
    img = np.full((height + 2 * quiet, len(bits) * module + 2 * quiet), 255, np.uint8)
    for i, b in enumerate(bits):
        if b == "1":
            img[quiet : quiet + height, quiet + i * module : quiet + (i + 1) * module] = bar
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR), code


def qr(text: str, scale: int = 8) -> np.ndarray:
    m = cv2.QRCodeEncoder.create().encode(text)
    m = cv2.resize(m, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    m = cv2.copyMakeBorder(m, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)
    return cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)


def write_video(path: str, fps: int = 10, moving: list[tuple[float, float]] = ((0, 4), (8, 10)), total: float = 10.0) -> None:
    """A conveyor-like scene: a box moves while inside a `moving` window and holds still otherwise."""
    base, _ = board()
    small = cv2.resize(base, (480, 320))
    out = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), fps, (480, 320))
    assert out.isOpened()
    x = 10.0
    for i in range(int(total * fps)):
        t = i / fps
        if any(a <= t < b for a, b in moving):
            x = (x + 12) % 400
        frame = small.copy()
        cv2.rectangle(frame, (int(x), 120), (int(x) + 70, 200), (60, 140, 210), -1)
        out.write(frame)
    out.release()


@pytest.fixture
def tmp_video(tmp_path):
    p = str(tmp_path / "line.avi")
    write_video(p)
    return p
