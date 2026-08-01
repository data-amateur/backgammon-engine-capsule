# Testing

The unit suite covers bootstrap trust, origin configuration, BEP bounds and
validation, duplicate IDs, checker direction, metadata, deterministic legal
turn selection, legal cube selection, and disposal during Worker startup.

The Playwright suite is the security-boundary test: it builds and serves the
production artifact behind a genuinely cross-origin parent and real sandboxed
iframe. It asserts the private-port
handshake, exact metadata, legal decisions, cancellation suppression, one-time
bootstrap, Blob Worker creation, response headers, and absence of CSP console
errors.

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

The native GNUbg checkpoint now covers authenticated clean rebuilds with
recorded patches, both-color board mapping, bar entry and hits, an illegal
oversize bear-off, candidate legality, money and match scoring, cube ownership,
Crawford/one-point metadata guards, the two-ply preset, cache reset, and
disposal. Typed cube goldens pin double/take, double/pass, no-double, too-good,
Jacoby, beaver and omitted-beaver fallback, arbitrary legal subsets and array
indices, owned redoubles, color reflection, post-Crawford response, and the
match/money cube ceilings. Native execution treats GLib criticals as fatal, and
a race fixture exercises the no-two-sided-database compatibility patch.

The always-on wasm32 ABI boundary suite compiles the public ABI with the host
C11 compiler. Static assertions pin every published size and offset; its
runtime descriptor checks versioning and output guards. Pure tests cover arena
alignment/size, overflow-safe byte and array ranges, overlap and adjacency,
empty-range sentinels, strict RFC 3629 UTF-8, and load/store/clear helpers. A
fake adapter then exercises allocation, all five strengths, exact conversion,
composed header/range/enum validation, retryable structural init rejection,
terminal adapter-reaching init/dispose, success, reset, and transactional
checker/cube failures in isolated processes. Hostile adapters that report
success with null, out-of-range, mismatched, or non-finite output are also
rejected without committing partial results. The authenticated
native goldens re-evaluate shared checker and cube fixtures through the same
borrowed-engine arena path and compare exact float bits, selected indices, and
representative negative status mappings with transactional outputs. A separate
process initializes the public wrapper with real assets and covers its terminal
lifecycle. ASan/UBSan variants cover both layers and run in a dedicated CI job.
With the external Emscripten 6.0.5 SDK activated,
`npm run test:wasm-abi` builds an ignored ABI-only module and instantiates it in
Node, confirming wasm32 pointer width, little-endian reads, and the same layout.
A separate CI job installs the exact locked SDK and runs the real wasm32 smoke
test. Neither test links the GNUbg evaluator or changes the mock browser
artifact.

Preserve all mock tests. Before the real engine ships, add remaining checker
higher-die/partial-turn and doubles fixtures, run the same native goldens against
the fully linked wasm32 module, and add asset failures, Worker
termination/recreation, and cold/warm startup and decision measurements.
