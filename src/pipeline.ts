import { mkdirSync, existsSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { decodeFrames } from "./decode/ffmpeg_decode.js";
import { detectRoiChanges } from "./detect/diff_trigger.js";
import { loadDigitTemplates, readSupply } from "./detect/digit_supply.js";
import { loadQueueTemplates, readQueueIcons } from "./detect/icon_queue.js";

export type Roi = { x: number; y: number; w: number; h: number };

export type Profile = {
  name: string;
  resolution: { w: number; h: number };
  supply: { x: number; y: number; w: number; h: number; used_boxes: Roi[]; total_boxes: Roi[] };
  selection_panel: Roi;
  production_queue: { x: number; y: number; w: number; h: number; slots: any };
};

export type PipelineOptions = {
  input: string;
  outDir: string;
  profilePath: string;
  fps: number;
  startSec: number;
  endSec: number;
};

export type SignalOutput = {
  version: number;
  segment: { start_sec: number; end_sec: number };
  roi_profile: string;
  signals: {
    supply_series: { t: number; used: number | null; total: number | null; conf: number }[];
    selection_changes: { t: number; frame: string }[];
    queue_events: { t: number; item_id: string; conf: number; frame: string }[];
  };
  events: { t: number; id: string; count: number; conf: number; evidence: string[] }[];
  diagnostics: { warnings: string[] };
};

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readProfile(path: string): Profile {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Profile;
}

function copyEvidence(framePath: string, evidenceDir: string, prefix: string, index: number) {
  ensureDir(evidenceDir);
  const filename = `${prefix}_${String(index).padStart(6, "0")}.jpg`;
  const outPath = resolve(evidenceDir, filename);
  copyFileSync(framePath, outPath);
  return join("evidence", filename);
}

function dedupeEvents(
  events: { t: number; id: string; count: number; conf: number; evidence: string[] }[]
) {
  const map = new Map<string, { t: number; id: string; count: number; conf: number; evidence: string[] }>();
  for (const e of events) {
    const key = `${Math.floor(e.t)}:${e.id}`;
    const existing = map.get(key);
    if (!existing || e.conf > existing.conf) {
      map.set(key, e);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

export async function runPipeline(opts: PipelineOptions): Promise<SignalOutput> {
  const outDir = resolve(opts.outDir);
  ensureDir(outDir);
  const evidenceDir = resolve(outDir, "evidence");

  const profile = readProfile(opts.profilePath);
  const warnings: string[] = [];
  const digitTemplates = await loadDigitTemplates(resolve("assets/templates/digits"));
  const queueTemplates = await loadQueueTemplates(resolve("assets/templates/queue"));
  if (digitTemplates.used.length + digitTemplates.total.length === 0) warnings.push("digit_templates_empty");
  if (queueTemplates.length === 0) warnings.push("queue_templates_empty");

  const frames = await decodeFrames({
    input: opts.input,
    outDir: join(outDir, "frames"),
    fps: opts.fps,
    startSec: opts.startSec,
    endSec: opts.endSec
  });

  const supplySeries: SignalOutput["signals"]["supply_series"] = [];
  let lastSupplyKey = "";

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const reading = await readSupply(frame.path, profile.supply, digitTemplates);
    const key = `${reading.used}-${reading.total}`;
    if (key !== lastSupplyKey) {
      supplySeries.push({ t: frame.t, used: reading.used, total: reading.total, conf: reading.conf });
      lastSupplyKey = key;
    }
  }

  const selectionDiffs = await detectRoiChanges(frames, profile.selection_panel, 0.08);
  const selectionChanges = selectionDiffs.map((hit, idx) => ({
    t: hit.t,
    frame: copyEvidence(hit.frame, evidenceDir, "sel", idx + 1)
  }));

  const queueDiffs = await detectRoiChanges(frames, profile.production_queue, 0.08);
  const queueEvents: SignalOutput["signals"]["queue_events"] = [];

  for (let i = 0; i < queueDiffs.length; i += 1) {
    const hit = queueDiffs[i];
    const evidence = copyEvidence(hit.frame, evidenceDir, "q", i + 1);
    const icons = await readQueueIcons(hit.frame, profile.production_queue, profile.production_queue.slots, queueTemplates, 0.6);
    for (const icon of icons) {
      queueEvents.push({ t: hit.t, item_id: icon.item_id, conf: icon.conf, frame: evidence });
    }
  }

  const events = dedupeEvents(
    queueEvents.map(e => ({
      t: e.t,
      id: `${e.item_id}_started`,
      count: 1,
      conf: e.conf,
      evidence: [e.frame]
    }))
  );

  const output: SignalOutput = {
    version: 1,
    segment: { start_sec: opts.startSec, end_sec: opts.endSec },
    roi_profile: profile.name,
    signals: {
      supply_series: supplySeries,
      selection_changes: selectionChanges,
      queue_events: queueEvents
    },
    events,
    diagnostics: { warnings }
  };

  const outPath = resolve(outDir, "result.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  return output;
}
