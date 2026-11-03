"use client";

/**
 * A contact sheet of frames from a video, made in the browser: for AI providers that read images
 * but not video (Muse Spark via Meta Model API). Each frame is stamped with its time, and
 * the times are sent with the image so findings can point to a moment in the clip.
 */
export async function contactSheet(source: string | File, count = 4, width = 1280): Promise<{ blob: Blob; times: number[] }> {
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not load the video to capture frames."));
    });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const times = Array.from({ length: count }, (_, i) => Math.round((((i + 0.5) * duration) / count) * 10) / 10);
    const cols = 2;
    const rows = Math.ceil(count / cols);
    const cellW = Math.floor(width / cols);
    const cellH = Math.round((cellW * (video.videoHeight || 9)) / (video.videoWidth || 16));
    const canvas = document.createElement("canvas");
    canvas.width = cellW * cols;
    canvas.height = cellH * rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't capture frames.");
    for (let i = 0; i < times.length; i++) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = times[i];
      });
      const x = (i % cols) * cellW;
      const y = Math.floor(i / cols) * cellH;
      ctx.drawImage(video, x, y, cellW, cellH);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(x + 8, y + 8, 86, 26);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(`t = ${times[i].toFixed(1)}s`, x + 14, y + 27);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the frames."))), "image/jpeg", 0.85));
    return { blob, times };
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}
