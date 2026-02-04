import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadGray, mseScore, resizeGray, type Roi, type GrayImage } from "../roi/crop.js";

export type DigitTemplate = {
  digit: number;
  image: GrayImage;
};

export type SupplyReading = {
  used: number | null;
  total: number | null;
  conf: number;
};

const MIN_ACTIVE_VARIANCE = 15;

export async function loadDigitTemplates(dir: string): Promise<DigitTemplate[]> {
  const files = readdirSync(dir).filter(name => [".png", ".jpg", ".jpeg"].includes(extname(name)));
  const templates: DigitTemplate[] = [];

  for (const file of files) {
    const name = basename(file, extname(file));
    const digit = Number(name);
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) continue;
    const image = await loadGray(join(dir, file));
    templates.push({ digit, image });
  }

  return templates;
}

function isActiveDigit(image: GrayImage) {
  let sum = 0;
  for (let i = 0; i < image.data.length; i += 1) sum += image.data[i];
  const mean = sum / image.data.length;
  let acc = 0;
  for (let i = 0; i < image.data.length; i += 1) {
    const d = image.data[i] - mean;
    acc += d * d;
  }
  const variance = acc / image.data.length;
  return variance >= MIN_ACTIVE_VARIANCE;
}

async function matchDigit(image: GrayImage, templates: DigitTemplate[]): Promise<{ digit: number | null; conf: number }>
{
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

export async function readSupply(
  framePath: string,
  supplyRoi: { used_boxes: Roi[]; total_boxes: Roi[] },
  templates: DigitTemplate[]
): Promise<SupplyReading> {
  const usedDigits: number[] = [];
  const totalDigits: number[] = [];
  let conf = 1;

  for (const box of supplyRoi.used_boxes) {
    const image = await loadGray(framePath, box);
    if (!isActiveDigit(image)) {
      conf = Math.min(conf, 0.2);
      continue;
    }
    const match = await matchDigit(image, templates);
    if (match.digit === null) {
      conf = Math.min(conf, match.conf);
      continue;
    }
    usedDigits.push(match.digit);
    conf = Math.min(conf, match.conf);
  }

  for (const box of supplyRoi.total_boxes) {
    const image = await loadGray(framePath, box);
    if (!isActiveDigit(image)) {
      conf = Math.min(conf, 0.2);
      continue;
    }
    const match = await matchDigit(image, templates);
    if (match.digit === null) {
      conf = Math.min(conf, match.conf);
      continue;
    }
    totalDigits.push(match.digit);
    conf = Math.min(conf, match.conf);
  }

  const used = usedDigits.length ? Number(usedDigits.join("")) : null;
  const total = totalDigits.length ? Number(totalDigits.join("")) : null;

  return { used, total, conf };
}
