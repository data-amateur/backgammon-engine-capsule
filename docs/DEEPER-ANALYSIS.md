# Selected Deeper analysis, schema 1

Stage 5 advertises `deep-2ply-v1` for `analyze-checker` and `analyze-cube`.
It is a fixed review profile: deterministic cubeful GNUbg evaluation, two
plies, zero noise, internal neural pruning enabled. It does not adapt to
gameplay strength, time or candidate limits. A deadline terminates the
compute Worker; it never produces a completed weaker or partial result.
Quick and Deeper remain distinct results and evaluation fingerprints.

## Checker roots

The native adapter first scores and ranks **every unique legal final
position** with `quick-0ply-v1`. It then selects roots in that frozen order:

1. Keep the best two, or every position if fewer than two exist.
2. Keep further positions within 0.160 equity of the Quick best, up to eight
   roots total.
3. Always add the played position if it is outside this set, giving at most
   nine roots.
4. Score every retained root with `{TRUE, 2, TRUE, TRUE, 0.0f}`, passing
   `nPlies=2` to upstream `ScoreMove`. Rank the retained set by its 2-ply
   scores. Quick scores are never used in the final comparison or loss.

The filter version is `quick-top2-window160-max8-plus-played-v1`. This is
RollBG's policy, rather than a GNUbg desktop preset. GNUbg's `fUsePrune`
selects reply moves with its pruning networks inside the recursive
evaluator; it is separate from RollBG's root selection and is recorded as
`pruning: true`. Natural terminal evaluations can finish before two plies.

`legalPositionCount` is the complete legal set size;
`evaluatedPositionCount` is the complete retained root set evaluated at
2-ply, including played. Returned ranks refer to that retained set.
`maxAlternatives` still limits output to the best one through five, plus
played when necessary (at most six); it cannot reduce the searched roots.
The UI describes this as **“Best found among the candidates searched at
2-ply.”**

## Cube branches

Deeper cube analysis evaluates all relevant N/T/P branches at the same
fixed 2-ply depth, using the committed board and common pre-offer cube.
The existing pinned native two-ply context supplies these settings;
analysis bypasses the gameplay budget policy that could otherwise select
zero plies. Its `filterPolicy` identifies the named profile's checker root
policy; cube analysis does not apply a root shortlist to cube actions.

Offer and response perspectives, normalized equities, minimax losses,
too-good semantics and unsupported positions are identical to the
[cube contract](CUBE-ANALYSIS.md). No Quick branch is substituted into a
Deeper comparison.

## Compatibility and provenance

This remains an optional BEP v1 extension with analysis schema 1. The
additive checker ABI uses profile value 2 in the existing 312-byte request,
and depth/pruning/profile fields in the existing 64-byte result. No layout,
arena descriptor or gameplay export changes. The bridge and Worker reject
invalid root counts, inconsistent ranks or weaker effective settings.

Initialized handshakes may include `deepProvenance` alongside
`quickProvenance`: exact capsule build, assets, weights, MET, bearoff mode,
requested/effective profile, depth, pruning, filter and completion. Hosts
gate each request on the advertised method/profile. Quick-only and legacy
capsules remain valid; an unavailable profile is explicit `unsupported`.

One serial Worker serves both profiles. Timeout/cancellation destroys it;
the next request requires a fresh handshake under its loading budget
before starting the computation budget. Completed Quick results survive.
The RollBG host uses a configurable provisional 30-second selected Deeper
deadline and does not schedule full-match Deeper work automatically.

## Independent verification

`gnubg-deep-analysis-reference-v1.json` and
`gnubg-cube-deep-analysis-reference-v1.json` pin direct upstream calls
with literal actor-relative boards and cube information. The reference
tool never calls either capsule analysis function or its board mapper.
Its checker selection uses pairwise frozen Quick ranks rather than the
adapter's sorting/compaction. Normal tests read checked-in answers; they
never regenerate expectations from the analyzer under test.

```bash
npm run build:gnubg-native
build/gnubg/native/gnubg-analysis-reference-dump third_party/gnubg/work/gnubg-1.08.003 --deep
build/gnubg/native/gnubg-analysis-reference-dump third_party/gnubg/work/gnubg-1.08.003 --cube-deep
npm run test:gnubg-native
npm run test:gnubg-native:sanitized
npm run test:wasm-abi-layout:sanitized
# Activate the pinned Emscripten SDK for these commands.
npm run test:wasm-abi
npm run test:gnubg-wasm
npm run build:verification
npm run test:e2e
```

Coverage includes mirrored colors, asymmetric match scores, eight roots,
played as a ninth root, output limits, alternate legal paths, forced moves
and passes, terminal higher-die legality, raw cube branches and both roles,
too-good/unavailable cubes, and recoverable rejection. Host browser tests
also check profile selection, separate summaries/cache, immutable previews,
timeout/retry, Stop and provenance invalidation. Measured device performance
and default-budget tuning belong to Stage 6.
