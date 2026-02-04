import { runPipeline } from "./pipeline.js";

function getArg(name: string, fallback?: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const value = process.argv[idx + 1];
  return value ?? fallback;
}

function getNumber(name: string, fallback: number) {
  const value = getArg(name);
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const input = getArg("--input");
  const out = getArg("--out", "out");
  const profile = getArg("--profile", "profiles/profile_rm_1080p.json");
  const fps = getNumber("--fps", 2);
  const start = getNumber("--start", 0);
  const end = getNumber("--end", 420);

  if (!input) {
    console.error("Missing --input <video.mp4>");
    process.exit(1);
  }

  await runPipeline({
    input,
    outDir: out,
    profilePath: profile,
    fps,
    startSec: start,
    endSec: end
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
