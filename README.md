# RADAR — pre-launch protocol intelligence

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cakra-air/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cakra-air/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar built for the [make.fun `token-radar-01` bounty](https://make.fun/bounty/token-radar-01). It reads the sealed DefiLlama snapshot and writes a dashboard that prices every protocol recording no token, then shows how to farm each one.

**Live on make.fun:** https://make.fun/bounty/token-radar-01

## What it does

- `main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, writes `/output/board.json`, `/output/data.js`, copies `dashboard/` and `screenshots/`, and writes `/output/dossier.json` with the kit's vendored `buildDossier`.
- `lib/model.ts` fits a log–log size curve (TVL → market cap) to the 119 protocols in the snapshot that already trade, adds a category residual, then adjusts by seven-day momentum, quiet days since listing, chain breadth and a class weight. It publishes a P10–P90 band and an out-of-sample check on 59 held-out comparables.
- The board covers all 40 watchlist protocols plus every other pre-token record in the snapshot — 342 rows — with six costed farm steps each. Wrapped, staked, bridged and exchange products of an asset that already trades are discounted rather than hidden.
- `dashboard/` is a hand-built static page: sortable/filterable board, per-protocol detail with the model shown, and a farm verdict per row. No framework, no network.

## Run locally

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## Model

`implied = round(sizeCurve(TVL) × 10^familyOffset × momentum × quiet × breadth × classWeight)`, where `sizeCurve` is fitted by least squares on the traded comparables in the snapshot. No protocol name is special-cased, so a future snapshot yields a future board. Implied value is this entry's own estimate from the sealed figures — not a price and not a forecast of a launch.

Licensed under MIT (see LICENSE).
