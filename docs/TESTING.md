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

The current automated browser baseline is Chromium. Firefox and WebKit remain
a release gate before claiming broad browser support because opaque sandbox,
CORS, and Blob Worker behavior are the portability-sensitive boundary.

Before a mock release, also run the manual private-application test described
in the README. Verify a second game in the same match reuses the loaded capsule
and does not show another preload/fallback cycle.

When GNUbg is added, preserve all mock tests and add native-versus-WASM golden
positions, both colors, bar entry, hits, bearing off, doubles, cube ownership,
money/match/Crawford contexts, asset failures, Worker termination/recreation,
and cold/warm startup measurements.
