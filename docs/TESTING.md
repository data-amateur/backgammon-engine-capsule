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

Preserve all mock tests. Before the WASM bridge ships, add remaining checker
higher-die/partial-turn and doubles fixtures, run the same native goldens against
wasm32, and add asset failures, Worker termination/recreation, and cold/warm
startup and decision measurements.
