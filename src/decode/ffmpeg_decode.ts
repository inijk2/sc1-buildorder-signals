import { mkdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";

export type DecodeOptions = {
  input: string;
  outDir: string;
  fps: number;
  startSec: number;
  endSec: number;
};

export type DecodedFrame = {
  index: number;
  t: number;
  path: string;
};

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function decodeFrames(opts: DecodeOptions): Promise<DecodedFrame[]> {
  const outDir = resolve(opts.outDir);
  ensureDir(outDir);

  const pattern = resolve(outDir, "frame_%06d.jpg");
  const ffmpegPath =
    process.env.FFMPEG_PATH ||
    (process.platform === "win32"
      ? (() => {
          const base = process.env.LOCALAPPDATA;
          if (!base) return "ffmpeg";
          const candidate = join(
            base,
            "Microsoft",
            "WinGet",
            "Packages",
            "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
            "ffmpeg-8.0.1-full_build",
            "bin",
            "ffmpeg.exe"
          );
          return existsSync(candidate) ? candidate : "ffmpeg";
        })()
      : "ffmpeg");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(opts.startSec),
    "-to",
    String(opts.endSec),
    "-i",
    opts.input,
    "-vf",
    `fps=${opts.fps}`,
    "-q:v",
    "2",
    pattern
  ];

  await new Promise<void>((resolvePromise, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });

  const frames: DecodedFrame[] = [];
  const total = Math.floor((opts.endSec - opts.startSec) * opts.fps);
  for (let i = 0; i < total; i += 1) {
    const index = i + 1;
    const t = opts.startSec + i / opts.fps;
    const path = resolve(outDir, `frame_${String(index).padStart(6, "0")}.jpg`);
    frames.push({ index, t, path });
  }

  return frames;
}
