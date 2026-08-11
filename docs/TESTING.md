# Testing

The test matrix covers the protocol boundary, deterministic source packaging,
native GNUbg adapter, wasm32 ABI, linked WebAssembly evaluator, distribution,
and the real browser integration.

## TypeScript and unit tests

`npm run verify` authenticates GNUbg source, checks deterministic
match-equity generation and source-bundle behavior, runs TypeScript and lint,
executes the unit suite, exercises every frozen ABI layout/range rule, and runs
the native GNUbg goldens.

The unit suite covers bootstrap trust, origin configuration, BEP bounds and
validation, duplicate IDs, checker direction, metadata, Worker startup,
request/result correlation, legal ranking/action enforcement, cancellation,
hard timeout termination, runtime recreation, search policy, match length 64,
match cube 64, money cube 4,096, partial `completed: false` results, and
disposal.

The source-bundle test creates the deterministic archive twice, requires
byte-identical output for the same snapshot, verifies the embedded per-file
manifest and current-tree binding, rejects tampered data, accepts an explicit
`BGC_GNU_TAR` executable with an empty `PATH`, enforces GNU tar 1.28 or newer,
and rejects a non-GNU override. Production-mode verification additionally
rejects a dirty Git working tree.

## Native and WebAssembly tests

The native GNUbg suite performs authenticated clean rebuilds with recorded
patches. It covers both-color board mapping, bar entry and hits, illegal
oversize bear-off, GNUbg legal-set matching, money and match scoring, cube
ownership, Crawford and one-point guards, the two-ply preset, cache reset, and
disposal. Cube goldens pin double/take, double/pass, no-double, too-good,
Jacoby, beaver and omitted-beaver fallback, arbitrary legal subsets and exact
indices, owned redoubles, color reflection, post-Crawford response, and
match/money cube ceilings.

The authenticated match-equity generator checks the original XML hash, shape,
values, and notice and emits deterministic binary32 data. Native verification
compares the complete 64-by-64 extended pre-Crawford table, both 64-entry
post-Crawford tables, and every cached gammon-price table byte for byte between
the original parsed path and embedded path.

The always-on wasm32 ABI suite compiles the public boundary with the host C11
compiler. Static assertions pin every size and offset. Pure tests cover arena
alignment, overflow-safe ranges, overlap and adjacency, empty sentinels,
strict UTF-8, and load/store/clear helpers. A fake adapter covers all five
strengths, conversion, retryable structural rejection, terminal lifecycle,
reset, and transactional checker/cube failures. Hostile success responses
with invalid pointers, counts, indices, or non-finite output are rejected.

With the pinned Emscripten 6.0.5 SDK activated,
`npm run test:gnubg-wasm` first generates and verifies the source archive,
then builds the real evaluator and exercises ABI 1.0 from Node. It checks
recoverable invalid weights and memory-pressure cache allocation, consumed
module behavior, fresh-module recovery, exact checker and double/take cube
goldens, successful two-ply maximum scoring, cache reset, idempotent disposal,
and transactional post-dispose output. Local size, gzip, memory, and timing
diagnostics are regression signals rather than representative browser
benchmarks.

ASan/UBSan variants are available for both C boundary layers:

```bash
npm run test:wasm-abi-layout:sanitized
npm run test:gnubg-native:sanitized
```

## Chromium browser suite

`npm run test:e2e` uses Playwright's Chromium project. Its configuration
first runs `npm run build:verification`, then serves a private test host at
`http://localhost:3100` and the capsule at
`http://localhost:4174`. The iframe is genuinely cross-origin and opaque.

The complete current suite has three tests:

1. **Real GNUbg over BEP v1.** Exact shared checker and cube fixtures put the
   correct GNUbg choice after another legal option, so a first-legal mock
   cannot pass. The test also checks rankings, BEP metadata, one-time
   bootstrap, cancellation with no stale result, fresh Blob Worker creation,
   opaque sandboxing, credentialless loading, and absence of console errors.
2. **Real WASM asset failure and recovery.** Every `.wasm` request from the
   first module generation receives a 404. The request must fail with a
   retryable `asset-load-failed` error, and a newly created Worker/module
   must then load and answer successfully.
3. **Restrictive capsule headers.** The entry page, root Worker, robots file,
   CSP, frame ancestors, noindex policy, CORS/CORP, cache policy, and absence
   of unrestricted `unsafe-eval` are verified.

The first test also inspects every content-versioned `.mjs`, `.wasm`, and
`.data` request for immutable caching, CORS/CORP, and MIME behavior. It
asserts that normal runtime loading never requests the corresponding-source
URL. The test then downloads that archive separately and verifies:

- the exact
  `/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz`
  path;
- immutable cache and public CORS/CORP headers;
- gzip signature and SHA-256 matching the URL; and
- a no-cache `SOURCE.txt` containing the same URL and hash.

Distribution verification separately extracts the source archive and checks
its embedded manifest, engine `build-info.json` binding, browser manifest
binding, source-tree identity, required notices, allowlisted files, GPL Worker
banner, WebAssembly magic, asset hashes, private-path absence, and generated
host headers.

## Recommended commands

Without Emscripten:

```bash
npm run verify
```

With the pinned Emscripten SDK active:

```bash
npm run test:gnubg-wasm
npm run build:verification
npm run test:e2e
```

The explicit `build:verification` is useful for inspecting `dist/`;
`test:e2e` also invokes it automatically.

## Remaining test gates

Chromium is the current automated browser baseline. Before broad production
support, run equivalent suites in Firefox and WebKit, benchmark cold and warm
startup and decisions on representative slower devices, exercise an exact
clean-tree production build on the chosen host, and manually test the private
application across multiple games, timeout/cancellation, external failure, and
built-in fallback.
