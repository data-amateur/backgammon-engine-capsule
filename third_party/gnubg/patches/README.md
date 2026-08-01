<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# GNUbg source patches

All files in this directory are capsule-authored modifications to GNU
Backgammon and are licensed `GPL-3.0-or-later`. They are corresponding source
for the patched GNUbg build and are applied, in the build script's explicit order, only after the
signed upstream archive has been authenticated and freshly extracted.

## Patch order

1. `0001-race-bearoff-without-two-sided-db.patch` targets GNUbg 1.08.003.
   It changes `eval.c` so the race backgammon correction uses GNUbg's
   initialized one-sided heuristic when the optional two-sided bearoff
   database is absent. This keeps the browser-oriented build database-free
   without passing a null context to `EvalBearoff2`.

The signed archive under `third_party/gnubg/upstream/` remains byte-for-byte
unchanged. `scripts/prepare-gnubg-source.mjs` records the path and SHA-256 of
every applied patch in the generated preparation and build manifests.
