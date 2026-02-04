import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2).filter(a => a !== "--");
const input = args[0] || "samples/yt_480p_frame_25s.jpg";
const profilePath = args[1] || "profiles/profile_rm_854x480.json";

const supplyStrip = { x: 700, y: 0, w: 150, h: 30 };

function clustersFromMask(mask) {
  const cols = [];
  for (let x = 0; x < mask.width; x += 1) {
    let s = 0;
    for (let y = 0; y < mask.height; y += 1) {
      s += mask.data[y * mask.width + x] ? 1 : 0;
    }
    cols.push(s);
  }
  const on = cols.map(v => v > 2);
  const clusters = [];
  let start = -1;
  for (let x = 0; x < on.length; x += 1) {
    if (on[x] && start < 0) start = x;
    if (!on[x] && start >= 0) {
      clusters.push([start, x - 1]);
      start = -1;
    }
  }
  if (start >= 0) clusters.push([start, on.length - 1]);
  return clusters;
}

function bboxFromCluster(mask, a, b) {
  let miny = mask.height, maxy = -1;
  for (let x = a; x <= b; x += 1) {
    for (let y = 0; y < mask.height; y += 1) {
      if (mask.data[y * mask.width + x]) {
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxy < 0) return null;
  return { x: a, y: miny, w: b - a + 1, h: maxy - miny + 1 };
}

async function main() {
  const { data, info } = await sharp(input)
    .extract({ left: supplyStrip.x, top: supplyStrip.y, width: supplyStrip.w, height: supplyStrip.h })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const green = { width: W, height: H, data: new Uint8Array(W * H) };
  const white = { width: W, height: H, data: new Uint8Array(W * H) };

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const idx = (y * W + x) * info.channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const isGreen = g > 120 && g > r + 20 && g > b + 20;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const avg = (r + g + b) / 3;
      const isWhite = avg > 140 && max - min < 60 && !(g > r + 20 && g > b + 20);
      green.data[y * W + x] = isGreen ? 1 : 0;
      white.data[y * W + x] = isWhite ? 1 : 0;
    }
  }

  const greenClusters = clustersFromMask(green).map(([a, b]) => ({ a, b, bbox: bboxFromCluster(green, a, b) })).filter(c => c.bbox);
  const whiteClusters = clustersFromMask(white).map(([a, b]) => ({ a, b, bbox: bboxFromCluster(white, a, b) })).filter(c => c.bbox);

  // sort by x
  greenClusters.sort((c1, c2) => c1.a - c2.a);
  whiteClusters.sort((c1, c2) => c1.a - c2.a);

  // take rightmost two green clusters as total digits
  const totalClusters = greenClusters.slice(-2);
  // take rightmost white cluster as used digit
  const usedCluster = whiteClusters.slice(-1)[0];

  if (!usedCluster || totalClusters.length === 0) {
    throw new Error("Failed to detect digits. Try different frame.");
  }

  const usedCenterX = supplyStrip.x + usedCluster.bbox.x + Math.floor(usedCluster.bbox.w / 2);
  const usedCenterY = supplyStrip.y + usedCluster.bbox.y + Math.floor(usedCluster.bbox.h / 2);

  const totalBoxes = totalClusters.map(c => ({
    x: supplyStrip.x + c.bbox.x,
    y: supplyStrip.y + c.bbox.y,
    w: c.bbox.w,
    h: c.bbox.h
  }));
  const digitW = Math.max(...totalBoxes.map(b => b.w), usedCluster.bbox.w, 10);
  const digitH = Math.max(...totalBoxes.map(b => b.h), usedCluster.bbox.h, 14);
  const usedBox = {
    x: Math.max(0, usedCenterX - Math.floor(digitW / 2)),
    y: Math.max(0, usedCenterY - Math.floor(digitH / 2)),
    w: digitW,
    h: digitH
  };

  // expand to 3 boxes by padding with same width on left if needed
  while (totalBoxes.length < 3) {
    const first = totalBoxes[0];
    totalBoxes.unshift({ x: first.x - first.w - 2, y: first.y, w: first.w, h: first.h });
  }

  const usedBoxes = [usedBox];
  while (usedBoxes.length < 3) {
    const first = usedBoxes[0];
    usedBoxes.unshift({ x: first.x - first.w - 2, y: first.y, w: first.w, h: first.h });
  }

  const supply = {
    x: supplyStrip.x,
    y: supplyStrip.y,
    w: supplyStrip.w,
    h: supplyStrip.h,
    used_boxes: usedBoxes,
    total_boxes: totalBoxes
  };

  const profile = JSON.parse(readFileSync(profilePath, "utf-8"));
  profile.note = "Auto-calibrated from frame using green/white masks. Verify ROI manually.";
  profile.supply = supply;
  writeFileSync(profilePath, JSON.stringify(profile, null, 2));

  console.log("updated", profilePath);
  console.log("used_boxes", usedBoxes);
  console.log("total_boxes", totalBoxes);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
