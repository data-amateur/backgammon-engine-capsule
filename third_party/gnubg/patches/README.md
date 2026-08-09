<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# GNUbg source patches

All files in this directory are capsule-authored modifications to GNU
Backgammon and are licensed `GPL-3.0-or-later`. They are corresponding source
for the patched GNUbg build. The preparation script applies them in the
explicit order below only after authenticating and freshly extracting the
signed upstream archive.

## Patch order

1. `0001-race-bearoff-without-two-sided-db.patch` targets GNUbg 1.08.003.
   It changes `eval.c` so the race backgammon correction uses GNUbg's
   initialized one-sided heuristic when the optional two-sided bearoff
   database is absent. This keeps the browser-oriented build database-free
   without passing a null context to `EvalBearoff2`.

2. `0002-recoverable-engine-initialization.patch` makes the selected headless
   evaluator report initialization failures instead of asserting, exiting, or
   continuing with partial state. It validates all six neural-network shapes
   before committing them, rejects incomplete and non-finite weights, cleans up
   partial allocations, checks the heuristic bearoff and evaluation workspace,
   makes shutdown clear process-global resources, and exposes build-time cache
   entry limits used by the constrained wasm runtime. Recoverable setup uses
   capsule-only `BGC_EvalInitialise()` and `BGC_MT_InitThreads()` status
   entry points; the upstream `EvalInitialise(void)` and `MT_InitThreads(void)`
   signatures remain intact for existing callers.

3. `0003-embed-kazaross-met-for-wasm.patch` adds the
   `BGC_EMBEDDED_KAZAROSS_MET` build path. That path excludes GNUbg's generic
   GLib XML/list match-equity loader and initializes the evaluator from exact
   binary32 values generated from the authenticated `Kazaross-XG2.xml`. The
   ordinary native XML path remains available so verification can compare the
   fully extended and cached tables against the embedded path.

The signed archive under `third_party/gnubg/upstream/` remains byte-for-byte
unchanged. `scripts/prepare-gnubg-source.mjs` records the path and SHA-256 of
every applied patch in the generated preparation and build manifests. The
generated match-equity include is ignored build output; its generator and
tests are corresponding source and preserve the upstream table notice.
