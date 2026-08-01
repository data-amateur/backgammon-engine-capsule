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

The native GNUbg checkpoint now covers authenticated clean rebuilds, both-color
board mapping, bar entry and hits, an illegal oversize bear-off, candidate
legality, money and match scoring, cube ownership, Crawford/one-point metadata
guards, the two-ply preset, cache reset, and disposal. Preserve all mock tests.
Before the WASM bridge, add exact bear-off, higher-die/partial-turn, doubles,
Jacoby, post-Crawford, and typed cube-decision fixtures. Then run the same
golden positions against native and WASM and add asset failures, Worker
termination/recreation, and cold/warm startup measurements.
