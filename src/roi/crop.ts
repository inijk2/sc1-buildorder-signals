import sharp from "sharp";

export type Roi = { x: number; y: number; w: number; h: number };

export type GrayImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type MaskMode = "green" | "white";

export async function cropToFile(inputPath: string, roi: Roi, outPath: string) {
  await sharp(inputPath)
    .extract({ left: roi.x, top: roi.y, width: roi.w, height: roi.h })
    .jpeg({ quality: 92 })
    .toFile(outPath);
}

export async function loadGray(
  inputPath: string,
  roi?: Roi,
  resize?: { w: number; h: number }
): Promise<GrayImage> {
  let pipeline = sharp(inputPath);
  if (roi) {
    pipeline = pipeline.extract({ left: roi.x, top: roi.y, width: roi.w, height: roi.h });
  }
  if (resize) {
    pipeline = pipeline.resize(resize.w, resize.h, { fit: "fill" });
  }
  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const gray = new Uint8Array(info.width * info.height);
  for (let i = 0; i < info.width * info.height; i += 1) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  return { width: info.width, height: info.height, data: gray };
}

export async function loadMask(
  inputPath: string,
  roi: Roi | undefined,
  mode: MaskMode,
  resize?: { w: number; h: number }
): Promise<GrayImage> {
  let pipeline = sharp(inputPath);
  if (roi) {
    pipeline = pipeline.extract({ left: roi.x, top: roi.y, width: roi.w, height: roi.h });
  }
  if (resize) {
    pipeline = pipeline.resize(resize.w, resize.h, { fit: "fill" });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const mask = new Uint8Array(info.width * info.height);

  for (let i = 0; i < info.width * info.height; i += 1) {
    const r = data[i * channels];
    const g = data[i * channels + 1];
    const b = data[i * channels + 2];
    const isGreen = g > 90 && g > r + 10 && g > b + 10;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const avg = (r + g + b) / 3;
    const isWhite = avg > 120 && max - min < 80 && !isGreen;
    const on = mode === "green" ? isGreen : isWhite;
    mask[i] = on ? 255 : 0;
  }

  return { width: info.width, height: info.height, data: mask };
}

export function meanAbsoluteDiff(a: GrayImage, b: GrayImage) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("Image sizes must match for diff");
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    sum += Math.abs(a.data[i] - b.data[i]);
  }
  return sum / (a.data.length * 255);
}

export function mseScore(a: GrayImage, b: GrayImage) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("Image sizes must match for MSE");
  }
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    const d = a.data[i] - b.data[i];
    sum += d * d;
  }
  const mse = sum / a.data.length;
  const conf = 1 - mse / (255 * 255);
  return { mse, conf };
}

export async function resizeGray(image: GrayImage, w: number, h: number): Promise<GrayImage> {
  const { data, info } = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 1 }
  })
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

export function variance(image: GrayImage) {
  const n = image.data.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += image.data[i];
  const mean = sum / n;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const d = image.data[i] - mean;
    acc += d * d;
  }
  return acc / n;
}
