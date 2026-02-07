import { readdirSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadGray, loadMask, mseScore, resizeGray, type GrayImage } from "../roi/crop.js";

export type DigitTemplate = {
  digit: number;
  image: GrayImage;
};

export type DigitTemplates = {
  used: DigitTemplate[];
  total: DigitTemplate[];
  size: { w: number; h: number };
};

export type SupplyReading = {
  used: number | null;
  total: number | null;
  conf: number;
};

const MIN_ON_PIXELS = 8;
const MIN_CONF = 0.65;
const SLASH_PATH = "assets/templates/digits/slash.jpg";
const SUPPLY_ICON_PATH = "assets/templates/supply_icon.png";

export async function loadDigitTemplates(dir: string): Promise<DigitTemplates> {
  const files = readdirSync(dir).filter(name => [".png", ".jpg", ".jpeg"].includes(extname(name)));
  const used: DigitTemplate[] = [];
  const total: DigitTemplate[] = [];
  let baseSize: { w: number; h: number } | null = null;

  for (const file of files) {
    const name = basename(file, extname(file));
    const digit = Number(name);
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue;
    let image = await loadGray(join(dir, file));
    if (!baseSize) baseSize = { w: image.width, h: image.height };
    if (baseSize && (image.width !== baseSize.w || image.height !== baseSize.h)) {
      image = await resizeGray(image, baseSize.w, baseSize.h);
    }
    const entry = { digit, image: binarize(image) };
    used.push(entry);
    total.push(entry);
  }

  return { used, total, size: baseSize ?? { w: 12, h: 18 } };
}

function isActiveDigit(image: GrayImage) {
  let on = 0;
  for (let i = 0; i < image.data.length; i += 1) {
    if (image.data[i] > 20) on += 1;
  }
  return on >= MIN_ON_PIXELS;
}

function binarize(image: GrayImage): GrayImage {
  const n = image.data.length;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += image.data[i];
  const mean = sum / n;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const d = image.data[i] - mean;
    acc += d * d;
  }
  const std = Math.sqrt(acc / n);
  const threshold = Math.min(180, Math.max(80, mean + std * 0.5));
  const out = new Uint8Array(image.data.length);
  for (let i = 0; i < image.data.length; i += 1) {
    out[i] = image.data[i] >= threshold ? 255 : 0;
  }
  return { width: image.width, height: image.height, data: out };
}

async function matchDigit(
  image: GrayImage,
  templates: DigitTemplate[]
): Promise<{ digit: number | null; conf: number }> {
  if (templates.length === 0) return { digit: null, conf: 0 };
  let target = image;
  const ref = templates[0].image;
  if (image.width !== ref.width || image.height !== ref.height) {
    target = await resizeGray(image, ref.width, ref.height);
  }
  let bestDigit: number | null = null;
  let bestConf = -Infinity;

  for (const t of templates) {
    const { conf } = mseScore(target, t.image);
    if (conf > bestConf) {
      bestConf = conf;
      bestDigit = t.digit;
    }
  }

  return { digit: bestDigit, conf: Math.max(0, Math.min(1, bestConf)) };
}

type Box = { x: number; y: number; w: number; h: number };

function clampBox(box: Box, bounds: Box): Box {
  const x = Math.max(bounds.x, Math.min(box.x, bounds.x + bounds.w - 1));
  const y = Math.max(bounds.y, Math.min(box.y, bounds.y + bounds.h - 1));
  const w = Math.max(1, Math.min(box.w, bounds.x + bounds.w - x));
  const h = Math.max(1, Math.min(box.h, bounds.y + bounds.h - y));
  return { x, y, w, h };
}

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

async function matchTemplate(
  target: GrayImage,
  template: GrayImage
): Promise<{ x: number; y: number; score: number }> {
  const tw = template.width;
  const th = template.height;
  if (tw > target.width || th > target.height) {
    return { x: 0, y: 0, score: -Infinity };
  }
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

export async function readSupply(
  framePath: string,
  supplyRoi: { x: number; y: number; w: number; h: number },
  templates: DigitTemplates
): Promise<SupplyReading> {
  const usedDigits: number[] = [];
  const totalDigits: number[] = [];
  let conf = 1;

  const stripBox: Box = { x: supplyRoi.x, y: supplyRoi.y, w: supplyRoi.w, h: supplyRoi.h };

  let slashX = stripBox.x + Math.floor(stripBox.w * 0.6);
  if (existsSync(SLASH_PATH)) {
    const stripGray = binarize(await loadGray(framePath, stripBox));
    const slashTemplate = binarize(await loadGray(SLASH_PATH));
    const slashMatch = await matchTemplate(stripGray, slashTemplate);
    slashX = stripBox.x + slashMatch.x + Math.floor(slashTemplate.width / 2);
  }

  const boxW = templates.size.w;
  const boxH = templates.size.h;
  const gap = 1;

  let bestUsed: Box[] = [];
  let bestTotal: Box[] = [];
  let bestScore = -Infinity;

  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const baseY = stripBox.y + 2 + dy;
      const usedBox2 = clampBox(
        { x: slashX - gap - boxW + dx, y: baseY, w: boxW, h: boxH },
        stripBox
      );
      const usedBox1 = clampBox(
        { x: usedBox2.x - gap - boxW, y: usedBox2.y, w: boxW, h: boxH },
        stripBox
      );
      const totalBox1 = clampBox(
        { x: slashX + gap + dx, y: baseY, w: boxW, h: boxH },
        stripBox
      );
      const totalBox2 = clampBox(
        { x: totalBox1.x + gap + boxW, y: totalBox1.y, w: boxW, h: boxH },
        stripBox
      );

      const boxesUsed = [usedBox1, usedBox2];
      const boxesTotal = [totalBox1, totalBox2];

      let score = 0;
      for (const b of boxesUsed) {
        const img = binarize(await loadGray(framePath, b));
        const m = await matchDigit(img, templates.used);
        score += m.conf;
      }
      for (const b of boxesTotal) {
        const img = binarize(await loadGray(framePath, b));
        const m = await matchDigit(img, templates.total);
        score += m.conf;
      }
      if (score > bestScore) {
        bestScore = score;
        bestUsed = boxesUsed;
        bestTotal = boxesTotal;
      }
    }
  }

  const usedBoxes = bestUsed;
  const totalBoxes = bestTotal;

  for (const box of usedBoxes) {
    const image = binarize(await loadGray(framePath, box));
    if (!isActiveDigit(image)) {
      conf = Math.min(conf, 0.2);
      continue;
    }
    const match = await matchDigit(image, templates.used);
    if (match.digit === null || match.conf < MIN_CONF) {
      conf = Math.min(conf, match.conf);
      continue;
    }
    usedDigits.push(match.digit);
    conf = Math.min(conf, match.conf);
  }

  for (const box of totalBoxes) {
    const image = binarize(await loadGray(framePath, box));
    if (!isActiveDigit(image)) {
      conf = Math.min(conf, 0.2);
      continue;
    }
    const match = await matchDigit(image, templates.total);
    if (match.digit === null || match.conf < MIN_CONF) {
      conf = Math.min(conf, match.conf);
      continue;
    }
    totalDigits.push(match.digit);
    conf = Math.min(conf, match.conf);
  }

  const used = usedDigits.length ? Number(usedDigits.slice(-2).join("")) : null;
  const total = totalDigits.length ? Number(totalDigits.slice(-2).join("")) : null;

  return { used, total, conf };
}
