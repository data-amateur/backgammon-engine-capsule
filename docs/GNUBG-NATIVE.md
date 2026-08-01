# GNUbg native harness

This repository now has a deliberately narrow native checkpoint between the
authenticated GNUbg source and the future WebAssembly Worker. It proves board
translation, independent legal-turn validation, candidate scoring, typed cube
offer/response decisions, evaluator lifecycle, and source minimization without
exposing GNUbg's command parser.

The default browser capsule still runs the GPL-free mock. Nothing in this
native build is copied into `dist/` or served at port 4174.

## Build and test

From the repository root:

```bash
npm run test:gnubg-native
```

The command performs these steps as a clean build:

1. Rechecks the pinned archive's file hashes, detached signature, and exact
   signing-key fingerprint.
2. Replaces the ignored `third_party/gnubg/work/` directory with a fresh
   extraction of that authenticated archive.
3. Applies the ordered public GPL-side patches and records each path and
   SHA-256 hash in `prepared-source.json` and `build-info.json`.
4. Configures GNUbg without GTK, board3d, Python, SQLite, libcurl, SIMD, or
   multithreading.
5. Compiles only the evaluator-oriented native units and GNUbg's internal
   neural-network support library.
6. Links the GPL adapter and golden-test executable under
   `build/gnubg/native/`.
7. Runs the golden fixtures against `gnubg.weights` and
   `met/Kazaross-XG2.xml` from the authenticated extraction, with GLib
   criticals promoted to fatal errors.

Generated extraction and build directories are ignored by Git. They can be
deleted at any time and recreated by the command above.

Native prerequisites are a C11 compiler, GNU Make, `tar`, `patch`, `pkg-config`, and
the GLib 2.0 development package. For Debian or Ubuntu, the relevant packages
are normally provided by `build-essential`, `pkg-config`, and
`libglib2.0-dev`. The source authentication step also requires `gpgv`.

This build is repeatable from the authenticated source, but is not claimed to
be bit-for-bit reproducible: the compiler, effective flags, host, and system
GLib are not pinned yet. Each run records those ambient inputs and tool versions
in ignored `build/gnubg/native/build-info.json` so differences are visible.

## Deliberate link boundary

The top-level GNUbg units are:

```text
eval.c
positionid.c
matchequity.c
matchid.c
mtsupport.c
bearoffgammon.c
bearoff.c
mec.c
util.c
```

The build also links GNUbg's internal `lib/libevent.a`. Despite its upstream
name, this is not the system libevent networking library; it contains GNUbg's
neural-network, cache, random, digest, input, output, and list support.

The harness does not compile or expose `gnubg.c`, `play.c`, `set.c`,
`external.c`, the command grammar, desktop UI, rendering, audio, database,
Python, import/export, or networking features.

## Typed adapter boundary

`native/gnubg/gnubg_adapter.h` contains plain C structs and enums rather than
GNUbg internals. The current checkpoint supports:

- one process-scoped engine initialization;
- absolute BEP-style board, match, rule, cube, and dice input;
- standard backgammon only, with other variation values rejected;
- one to 4,096 caller-supplied candidate turns;
- five strength names, with `maximum` currently mapped to GNUbg's two-ply
  world-class preset as the initial strength ceiling;
- a score for every candidate, choosing by cubeful score, then cubeless
  score, then input order;
- cache reset and final disposal;
- diagnostic GNU Position IDs for mapping fixtures;
- explicit cube state and offerer metadata;
- any nonempty, duplicate-free supplied subset of the offer family
  (`double`, `no-double`, `too-good`) or response family (`take`, `pass`,
  `beaver`);
- a selected index back into that exact supplied action array, plus whether
  GNUbg evaluation ran and its normalized branch equities.

GNUbg's evaluator uses process-global state and cannot safely initialize again
after `EvalShutdown()`. The browser runtime must therefore treat one compute
Worker as one engine lifetime. Disposal or a fatal evaluation error is handled
by terminating that Worker and creating a new one.

## Board and turn safety

BEP point numbers are absolute: white moves from 23 toward 0 and black moves
from 0 toward 23. GNUbg's `TanBoard` is current-player-relative: row 1 is the
player on roll, both rows move from index 24 toward bear-off, and index 24 is
the bar.

The adapter maps points as follows:

```text
white absolute point p -> GNU index p
black absolute point p -> GNU index 23 - p
player on roll          -> TanBoard row 1
other player            -> TanBoard row 0
```

White and black remain fixed identities for match score, cube ownership, and
GNUbg's `cubeinfo.fMove`; only the board rows are current-player-relative.

The adapter does not trust `ApplySubMove` by itself because that function does
not enforce every full-turn rule. It:

1. asks GNUbg to generate the complete legal move set for the supplied dice;
2. replays every caller-supplied step on a fresh board while checking dice,
   direction, bar priority, occupancy, blocks, and hit flags;
3. hashes the resulting board into a GNUbg `PositionKey`;
4. requires that key to match GNUbg's generated legal set, which also enforces
   maximum-dice use, the higher-die rule, and legal oversize bear-off;
5. passes the matched key to `ScoreMove`, which handles the post-turn side
   swap, perspective inversion, and cubeful/match equity.

The authoritative game server must still accept only a server-issued opaque
turn ID. This native legality gate is defense in depth, not a replacement for
server authority.

## Cube decision safety

Cube requests use empty dice and keep the board and `cubeinfo.fMove` oriented
to the offerer/player on roll, including while the opponent responds. The
pre-offer cube value and owner remain unchanged in a pending-offer position.
The adapter validates phase, cube state, offerer, engine player, rule, and action
family before calling GNUbg.

GNUbg's semantic recommendation wins when that exact token is supplied.
Optional doubles deterministically map to `no-double`. If the recommended token
is absent, the adapter ranks only the host-supplied alternatives. An offerer
maximizes its equity; a responder minimizes the offerer's equity, using
`take = DT`, `pass = DP`, and GNUbg's beaver approximation `beaver = 2 * DT`.
`too-good` shares the play-on equity with `no-double`. A singleton legal list is
returned without evaluation once state and safety bounds have passed.

All analysis equities retain GNUbg's offerer perspective. The selected-action
equity is the outcome associated with the returned legal token; the separately
named pre-offer optimum is GNUbg's unrestricted cube recommendation and can
differ when the host supplies a subset. Both fields are meaningful only when
`evaluated` is true.

Unavailable/dead offers short-circuit to a supplied play-on token. A pending
post-Crawford leader offer is still evaluated so the responder can handle a
server-authorized offer, while Crawford and one-point pending offers are
rejected. Because `GeneralCubeDecisionE` doubles internally, a pending match
cube at 64 and money cube at 4,096 are rejected before evaluation. Beavers are
enabled only in money play through a pre-offer cube of 1,024, which caps the
beaver result at GNUbg's 4,096 maximum.

## Golden coverage

The executable currently checks:

- the standard starting Position ID;
- asymmetric white-on-roll and black-on-roll mappings;
- a complete legal bar entry that hits while the other die is blocked;
- rejection of an illegal oversize bear-off candidate;
- rejection of malformed hit flags, rule flags, variation, automatic-double
  count, Position ID/score output capacities, and cube bounds;
- rejection of a score that has already reached the match length, invalid
  Crawford cube state, and invalid one-point-match cube state;
- deterministic expert scoring of two opening candidates;
- multi-candidate scoring at the two-ply `maximum` preset;
- equal money and match scores for color-reflected positions, including cube
  ownership;
- pinned double/take, double/pass, no-double, too-good, Jacoby, and beaver
  decisions and equities;
- arbitrary reordered/subset action arrays, exact returned indices, singleton
  shortcuts, beaver omission fallback, and the 1,024/2,048 beaver boundary;
- centered offers, owned redoubles, color-reflected cube decisions,
  post-Crawford response, malformed cube metadata, and match/money cube safety
  ceilings;
- a race position that exercises the no-two-sided-database compatibility patch
  while GLib criticals are fatal;
- evaluator cache reset and clean shutdown.

## Known limitations before WASM

- The harness loads the 1,097,796-byte text network. A later pinned conversion
  step should generate and authenticate GNUbg's approximately 408 KB binary
  `gnubg.wd`.
- Optional exact bearoff database files are not bundled. The adapter initializes
  GNUbg's built-in one-sided heuristic context. A checked-in GPL-side patch
  makes the race backgammon correction fall back to that heuristic when the
  optional two-sided context is absent; results are deterministic but are not
  exact-database bearoff results.
- Match evaluation is rejected above length 64 or cube value 64 because of
  GNUbg's fixed match-equity table dimensions.
- Raccoon policy is rejected because GNUbg's `cubeinfo` cannot represent it.
- The initial native build uses system GLib. Emscripten does not provide GLib;
  the WASM phase needs a pinned GLib cross-build or a public GPL-side patch or
  compatibility layer that removes the required GLib surface.
- Upstream's initial evaluation caches use roughly 33 MB and its thread-local
  move storage roughly another 4 MB. The WASM build should reduce those
  allocations before initialization rather than shrinking them afterward.
- `maximum` evaluates every supplied candidate at two plies. The native API
  allows the BEP ceiling of 4,096 candidates and currently has no time, node,
  or cancellation budget, so that combination is not browser-safe yet. The
  Worker bridge must impose measured limits and use Worker termination for
  hard cancellation before exposing this preset.
- Invalid upstream weight data can terminate the process because
  `EvalInitialise()` does not return an error. The authenticated assets avoid
  that in this checkpoint; the WASM adapter should add an explicit GPL-side
  failure path.

The adapter and executable link GNUbg and are licensed
`GPL-3.0-or-later`. They, all future patches, build scripts, runtime assets,
WASM, and exact corresponding source remain in this public capsule project.
