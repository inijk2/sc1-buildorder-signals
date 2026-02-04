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

## Digit Templates (Quick Helper)
Extract candidate digit crops from the supply boxes:
```bash
pnpm extract:digits -- --input samples/yt_480p.mp4 --profile profiles/profile_rm_854x480.json --fps 1 --start 0 --end 120
```

It writes candidates to `assets/templates/digits/candidates/` with a `manifest.json`.
Manually pick good samples and rename them to `0.png` ... `9.png` under
`assets/templates/digits/`.

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
