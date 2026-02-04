import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { loadGray, mseScore, resizeGray, type GrayImage, type Roi } from "../roi/crop.js";

export type QueueTemplate = {
  id: string;
  image: GrayImage;
};

export type QueueHit = {
  item_id: string;
  conf: number;
  slot: number;
};

export type QueueSlots = {
  count: number;
  slot_w: number;
  slot_h: number;
  gap: number;
  start_x: number;
  start_y: number;
};

export async function loadQueueTemplates(dir: string): Promise<QueueTemplate[]> {
  const files = readdirSync(dir).filter(name => [".png", ".jpg", ".jpeg"].includes(extname(name)));
  const templates: QueueTemplate[] = [];

  for (const file of files) {
    const id = basename(file, extname(file));
    const image = await loadGray(join(dir, file));
    templates.push({ id, image });
  }

  return templates;
}

function slotRoi(queueRoi: Roi, slots: QueueSlots, index: number): Roi {
  const x = queueRoi.x + slots.start_x + index * (slots.slot_w + slots.gap);
  const y = queueRoi.y + slots.start_y;
  return { x, y, w: slots.slot_w, h: slots.slot_h };
}

export async function readQueueIcons(
  framePath: string,
  queueRoi: Roi,
  slots: QueueSlots,
  templates: QueueTemplate[],
  minConf = 0.6
): Promise<QueueHit[]> {
  if (templates.length === 0) return [];
  const hits: QueueHit[] = [];

  for (let i = 0; i < slots.count; i += 1) {
    const roi = slotRoi(queueRoi, slots, i);
    const slotImage = await loadGray(framePath, roi);

    let bestId = "";
    let bestConf = -Infinity;

    for (const t of templates) {
      let target = slotImage;
      if (slotImage.width !== t.image.width || slotImage.height !== t.image.height) {
        target = await resizeGray(slotImage, t.image.width, t.image.height);
      }
      const { conf } = mseScore(target, t.image);
      if (conf > bestConf) {
        bestConf = conf;
        bestId = t.id;
      }
    }

    if (bestConf >= minConf) {
      hits.push({ item_id: bestId, conf: Math.max(0, Math.min(1, bestConf)), slot: i });
    }
  }

  return hits;
}
