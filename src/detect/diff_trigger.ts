import { loadGray, meanAbsoluteDiff, type Roi } from "../roi/crop.js";

export type DiffHit = {
  t: number;
  frame: string;
  score: number;
};

export async function detectRoiChanges(
  frames: { t: number; path: string }[],
  roi: Roi,
  threshold: number
): Promise<DiffHit[]> {
  const hits: DiffHit[] = [];
  if (frames.length < 2) return hits;
  let prev = await loadGray(frames[0].path, roi);

  for (let i = 1; i < frames.length; i += 1) {
    const current = await loadGray(frames[i].path, roi);
    const score = meanAbsoluteDiff(prev, current);
    if (score >= threshold) {
      hits.push({ t: frames[i].t, frame: frames[i].path, score });
      prev = current;
    }
  }

  return hits;
}
