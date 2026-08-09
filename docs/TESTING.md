# Testing

The unit suite covers bootstrap trust, origin configuration, BEP bounds and
validation, duplicate IDs, checker direction, metadata, deterministic legal
turn selection, legal cube selection, and disposal during Worker startup.

The Playwright suite is the security-boundary test: it builds and serves the
production artifact behind a genuinely cross-origin parent and real sandboxed
iframe. It asserts the private-port handshake, exact metadata, legal decisions,
cancellation suppression, one-time bootstrap, Blob Worker creation, response
headers, and absence of CSP console errors.

The checked-in verification environment delays mock Worker results by 100 ms.
This gives the cancellation test a genuinely pending request instead of making
its result depend on how the browser orders a zero-delay timer and a cancel
message. Development and production builds default to no artificial delay.

The current automated browser baseline is Chromium. Firefox and WebKit remain
a release gate before claiming broad browser support because opaque sandbox,
CORS, and Blob Worker behavior are the portability-sensitive boundary.

Before a mock release, also run the manual private-application test described
in the README. Verify a second game in the same match reuses the loaded capsule
and does not show another preload/fallback cycle.

The native GNUbg checkpoint covers authenticated clean rebuilds with recorded
patches, both-color board mapping, bar entry and hits, an illegal oversize
bear-off, candidate legality, money and match scoring, cube ownership,
Crawford/one-point metadata guards, the two-ply preset, cache reset, and
disposal. Typed cube goldens pin double/take, double/pass, no-double, too-good,
Jacoby, beaver and omitted-beaver fallback, arbitrary legal subsets and array
indices, owned redoubles, color reflection, post-Crawford response, and the
match/money cube ceilings. Native execution treats GLib criticals as fatal, and
a race fixture exercises the no-two-sided-database compatibility patch.

The authenticated match-equity generator strictly checks the original XML
hash, shape, values, and notice and emits deterministic binary32 data. Native
verification builds GNUbg's original parsed and new embedded paths separately,
then compares the complete 64-by-64 extended pre-Crawford table, both 64-entry
post-Crawford tables, and every cached gammon-price table byte for byte.

The always-on wasm32 ABI boundary suite compiles the public ABI with the host
C11 compiler. Static assertions pin every published size and offset; its
runtime descriptor checks versioning and output guards. Pure tests cover arena
alignment and size, overflow-safe byte and array ranges, overlap and adjacency,
empty-range sentinels, strict RFC 3629 UTF-8, and load/store/clear helpers. A
fake adapter exercises allocation, all five strengths, exact conversion,
composed validation, retryable structural rejection, terminal adapter-reaching
init/dispose, success, reset, and transactional checker/cube failures in
isolated processes. Hostile success responses with null, out-of-range,
mismatched, or non-finite output are rejected without committing partial
results.

The authenticated native goldens re-evaluate shared checker and cube fixtures
through the same borrowed-engine arena path and compare exact float bits,
selected indices, and representative negative status mappings. A separate
native process initializes the public wrapper with real assets and covers its
terminal lifecycle. ASan/UBSan variants cover both layers in dedicated CI.

With the external pinned Emscripten 6.0.5 SDK activated,
`npm run test:wasm-abi` builds and instantiates an ignored ABI-only module in
Node. `npm run test:gnubg-wasm` then authenticates and prepares the source,
builds the real linked evaluator, and exercises the same public ABI from
JavaScript. It checks recoverable invalid-weights and memory-pressure cache
initialization failures, consumed-module behavior, fresh-module recovery,
checker and double/take cube goldens, successful two-ply maximum-strength
scoring, cache reset, idempotent disposal, and transactional post-dispose
output. It also records artifact, gzip, memory,
and local timing diagnostics. The CI wasm
job installs the exact locked SDK and runs both commands.

Neither wasm command changes the active mock browser artifact. Before the real
engine ships, preserve all mock tests; add browser-level loading, CORS, asset
failure, cancellation, Worker termination/recreation, and stale-output tests;
cover remaining checker higher-die and partial-turn cases; measure cold and
warm startup and decision latency on representative devices; and set bounded
candidate/time policies for maximum strength.
