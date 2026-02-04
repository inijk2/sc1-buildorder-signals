export type Event = { t: number; id: string; count: number };

export type EvalResult = {
  precision: number;
  recall: number;
  f1: number;
  mean_dt: number;
  matched: number;
  predicted: number;
  ground_truth: number;
};

export function evaluateEvents(pred: Event[], gt: Event[], tolSec = 3): EvalResult {
  const usedPred = new Set<number>();
  let matched = 0;
  let sumDt = 0;

  for (let i = 0; i < gt.length; i += 1) {
    const g = gt[i];
    let bestIdx = -1;
    let bestDt = Infinity;

    for (let j = 0; j < pred.length; j += 1) {
      if (usedPred.has(j)) continue;
      const p = pred[j];
      if (p.id !== g.id) continue;
      const dt = Math.abs(p.t - g.t);
      if (dt <= tolSec && dt < bestDt) {
        bestDt = dt;
        bestIdx = j;
      }
    }

    if (bestIdx >= 0) {
      usedPred.add(bestIdx);
      matched += 1;
      sumDt += bestDt;
    }
  }

  const precision = pred.length ? matched / pred.length : 0;
  const recall = gt.length ? matched / gt.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const mean_dt = matched ? sumDt / matched : 0;

  return {
    precision,
    recall,
    f1,
    mean_dt,
    matched,
    predicted: pred.length,
    ground_truth: gt.length
  };
}
