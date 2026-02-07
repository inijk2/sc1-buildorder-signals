import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { loadGray, loadMask, resizeGray, type GrayImage, type Roi } from "../src/roi/crop.js";

function getArg(name: string, fallback?: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

type Box = { x: number; y: number; w: number; h: number };

function extractComponents(mask: GrayImage): Box[] {
  const { width, height, data } = mask;
  const visited = new Uint8Array(width * height);
  const boxes: Box[] = [];
  const stack: number[] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  for (let i = 0; i < data.length; i += 1) {
    if (data[i] === 0 || visited[i]) continue;
    visited[i] = 1;
    let minx = i % width;
    let maxx = minx;
    let miny = Math.floor(i / width);
    let maxy = miny;
    stack.push(i);

    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nidx = ny * width + nx;
        if (data[nidx] === 0 || visited[nidx]) continue;
        visited[nidx] = 1;
        stack.push(nidx);
      }
    }

    boxes.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 });
  }

  return boxes;
}

async function matchTemplate(target: GrayImage, template: GrayImage) {
  const tw = template.width;
  const th = template.height;
  let bestScore = -Infinity;
  let bestX = 0;
  let bestY = 0;

  for (let y = 0; y <= target.height - th; y += 1) {
    for (let x = 0; x <= target.width - tw; x += 1) {
      let sum = 0;
      for (let j = 0; j < th; j += 1) {
        for (let i = 0; i < tw; i += 1) {
          const t = template.data[j * tw + i];
          const v = target.data[(y + j) * target.width + (x + i)];
          const d = v - t;
          sum += d * d;
        }
      }
      const mse = sum / (tw * th);
      const score = 1 - mse / (255 * 255);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  return { x: bestX, y: bestY, score: bestScore };
}

async function main() {
  const frame = getArg("--frame", "assets/templates/digits/candidates/_frames/frame_000107.jpg")!;
  const used = getArg("--used", "12")!;
  const total = getArg("--total", "17")!;
  const profilePath = getArg("--profile", "profiles/profile_rm_854x480.json")!;
  const outDir = getArg("--out", "assets/templates/digits")!;
  const slashPath = getArg("--slash", "assets/templates/digits/slash.jpg")!;

  ensureDir(outDir);
  const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
  const strip: Roi = profile.supply;

  const stripGray = await loadGray(frame, strip);
  let slashX = Math.floor(strip.w * 0.6);
  if (existsSync(slashPath)) {
    const slashTemplate = await loadGray(slashPath);
    const slashMatch = await matchTemplate(stripGray, slashTemplate);
    slashX = slashMatch.x + Math.floor(slashTemplate.width / 2);
  }

  const usedRegion: Roi = { x: strip.x, y: strip.y, w: Math.max(1, slashX - 2), h: strip.h };
  const totalRegion: Roi = { x: strip.x + slashX + 2, y: strip.y, w: Math.max(1, strip.w - slashX - 2), h: strip.h };

  const usedMask = await loadMask(frame, usedRegion, "white");
  const totalMask = await loadMask(frame, totalRegion, "green");

  const usedBoxes = extractComponents(usedMask)
    .filter(b => b.w >= 2 && b.h >= 6)
    .sort((a, b) => a.x - b.x)
    .slice(-used.length)
    .map(b => ({ x: usedRegion.x + b.x, y: usedRegion.y + b.y, w: b.w, h: b.h }));

  const totalBoxes = extractComponents(totalMask)
    .filter(b => b.w >= 2 && b.h >= 6)
    .sort((a, b) => a.x - b.x)
    .slice(-total.length)
    .map(b => ({ x: totalRegion.x + b.x, y: totalRegion.y + b.y, w: b.w, h: b.h }));

  const allBoxes = [...usedBoxes, ...totalBoxes];
  const maxW = Math.max(...allBoxes.map(b => b.w));
  const maxH = Math.max(...allBoxes.map(b => b.h));

  for (let i = 0; i < used.length; i += 1) {
    const digit = used[i];
    const b = usedBoxes[i];
    let img = await loadGray(frame, b);
    img = await resizeGray(img, maxW, maxH);
    const outPath = join(outDir, `${digit}.png`);
    await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 1 } })
      .png()
      .toFile(outPath);
  }

  for (let i = 0; i < total.length; i += 1) {
    const digit = total[i];
    const b = totalBoxes[i];
    let img = await loadGray(frame, b);
    img = await resizeGray(img, maxW, maxH);
    const outPath = join(outDir, `${digit}.png`);
    await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 1 } })
      .png()
      .toFile(outPath);
  }

  console.log("wrote templates", { usedBoxes, totalBoxes, size: { w: maxW, h: maxH } });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
