# GNUbg/WASM roadmap

The real GNU Backgammon 1.08.003 WebAssembly engine is now connected to the
capsule Worker and exercised end to end in Chromium. The old deterministic
mock is no longer shipped.

## Implemented

1. The capsule lives in an independent public repository, separate from the
   proprietary host application.
2. The exact GNUbg 1.08.003 release archive, detached signature, release key,
   signer fingerprint, per-file hashes, license, and ordered public patches
   are preserved and authenticated.
3. A minimal native headless adapter and golden suite cover board mapping,
   independent legal-turn verification, optional `resultingBoard`
   comparison, five strengths, checker scores, cube offer/response decisions,
   cache reset, and lifecycle.
4. ABI 1.0 freezes fixed-width arena layouts and validates all ranges, UTF-8,
   reserved fields, transactional results, and the one-module lifecycle.
5. The single-threaded Emscripten 6.0.5 build excludes desktop, command,
   Python, audio, networking, database, GLib, and generic XML surfaces. It
   requires neither pthreads nor `SharedArrayBuffer`.
6. The real Worker loader uses absolute content-versioned module, WASM, and
   data URLs, validates the ABI descriptor, and refreshes views after memory
   growth.
7. Cancellation, timeout, asset failure, fatal failure, and stale-output
   handling terminate or recreate the Worker/module at the correct boundary.
8. Browser-facing search policy enforces hard `timeMs` deadlines, rejects
   unsupported node or insufficient memory limits, bounds maximum two-ply
   checker search to eight candidates with at least 500 ms and depth two, and
   reports bounded zero-ply fallback as `completed: false`.
9. BEP and native integration enforce standard backgammon, match length and
   match cube value at most 64, and money cube value at most 4,096.
10. The Chromium suite runs exact GNUbg checker/cube goldens in an opaque
    cross-origin sandbox and covers ranking, cancellation recreation, real
    WASM asset failure/retry, one-time bootstrap, CSP, CORS/CORP, immutable
    caching, MIME types, and console errors.
11. Every browser build generates and verifies deterministic complete
    corresponding source before building WASM. The archive is published at
    `/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz`
    and bound into `build-info.json`, the browser manifest, and
    `SOURCE.txt`. Production requires a clean tree. Runtime advertises but
    never downloads this archive, so the normal engine payload remains about
    1.37 MB uncompressed.

## Remaining engineering and release gates

- Add any remaining higher-die, partial-turn, and unusual bear-off fixtures
  found during cross-implementation testing.
- Publish cold/warm transfer, initialization, memory, checker, and cube
  measurements on representative desktop and slower mobile-class devices.
- Run manual integration with the proprietary host across multiple games in
  one match, explicit cancellation and timeout, capsule failure, and built-in
  fallback.
- Run the complete browser suite in Firefox and WebKit before claiming broad
  browser support.
- Exercise an exact clean-tree production build, deploy its immutable engine
  and source paths, and independently verify production CSP, CORS/CORP, cache,
  MIME, and source-archive availability.
- Obtain qualified legal review of the repository split, notices, source
  offer/distribution, hosting retention, and release procedure.

The iframe/Worker split is a technical isolation and maintenance boundary, not
a GPL exception. Free access and browser-local execution do not remove source
distribution obligations. The source archive is therefore a first-class
release artifact even though the browser does not fetch it during normal play.
