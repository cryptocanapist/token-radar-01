# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Pre-token protocols ranked by implied value, with a farm plan for each one. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## What it is

A program (`main.ts`, Node 22, standard library only) reads the sealed DefiLlama snapshot, scores every pre-token protocol, and writes a static dashboard:

- `board.json` — 200 ranked rows (the 40-protocol watchlist plus 160 early pre-token protocols below the $50M floor), each with an implied value and farm steps.
- `dashboard/` — a static page (no network) with the board, a detail view per protocol, and filters.
- `dossier.json` — the dashboard dossier the judge reads.

## The model (phase 1: starter baseline)

Implied value follows only from the snapshot's own figures:

```
implied = TVL × 0.25 × (1 + clamp(change_7d, −60, 120) / 100 × 0.5)
        × (0.6 + min(age_days, 1095) / 1095 × 0.4)
```

Phase 2 replaces the flat 0.25 with a comps-fitted multiple (see `PLAN.md`): live-token protocols' market-cap/TVL ratios by category, validated out-of-sample. No protocol name is ever special-cased.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input-snapshot.json
```

## Status

Phase 1 skeleton only — the starter model, not a submission. See `PLAN.md` for the full plan, gate, judge criteria, and blockers.
