# Cube analysis, schema 1

Stage 4 adds `analyze-cube` beside `analyze-checker` in the optional BEP v1
analysis capability. Both use `quick-0ply-v1`: cubeful, deterministic, depth 0,
no pruning, and zero noise. The pinned GNUbg expert evaluation context supplies
these exact settings. Gameplay methods and the native/wasm32 ABI remain unchanged.

[Stage 5](DEEPER-ANALYSIS.md) also advertises `deep-2ply-v1`: the same pre-offer context and branches at deterministic cubeful depth 2, with zero noise and internal pruning enabled.

## Request context

Send the committed position **before the offer**, with phase `before-roll`, no
dice, and the original cube value and owner. `playerOnRoll` is the offerer.
For role `offer`, actor is the offerer and the recorded action is `no-double`
or `double`. For role `response`, actor is the opponent and the recorded action
is `take` or `pass`. The proposed cube value is twice the reference value;
passing surrenders the reference value.

Only standard rules are supported. Crawford, one-point matches, terminal
positions and opponent-owned cubes are rejected. Unsupported profiles, rules,
match lengths and cube limits return explicit errors. A native result with
`evaluated=false` returns `unsupported`; its placeholder zero equities are
never exposed as completed analysis. Such a rejection leaves the engine usable.

## Equities and loss

The existing native cube result contains GNUbg's `FindCubeDecision` equities:
N (no double), T (double/take) and P (double/pass), all from the **offerer's
perspective**, normalized to the same pre-offer cube. The pinned evaluator
handles match-equity conversion. No host match-equity table is introduced.

The offerer maximizes equity and the responder minimizes it:

- Value of offering: `min(T, P)`.
- Best offer equity: `max(N, min(T, P))`.
- Offer loss: best offer equity minus recorded N or `min(T, P)`.
- Response loss: recorded T or P minus `min(T, P)`.

The result includes role, actor, `equityPerspective`, `referenceCube`, both
available actions, preferred action, raw N/T/P, recorded branch equity, loss,
elapsed time and the same complete Quick provenance as checker analysis.
Optional `tooGood` preserves GNUbg's verified semantic recommendation for
an offer decision; it is not inferred merely from a no-double action.

Both protocol implementations validate finite numbers, available actions,
recommendations, too-good consistency and request correlation. Loss and
recorded equity must agree with the raw branches within 0.00001. Equities are
not limited to money-play ranges and are not percentages.

## ABI compatibility and lifecycle

The Worker reuses `bgc_wasm_decide_cube` and the frozen 64-byte cube result:
evaluated flag at byte 16 and N/T/P at bytes 32/36/40. It supplies all relevant
actions and the exact expert context instead of a gameplay strength chosen
by the host. It retains buffer/header/reserved-field and finite-value checks.
No layout, export or arena descriptor changes are needed.

The controller capability-gates and correlates cube analysis like checker
analysis. Both use the existing serial compute Worker, cancellation and
watchdog. Hosts must complete a fresh handshake after a timeout before
starting the next computation deadline. Legacy checker-only capsules remain
usable for checker requests; callers gate cube requests on the advertised method.

## Independent references

`tests/fixtures/gnubg-cube-analysis-reference-v1.json` records explicit upstream
`PositionFromID`, `SetCubeInfo`, `GeneralCubeDecisionE` and `FindCubeDecision`
calls, without the capsule board mapper or analysis implementation. Regenerate
only deliberately and review changed numbers:

```bash
npm run build:gnubg-native
build/gnubg/native/gnubg-analysis-reference-dump third_party/gnubg/work/gnubg-1.08.003 --cube
```

The references include money double/take, double/pass, no-double and too-good;
an owned redouble; asymmetric five-point and seven-point match contexts;
post-Crawford leader/trailer; Crawford; and double match point. Normal tests
never regenerate their expected answers. Native golden tests check mirrored
colors, response minimization, too-good semantics and arena parity. Real-WASM
tests check both colors, both roles, all four recorded actions, raw equities,
losses, reference cubes, unsupported cases and recovery. Browser tests exercise
the opaque iframe and the host's mixed checker/cube queue, review and caching.

```bash
npm run verify
npm run test:gnubg-native:sanitized
npm run test:wasm-abi-layout:sanitized
# Activate the pinned Emscripten SDK for the following commands.
npm run test:wasm-abi
npm run test:gnubg-wasm
npm run test:e2e
```

Selected-decision Deeper is Stage 5; measured device performance remains Stage 6. Cube counts and losses do not define a standardized average cube error
or combined performance rating.
