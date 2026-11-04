import json
import subprocess
from pathlib import Path

FPS = 30
VENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS)]

WORK = Path("/tmp/twin_assemble_v2")
WORK.mkdir(parents=True, exist_ok=True)

AUDIO_DIR = Path("/tmp/twin_audio_v2")
CARDS_DIR = Path("/tmp/twin_cards")
REC_DIR = Path("/tmp/twin_rec_e")
REPO_DIR = Path("/Volumes/DiskD/HACKATHONS/TWIN META")
HOOK_SILENT = Path("/tmp/twin_assemble/hook_silent.mp4")

with open(REC_DIR / "marks.json") as f:
    m = {x["name"]: x["t"] for x in json.load(f)}

RAW_WEBM = str(REC_DIR / "raw.webm")

def run(cmd):
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print("ERROR RUNNING:", " ".join(cmd))
        print("STDERR:", res.stderr[-500:])
        raise RuntimeError("ffmpeg failed")

def dur(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip())

n = 0
def next_seg(name=""):
    global n
    n += 1
    return WORK / f"seg{n:02d}_{name}.mp4"

def make_clip(src, t_start, t_end, target_dur=None, badge=None):
    p = next_seg()
    real_dur = t_end - t_start
    if target_dur:
        speed = real_dur / target_dur
    else:
        speed = 1.0
        target_dur = real_dur

    chain = f"setpts=PTS/{speed:.4f},fps={FPS},scale=1920:1080"
    cmd = ["ffmpeg", "-y", "-ss", f"{t_start:.3f}", "-to", f"{t_end:.3f}", "-i", src]
    if badge and (CARDS_DIR / f"{badge}.png").exists():
        cmd += ["-loop", "1", "-i", str(CARDS_DIR / f"{badge}.png")]
        cmd += ["-filter_complex", f"[0:v]{chain}[v];[v][1:v]overlay=0:0:shortest=1"]
    else:
        cmd += ["-vf", chain]
    cmd += ["-t", f"{target_dur:.3f}", "-an", *VENC, str(p)]
    run(cmd)
    return p

def make_still(img_path, target_dur, zoom=False):
    p = next_seg()
    frames = int(target_dur * FPS)
    if zoom:
        vf = f"scale=3840:-2,zoompan=z='min(zoom+0.0004,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1920x1080:fps={FPS}"
    else:
        vf = f"scale=1920:1080"
    cmd = ["ffmpeg", "-y", "-loop", "1", "-i", str(img_path), "-t", f"{target_dur:.3f}", "-vf", vf, "-an", *VENC, str(p)]
    run(cmd)
    return p

# ── 1. Video Segments ────────────────────────────────────────────────────────
print("Building video segments...")
segments = []

# Part 0: Silent 40s hook
segments.append(HOOK_SILENT) # 40.0s

# Part 1: Landing Page (7.0s)
segments.append(make_clip(RAW_WEBM, 0.5, m["landing"], target_dur=7.0))

# Part 2: Command Center & Crisis (26.0s)
seg_cmd1 = make_clip(RAW_WEBM, m["landing"], m["twin-3d"], target_dur=12.0)
seg_cmd2 = make_clip(RAW_WEBM, m["twin-3d"] + 1.0, m["incident"], target_dur=14.0)
segments.extend([seg_cmd1, seg_cmd2])

# Part 3: AI Operations (30.0s)
seg_ag1 = make_clip(RAW_WEBM, m["incident"] + 1.0, m["agents-done"], target_dur=12.0, badge="badge-agents")
seg_ag2 = make_clip(RAW_WEBM, m["agents-done"], m["agents-read"], target_dur=18.0)
segments.extend([seg_ag1, seg_ag2])

# Part 4: Copilot (17.0s)
seg_cp1 = make_clip(RAW_WEBM, m["agents-read"] + 1.0, m["copilot-done"], target_dur=11.0, badge="badge-copilot")
seg_cp2 = make_clip(RAW_WEBM, m["copilot-done"], m["copilot-read"] + 2.0, target_dur=6.0)
segments.extend([seg_cp1, seg_cp2])

# Part 5: Simulator (24.0s)
seg_sim = make_clip(RAW_WEBM, m["copilot-read"] + 1.0, m["simulator"], target_dur=24.0)
segments.append(seg_sim)

# Part 6: Approvals & Execution (19.0s)
seg_app = make_clip(RAW_WEBM, m["simulator"] + 1.0, m["after"] + 1.0, target_dur=19.0)
segments.append(seg_app)

# Part 7: Twin Builder (18.0s)
seg_bld = make_clip(RAW_WEBM, m["after"] + 1.0, m["builder"], target_dur=18.0)
segments.append(seg_bld)

# Part 8: Playground (13.0s)
seg_ply = make_clip(RAW_WEBM, m["builder"] + 1.0, m["end"], target_dur=13.0)
segments.append(seg_ply)

# Part 9: Architecture Walkthrough (32.0s)
seg_arch = make_still(REPO_DIR / "docs/architecture/twin-architecture.png", 32.0, zoom=False)
segments.append(seg_arch)

# Part 10: Closing Card (9.0s)
seg_end = make_still(CARDS_DIR / "end-e.png", 9.0, zoom=False)
segments.append(seg_end)

print("Concatenating video segments...")
concat_list = WORK / "video_concat.txt"
with open(concat_list, "w") as f:
    for s in segments:
        f.write(f"file '{s}'\n")

raw_video = WORK / "full_video.mp4"
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", "-an", str(raw_video)])
video_dur = dur(raw_video)
print(f"Total video duration: {video_dur:.2f}s")

# ── 2. Precise Audio Track Assembly ──────────────────────────────────────────
# Schedule matching the exact segment boundaries:
# 0. Hook: 0:00 - 40.0s (audio starts at 1.0s, duration 33.0s)
# 1. Landing: 40.0 - 47.0s (audio starts at 40.2s, duration 6.8s)
# 2. Command: 47.0 - 73.0s (audio starts at 47.5s, duration 24.9s)
# 3. Agents: 73.0 - 103.0s (audio starts at 73.5s, duration 28.3s)
# 4. Copilot: 103.0 - 120.0s (audio starts at 103.5s, duration 15.6s)
# 5. Simulator: 120.0 - 144.0s (audio starts at 120.5s, duration 22.9s)
# 6. Approvals: 144.0 - 163.0s (audio starts at 144.5s, duration 18.0s)
# 7. Builder: 163.0 - 181.0s (audio starts at 163.5s, duration 16.9s)
# 8. Playground: 181.0 - 194.0s (audio starts at 181.5s, duration 12.1s)
# 9. Architecture: 194.0 - 226.0s (audio starts at 194.5s, duration 31.0s)
# 10. Closing: 226.0 - 235.0s (audio starts at 226.5s, duration 8.7s)

audio_schedule = [
    (1.0, AUDIO_DIR / "s00_hook.wav"),
    (40.2, AUDIO_DIR / "s01_landing.wav"),
    (47.5, AUDIO_DIR / "s02_command.wav"),
    (73.5, AUDIO_DIR / "s03_agents.wav"),
    (103.5, AUDIO_DIR / "s04_copilot.wav"),
    (120.5, AUDIO_DIR / "s05_simulator.wav"),
    (144.5, AUDIO_DIR / "s06_approvals.wav"),
    (163.5, AUDIO_DIR / "s07_builder.wav"),
    (181.5, AUDIO_DIR / "s08_playground.wav"),
    (194.5, AUDIO_DIR / "s09_arch.wav"),
    (226.5, AUDIO_DIR / "s10_closing.wav"),
]

print("Mixing master audio track...")
voice_inputs = []
filter_parts = []
for idx, (delay_sec, wav_path) in enumerate(audio_schedule):
    voice_inputs.extend(["-i", str(wav_path)])
    delay_ms = int(delay_sec * 1000)
    filter_parts.append(f"[{idx}]adelay={delay_ms}|{delay_ms}[a{idx}]")

mix_inputs = "".join(f"[a{i}]" for i in range(len(audio_schedule)))
filter_str = ";".join(filter_parts) + f";{mix_inputs}amix=inputs={len(audio_schedule)}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]"

master_audio = WORK / "master_audio.wav"
run(["ffmpeg", "-y", *voice_inputs, "-filter_complex", filter_str, "-map", "[out]", "-t", f"{video_dur:.2f}", str(master_audio)])
print(f"Master audio track duration: {dur(master_audio):.2f}s")

# ── 3. Final Mux ─────────────────────────────────────────────────────────────
final_output = Path("/Users/chiraghs/Downloads/Twin-Final-3Min-Demo.mp4")
print(f"Muxing final video to {final_output}...")
run([
    "ffmpeg", "-y",
    "-i", str(raw_video),
    "-i", str(master_audio),
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", f"{video_dur:.2f}",
    "-movflags", "+faststart",
    str(final_output)
])

print(f"SUCCESS! Rendered final demo video to: {final_output}")
print(f"Final file size: {final_output.stat().st_size / (1024*1024):.2f} MB")
print(f"Final duration: {dur(final_output):.2f} seconds")
