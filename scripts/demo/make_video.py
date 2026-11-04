"""Assemble the 3-minute AeroBreeze demo from the recordings, Muse Image stills, cards and a narration.

    python3 scripts/demo/make_video.py <workdir> [voice] [story]      story: aerobreeze (default) | electronics

<workdir> holds: 01_floor.png … 06_control.png (Muse Image), cards/*.png (render-cards.mjs),
rec1/raw.webm + rec1/marks.json (full run), rec2/raw.webm (3D + copilot extras),
and docs/architecture/twin-architecture.png is taken from the repo. Writes <workdir>/aerobreeze-demo.mp4.
Long AI waits are sped up and labelled on screen; nothing is staged.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

W = Path(sys.argv[1]).resolve()
VOICE = sys.argv[2] if len(sys.argv) > 2 else "Samantha"
STORY = sys.argv[3] if len(sys.argv) > 3 else "aerobreeze"
REPO = Path(__file__).resolve().parents[2]
TMP = W / f"build-{STORY}"
shutil.rmtree(TMP, ignore_errors=True)
TMP.mkdir(parents=True)
FPS = 30
VENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS)]

def marks(d):
    f = W / d / "marks.json"
    return {m["name"]: m["t"] for m in json.loads(f.read_text())} if f.exists() else {}


m1, m2, me = marks("rec1"), marks("rec2"), marks("rec-e")
R1, R2, RE = str(W / "rec1/raw.webm"), str(W / "rec2/raw.webm"), str(W / "rec-e/raw.webm")
C = W / "cards"


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    return float(out.stdout.strip())


# ── segment makers (video only, 1920×1080 @ 30 fps) ─────────────────────────
n = 0


def out_path():
    global n
    n += 1
    return TMP / f"seg{n:03d}.mp4"


def still(img, seconds, zoom=True):
    p = out_path()
    frames = int(seconds * FPS)
    vf = (f"scale=3840:-2,zoompan=z='min(zoom+0.0007,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps={FPS}"
          if zoom else "scale=1920:1080")
    run(["ffmpeg", "-y", "-loop", "1", "-i", str(img), "-t", f"{seconds:.3f}", "-vf", vf, *VENC, str(p)])
    return p


def clip(src, a, b, target=None, speed=1.0, badge=None):
    """Cut [a, b] seconds of a recording; `target` seconds fixes the length (speeds up), else `speed`."""
    p = out_path()
    length = b - a
    sp = length / target if target else speed
    chain = f"setpts=PTS/{sp:.4f},fps={FPS},scale=1920:1080"
    cmd = ["ffmpeg", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", src]
    if badge:
        cmd += ["-loop", "1", "-i", str(C / f"{badge}.png")]
        cmd += ["-filter_complex", f"[0:v]{chain}[v];[v][1:v]overlay=0:0:shortest=1"]
    else:
        cmd += ["-vf", chain]
    run([*cmd, "-an", *VENC, str(p)])
    return p


# ── scenes: (narration, [segments]) ─────────────────────────────────────────
imgs = [W / f"{k}.png" for k in ["01_floor", "02_winding", "03_robot", "04_bearings", "05_dock", "06_control"]]

SCENES = [
    ("It's festival season at AeroBreeze Fans in Bengaluru, and ceiling fan orders are pouring in. "
     "Deep inside Motor Line A, a robot's bearing has started to wear. "
     "In the stores, the imported bearings every fan needs are running low. And the next shipment is six days away. Nobody sees it coming.",
     lambda: [still(i, 3.4) for i in imgs]),
    ("This is Twin: an agentic digital twin, built on Meta's Muse models.",
     lambda: [still(C / "title.png", 4.6, zoom=False)]),
    ("It starts with a drawing. Upload the plant layout and describe what you make. "
     "No forms, no spreadsheets. Live, Muse Spark reads every machine tag, researches how fan plants are set up, and drafts the twin: "
     "three lines, nineteen machines, suppliers, stock levels, connections and robots, copied from what you wrote. "
     "Every element shows where it came from. Review it, then build.",
     lambda: [clip(R1, 0.6, m1["builder-wait"]),
              clip(R1, m1["builder-wait"], m1["builder-review"], target=6, badge="badge-builder"),
              clip(R1, m1["builder-review"], m1["build"] + 0.6, speed=1.45)]),
    ("AeroBreeze is now live, in 3D, with its mobile robots and forklift AGV, and every machine streaming telemetry. "
     "In the playground, you can rearrange machines and set automation rules.",
     lambda: [clip(R1, m1["built"] + 0.8, m1["built"] + 3.8),
              clip(R2, 2.6, m2["x-3d-end"] - 0.5),
              clip(R1, m1["twin-3d"] + 2.6, m1["playground"])]),
    ("Then, the rotor assembly robot starts to vibrate.",
     lambda: [clip(R1, m1["playground"] + 2.6, m1["incident"], target=5)]),
    ("Six AI agents investigate, and the intelligence backend adds its own evidence. "
     "The robot is likely to trip in under ten hours. And the bearings run out in twenty-two hours, "
     "against a hundred-and-forty-four-hour import lead time. Every number traces back to the twin.",
     lambda: [clip(R1, m1["incident"] + 2.4, m1["agents-start"] + 0.5),
              clip(R1, m1["agents-start"] + 0.5, m1["agents-done"], target=4, badge="badge-agents"),
              clip(R1, m1["agents-done"], m1["agents-read"], speed=1.1)]),
    ("Supply chain analytics sizes a purchase order, and the twin simulates every option. "
     "Then a person approves both plans: a maintenance window for the robot, and the bearings order. "
     "The order becomes an inbound delivery, either plan can be rolled back, and nothing changes without that approval.",
     lambda: [clip(R1, m1["agents-read"] + 2.4, m1["supply"], speed=1.3),
              clip(R1, m1["supply"] + 2.4, m1["simulator"], speed=1.2),
              clip(R1, m1["simulator"] + 2.4, m1["approved"], speed=1.6)]),
    ("Analytics shows the whole picture: hours to trip for every machine, the festival demand forecast against capacity, "
     "and AOI inspection, with Muse Spark and SAM 3.1 checking each part. Each feature is switched on per plant by an admin.",
     lambda: [clip(R1, m1["approved"] + 2.4, m1["an-maint"], speed=1.4),
              clip(R1, m1["an-maint"] + 2.4, m1["an-demand"], speed=1.2),
              clip(R1, m1["an-demand"] + 2.4, m1["aoi-start"] + 0.4),
              clip(R1, m1["aoi-start"] + 0.4, m1["aoi-done"], target=2.5, badge="badge-aoi"),
              clip(R1, m1["aoi-done"], m1["an-quality"], speed=1.3)]),
    ("Or simply ask the copilot. It answers from live twin data, shows every tool it used, and checked all seventeen figures in this answer.",
     lambda: [clip(R2, m2["x-3d-end"] + 2.4, m2["copilot-start"] + 0.5),
              clip(R2, m2["copilot-start"] + 0.5, m2["copilot-done"], target=2.5, badge="badge-copilot"),
              clip(R2, m2["copilot-done"], m2["end"])]),
    ("Twin runs on Meta's Muse models and an open-source stack, with open-weight Muse Spark Open for plant-private AI. "
     "Numbers from the twin. Decisions by people.",
     lambda: [still(REPO / "docs/architecture/twin-architecture.png", 6.5, zoom=False), still(C / "end.png", 5.5, zoom=False)]),
]

if STORY == "electronics":
    from electronics_story import scenes as _electronics

    SCENES = _electronics(W, C, REPO, me, RE, still, clip)

scene_files, audio_files, total = [], [], 0.0
for i, (text, make) in enumerate(SCENES, 1):
    aiff, wav = TMP / f"n{i}.aiff", TMP / f"n{i}.wav"
    run(["say", "-v", VOICE, "-r", "168", "-o", str(aiff), text])
    run(["ffmpeg", "-y", "-i", str(aiff), "-ar", "48000", "-ac", "2", str(wav)])
    segs = make()
    lst = TMP / f"s{i}.txt"
    lst.write_text("".join(f"file '{s}'\n" for s in segs))
    raw = TMP / f"scene{i}_raw.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(raw)])
    vlen, nlen = dur(raw), dur(wav)
    length = max(vlen, nlen + 0.9)
    scene = TMP / f"scene{i}.mp4"
    # Hold the last frame if the narration needs longer than the picture.
    run(["ffmpeg", "-y", "-i", str(raw), "-vf", f"tpad=stop_mode=clone:stop_duration={max(0, length - vlen):.3f}", "-t", f"{length:.3f}", *VENC, str(scene)])
    audio = TMP / f"a{i}.wav"
    run(["ffmpeg", "-y", "-i", str(wav), "-af", f"adelay=350|350,apad", "-t", f"{length:.3f}", "-ar", "48000", "-ac", "2", str(audio)])
    scene_files.append(scene)
    audio_files.append(audio)
    total += length
    print(f"scene {i:2d}: picture {vlen:5.1f}s  narration {nlen:5.1f}s  →  {length:5.1f}s   (total {total:6.1f}s)")

vl = TMP / "video.txt"
vl.write_text("".join(f"file '{s}'\n" for s in scene_files))
al = TMP / "audio.txt"
al.write_text("".join(f"file '{a}'\n" for a in audio_files))
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(vl), "-c", "copy", str(TMP / "video.mp4")])
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(al), "-c", "copy", str(TMP / "audio.wav")])
final = W / f"{STORY}-demo.mp4"
run(["ffmpeg", "-y", "-i", str(TMP / "video.mp4"), "-i", str(TMP / "audio.wav"), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
     "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-shortest", "-movflags", "+faststart", str(final)])
print(f"wrote {final}  ({dur(final):.1f}s)")
