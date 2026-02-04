# sc1-buildorder-signals

MVP extractor for StarCraft: Remastered build-order signals.

## Scope (v0.1)
- 1080p only
- mp4 input, 0-420s
- No OCR/CNN/DP
- Signals first, events minimal

## Outputs
Produces JSON with `signals` (supply series, selection changes, queue events) and minimal `events`.

## Quickstart
```bash
pnpm install
pnpm dev -- --input sample.mp4 --out out --profile profiles/profile_rm_1080p.json --fps 2 --start 0 --end 420
```

## Notes
- Requires `ffmpeg` on PATH. If not, set `FFMPEG_PATH` to the full executable path.
- Calibrate ROI values in `profiles/profile_rm_1080p.json` for your capture.
- Auto-scaled 480p profile: `profiles/profile_rm_854x480.json` (verify ROI manually).
- Add digit templates (0-9) under `assets/templates/digits/`.
- Add queue icon templates under `assets/templates/queue/`.

## CLI
```bash
pnpm dev -- --input <video.mp4> --out <out_dir> --profile <profile.json> [--fps 2] [--start 0] [--end 420]
```

## Repo structure
```
src/
  decode/ffmpeg_decode.ts
  roi/crop.ts
  detect/diff_trigger.ts
  detect/digit_supply.ts
  detect/icon_queue.ts
  pipeline.ts
  eval/eval.ts
  cli.ts
profiles/
  profile_rm_1080p.json
```
