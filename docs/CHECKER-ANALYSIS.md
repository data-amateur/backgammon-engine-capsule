# Checker analysis, schema 1

Stages 0–1 add an optional BEP v1 analysis extension for
`analyze-checker` and `quick-0ply-v1`. [Stage 5](DEEPER-ANALYSIS.md) adds the independent selected `deep-2ply-v1` profile. Stage 4 also advertises
[`analyze-cube`](CUBE-ANALYSIS.md). The existing `choose-turn`,
`decide-cube`, protocol version, arena ABI 1.0 descriptor, and gameplay layouts
remain compatible. A legacy WASM module without the additive descriptor can
still play, but does not advertise analysis. An incomplete or incompatible
analysis descriptor fails startup rather than decoding an unknown layout.

The application contract lives in `shared/src/engineProtocol.ts` in RollBG;
this repository mirrors its analysis types and validation in `src/protocol/`.
Both copies test the same serialized `bep-analysis-v1.json` corpus and pin its
SHA-256 (`9a908e34d16067c08a1050142f901bc58dcede4233533c8a423cba8cdb093a0d`).
The corpus includes old/new handshakes, a complete terminal bearoff request,
and malformed requests and responses, plus both cube roles and all four
recorded actions, plus Deeper requests, results, provenance and root bounds.

## Request and numerical meaning

After `hello`, send `analyze-checker` with schema version 1, the fully specified
BEP position, its actor, `quick-0ply-v1`, a positive integer `timeMs` within
the existing BEP ceiling, the recorded turn's steps, its expected final board,
and `maxAlternatives` from 1 through 5. An empty recorded turn represents a
pass and is accepted only when GNUbg has no legal move. An already finished
position is rejected.

Absolute points retain their BEP meaning: white moves from 23 toward 0; black
moves from 0 toward 23. Score, cube ownership, and Crawford state retain fixed
player identities. Equity is GNUbg's normalized cubeful equity from the
decision actor's perspective. `ScoreMove` performs the post-turn side switch,
inversion, and match-equity normalization. Equities are finite but are not
restricted to money-play ranges. Loss is best equity minus played equity,
not a probability or percentage. Numerical comparisons use tolerance 0.00001.

## Complete legal alternatives

`bgc_engine_analyze_checker` generates the full legal root set with GNUbg,
then copies keys and canonical moves into owned storage before calling the
evaluator. This matters because move generation and recursive evaluation
share upstream temporary storage. Every unique final position is scored
with the literal context `{ cubeful: true, depth: 0, pruning: false,
deterministic: true, noise: 0 }`. The display limit never filters evaluation.
The pinned generator's maximum must fit the 4,096-position protocol ceiling;
an exceeded bound is an error, never partial coverage.

The recorded path is replayed with dice availability, direction, bar priority,
blocks, hits, and bearoff checks. Before each bearoff, the evolving intermediate
board must have all remaining checkers at home. An oversized die additionally
requires no checker on a higher home point; an exact die may bear off beneath
a higher checker. A later legal ordering reaching the same final board cannot
make an earlier illegal bearoff valid. Its step count and total consumed dice must
match GNUbg's maximal-use requirements, and its final key must belong to the
generated set and match the supplied expected board. Checking only the final
board would incorrectly accept a lower die in some terminal bearoffs.

Results contain the top requested alternatives in rank order, plus played
when it falls outside them (at most six). Ranks refer to the full legal set.
Ties with best use the documented numerical tolerance; exact sorting uses
cubeful equity, cubeless equity, then GNU position key. Candidate identity is
`position:` followed by lowercase two-digit hex white/black counts for the
24 absolute points, bar, and borne-off counts. These identities never
authorize a gameplay move.

Each candidate supplies a complete absolute final board and canonical
from/to/hit segments. Segments deliberately have no die attribution.
Different legal recorded paths reaching one position share one candidate.
A forced pass has one unchanged candidate, no segments, zero loss, and both
`forced` and `noPlay` true. A single movable alternative is also forced.

## Additive wasm32 ABI

The separate analysis descriptor is 64 bytes. Its first eleven little-endian
words are version `0x00010000`, descriptor size 64, endianness marker
`0x01020304`, pointer width 4, request size 312, result size 64, candidate
size 152, segment size 20, legal-position ceiling 4096, alternatives ceiling
5, and returned-candidate ceiling 6. The remaining five words are zero.

New exports are `bgc_wasm_analysis_descriptor_size`,
`bgc_wasm_get_analysis_descriptor`, and `bgc_wasm_analyze_checker`. The
analysis call follows the existing caller-owned arena convention and checks
alignment, bounds, overflow, non-overlap, capacity, headers, and reserved
fields before native work. Native failures leave transactional zero outputs.
Decoding reacquires heap views after calls to support memory growth and
revalidates settings, boards, segments, finite equities, counts, rank/loss
consistency, played-board identity, and request correlation.

| Structure | Key byte offsets |
| --- | --- |
| Request, 312 bytes | header 0; position 8; played turn 128; expected board 232; profile 284; alternatives 288; candidate offset 292; capacity 296; reserved 300 |
| Candidate, 152 bytes | board 0; segment count 52; four 20-byte segments 56; equity 136; rank 140; tied flag 144; reserved 148 |
| Result, 64 bytes | header 0; count 8; played index 12; legal/evaluated counts 16/20; forced/no-play flags 24/28; loss 32; depth 36; cubeful/deterministic 40/44; noise 48; pruning 52; profile 56; reserved 60 |

## Provenance and lifecycle

Analysis is advertised only after descriptor validation and recognition of a
coherent content-addressed module/WASM/data URL set. Provenance records the
exact asset set and capsule build, GNUbg 1.08.003, authenticated weights hash,
Kazaross-XG2 table identity and hash, requested/effective profile, and actual
search settings. Bearoff is explicitly
`gnubg-heuristic-1.08.003-no-database`; no optional bearoff database is shipped.

The iframe controller capability-gates requests, permits one analysis
computation at a time, and checks results against the request and handshake
identity. Its watchdog runs outside the synchronous compute Worker.
Cancellation or deadline expiry terminates that Worker, suppresses late
responses, and initializes a fresh module for subsequent work. Recoverable
bad-turn or unsupported-profile errors retain the engine. Worker startup has
a separate 30-second budget; request time starts after readiness.

## Reference fixtures and verification

`tests/fixtures/gnubg-analysis-reference-v1.json` pins independent upstream
`GenerateMoves`/`ScoreMove` answers for money play, an asymmetric five-point
match with an owned cube, and a played move ranked eleventh. Its reference
tool constructs literal actor-relative boards and cube information without
the capsule analysis function or board mapper. Regeneration is explicit:

```bash
npm run build:gnubg-native
build/gnubg/native/gnubg-analysis-reference-dump third_party/gnubg/work/gnubg-1.08.003
```

Review numerical or asset changes before updating the fixture; normal test
runs never generate their own expected answers. Native tests pin the same
values and check both colors, absolute best boards, complete root counts,
alternate paths, forced pass, bar hits, doubles, terminal higher-die use, and
direct/arena parity. Native and real WASM regressions reject premature and
oversized recorded bearoffs in both colors, accept their legal reversed orders,
and require subsequent valid analysis on the same engine to succeed. Real
WASM tests also check output limits and error recovery. Chromium tests exercise
actual analysis through the opaque iframe,
existing gameplay, cancellation recreation, asset failure recovery, and the
downloadable corresponding-source package.

```bash
npm run verify
npm run test:gnubg-native:sanitized
npm run test:wasm-abi-layout:sanitized
# Activate the pinned Emscripten SDK for these commands.
npm run test:wasm-abi
npm run test:gnubg-wasm
npm run build:verification
npm run test:e2e
```

The Stage 0–1 boundary does not include archive extraction, a host queue,
review UI, summaries, or persistent results. Stage 2 adds that host decision
pipeline, and Stage 3 adds checker review and local results. Stage 4 adds cube
review. Stage 5 adds selected Deeper evaluation. Measured device performance remains Stage 6.
