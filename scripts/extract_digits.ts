import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { decodeFrames } from "../src/decode/ffmpeg_decode.js";
import { loadGray, variance } from "../src/roi/crop.js";

type Roi = { x: number; y: number; w: number; h: number };

type Profile = {
  name: string;
  resolution: { w: number; h: number };
  supply: { x: number; y: number; w: number; h: number; used_boxes: Roi[]; total_boxes: Roi[] };
};

type Candidate = {
  score: number;
  t: number;
  frame: string;
  boxType: "used" | "total";
  index: number;
  roi: Roi;
  outFile: string;
};

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getArg(name: string, fallback?: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function getNumber(name: string, fallback: number) {
  const v = getArg(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readProfile(path: string): Profile {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function pushTopN(list: Candidate[], cand: Candidate, n: number) {
  list.push(cand);
  list.sort((a, b) => b.score - a.score);
  if (list.length > n) list.length = n;
}

async function main() {
  const input = getArg("--input");
  const profilePath = getArg("--profile", "profiles/profile_rm_854x480.json");
  const outDir = getArg("--out", "assets/templates/digits/candidates");
  const fps = getNumber("--fps", 1);
  const start = getNumber("--start", 0);
  const end = getNumber("--end", 120);
  const perBox = getNumber("--per-box", 12);

  if (!input) {
    console.error("Missing --input <video.mp4>");
    process.exit(1);
  }

  ensureDir(outDir);
  const profile = readProfile(profilePath);

  const frames = await decodeFrames({
    input,
    outDir: join(outDir, "_frames"),
    fps,
    startSec: start,
    endSec: end
  });

  const best: Candidate[] = [];

  for (const frame of frames) {
    const boxes: { boxType: "used" | "total"; index: number; roi: Roi }[] = [];
    profile.supply.used_boxes.forEach((roi, index) => boxes.push({ boxType: "used", index, roi }));
    profile.supply.total_boxes.forEach((roi, index) => boxes.push({ boxType: "total", index, roi }));

    for (const box of boxes) {
      const image = await loadGray(frame.path, box.roi);
      const score = variance(image);
      const outFile = join(
        outDir,
        `${box.boxType}_${box.index}_t${frame.t.toFixed(1).replace(".", "_")}.png`
      );
      pushTopN(best, { score, t: frame.t, frame: frame.path, boxType: box.boxType, index: box.index, roi: box.roi, outFile }, perBox);
    }
  }

  // Save crops for top candidates
  for (const cand of best) {
    const { default: sharp } = await import("sharp");
    await sharp(cand.frame)
      .extract({ left: cand.roi.x, top: cand.roi.y, width: cand.roi.w, height: cand.roi.h })
      .png()
      .toFile(cand.outFile);
  }

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(best, null, 2));
  console.log(`Saved ${best.length} candidate digit crops to ${outDir}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
