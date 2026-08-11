# GNUbg WebAssembly integration

The active browser capsule runs GNU Backgammon 1.08.003 compiled to wasm32
behind a frozen arena ABI. The old deterministic mock remains only as
non-shipped test/reference code.

## Frozen ABI 1.0

`native/gnubg/gnubg_wasm_abi.h` defines a separate JavaScript/native
boundary because native pointers, `size_t`, and C enum layouts are not
stable browser contracts.

The boundary uses fixed-width integers and 32-bit floats. Checker candidates
contain four inline steps. Pointer-like fields are 32-bit byte offsets relative
to one caller-owned arena. ABI 1.0 fixes alignment, non-overlap, overflow
checking, and strict UTF-8 path semantics. Every top-level request and result
starts with an ABI version and byte size, all reserved fields must be zero, and
the runtime descriptor publishes every structure size and offset.

The linked module exports:

- `bgc_wasm_abi_version`, `bgc_wasm_abi_descriptor_size`, and
  `bgc_wasm_get_abi_descriptor`;
- bounded allocation through `bgc_wasm_alloc` and `bgc_wasm_free`; and
- `bgc_wasm_init`, `bgc_wasm_choose_turn`, `bgc_wasm_decide_cube`,
  `bgc_wasm_reset`, and `bgc_wasm_dispose`.

The caller provides one four-byte-aligned arena of at most 512 KiB. Typed
ranges are checked for bounds, overflow, alignment, and overlap. Wire values
are copied into native structs field by field, and outputs are committed only
after a complete successful adapter call. Result indices, score counts, and
finite equities are revalidated in TypeScript.

The wrapper owns one module-scoped engine with a terminal lifecycle. A
wire-validation failure before the adapter is retryable. Once initialization
reaches GNUbg, success or failure consumes that module instance. Dispose is
idempotent and terminal; calls are serial and non-reentrant.

## Evaluator build

`scripts/build-gnubg-wasm.mjs` first verifies the exact generated
corresponding-source bundle, authenticates and freshly prepares the locked
GNUbg source, tests and runs the deterministic match-equity generator,
compiles the selected evaluator and capsule boundary sources, and links a
single-threaded modularized Emscripten module. It rejects unexpected desktop,
generic GLib parser, GNUbg list, and match-equity calculator symbols before
linking.

Source packaging resolves `gtar` and then `tar` from `PATH`, requires GNU tar
1.28 or newer because the archive build uses reproducible name sorting, and
uses that same absolute executable for archive creation, listing, and
extraction. Set
`BGC_GNU_TAR` to an absolute GNU tar path on systems where those command names
resolve to BSD tar or are unavailable.

The WebAssembly build excludes GLib. The narrow compatibility surface under
`native/gnubg/wasm-compat/` and
`native/gnubg/gnubg_wasm_runtime.c` supplies only the allocation, file,
logging, and process-global helpers needed by the selected headless evaluator.
The GNUbg command parser, desktop UI, GTK, audio, Python, networking, database
features, generic XML parser, and optional bearoff databases are not linked.

Patch 0003 embeds the authenticated Kazaross-XG2 match-equity table from exact
IEEE-754 binary32 bit patterns generated from the upstream XML. The generator
pins the XML SHA-256, validates its 25-point shape and notice, and native tests
compare the complete extended 64-by-64 pre-Crawford table, both 64-entry
post-Crawford tables, and all cached gammon-price tables byte for byte between
the parsed and embedded paths.

The ABI still requires readable paths for `gnubg.weights` and
`met/Kazaross-XG2.xml`, so both are preloaded into
`gnubg-wasm.data`. Evaluation uses the compiled match-equity data; the XML
is retained as the temporary readable path input.

The module uses 65,536 evaluator-cache entries, 8,192 pruning-cache entries, a
32-MiB initial memory, a 128-MiB maximum, and a 1-MiB stack. Memory growth is
enabled. Checked initialization resource failures are recoverable, while a
Worker that fatally traps or exhausts memory is terminated and recreated.
Pthreads and `SharedArrayBuffer` are not required.

## Browser loader and lifecycle

The iframe fetches `gnubg-engine.worker.js` without credentials and starts
it from a Blob URL. The Worker dynamically imports one explicit absolute
content-versioned `gnubg-wasm.mjs` URL. The Emscripten factory receives
explicit absolute `.wasm` and `.data` URLs; none is resolved relative to
the Blob.

Before reporting ready, the Worker validates the full ABI descriptor,
allocates the arena, and initializes the authenticated assets. Because
Emscripten memory can grow, the marshaller obtains a fresh heap view after
every native call.

Synchronous GNUbg evaluation cannot be interrupted through ABI 1.0. A BEP
cancel or request timeout therefore terminates the compute Worker, suppresses
late output, and makes the next request initialize a fresh Worker/module. A
real asset-load failure is retryable through the same boundary. The module is
retained across games in one match when no cancellation or fatal failure
occurs.

## Search and game bounds

BEP limits are enforced before native marshalling:

- `timeMs` is a hard decision deadline after Worker readiness. On expiry,
  the controller terminates the Worker and returns a retryable timeout.
- `maxNodes` is rejected as unsupported because this adapter has no native
  node counter.
- A supplied `memoryMb` below 128 is rejected because the module may grow
  to its fixed 128-MiB ceiling.
- `candidateLimit` caps returned rankings only. Every legal turn supplied
  by the host is still evaluated and eligible to win.
- Maximum-strength checker play uses GNUbg's two-ply preset only with eight
  or fewer legal candidates, `timeMs` absent or at least 500, and
  `maxDepth` absent or at least two. Otherwise it uses expert zero-ply and
  reports `completed: false`.
- Maximum-strength cube play uses two plies when the time and depth bounds
  allow it.

Only standard backgammon is supported. Match length and match cube value are
limited to 64 by GNUbg's match-equity table; the general money-play cube
ceiling is 4,096. Raccoons are rejected because GNUbg's cube model cannot
represent them.

## Corresponding-source build

`npm run build:source` creates a deterministic gzip-compressed POSIX tar
archive from the complete current source snapshot. Files are sorted, stored
with normalized owner, group, mode, and timestamp metadata, and recorded in an
embedded `SOURCE-MANIFEST.json` with per-file sizes and SHA-256 hashes.
Archive verification rejects unsafe paths, links, special files, missing or
extra entries, hash mismatches, and differences from the source tree.

The normal build order is:

```text
build and verify source archive
  -> build GNUbg WASM and bind source identity into build-info.json
  -> stage engine and source assets and bind both in browser manifest
  -> build Worker with the generated source URL
  -> build and verify dist, SOURCE.txt, hashes, and headers
```

The source archive is published at:

```text
/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz
```

`build-info.json`, the browser asset manifest, and `SOURCE.txt` bind the
archive SHA-256, embedded manifest SHA-256, repository commit, source-tree
SHA-256, clean-state flag, and file count to the engine build. A production
source bundle and production distribution require a clean Git working tree;
development and verification builds may describe a dirty snapshot so local
changes can be tested honestly.

The BEP metadata advertises the immutable source URL, but neither the iframe
nor Worker fetches the archive at runtime. It is a separate compliance
artifact and is not included in the ordinary engine transfer.

## Pinned toolchain

`toolchains/emscripten-lock.json` pins Emscripten 6.0.5, the matching emsdk
tag commit, release commit, and immutable binary-build commit. Do not use
`latest`, `main`, or `tot` for a release build. Keep the SDK outside
this repository:

```bash
git clone --branch 6.0.5 --depth 1 \
  https://github.com/emscripten-core/emsdk.git \
  ../toolchains/emsdk-6.0.5

emsdk_checkout_commit="$(git -C ../toolchains/emsdk-6.0.5 rev-parse HEAD)"
if [ "${emsdk_checkout_commit}" != "dfb9d1a46c3bb8f52e1e6324be23123b9d73c190" ]; then
  echo "Unexpected emsdk commit: ${emsdk_checkout_commit}" >&2
  exit 1
fi

../toolchains/emsdk-6.0.5/emsdk install 6.0.5
../toolchains/emsdk-6.0.5/emsdk activate 6.0.5
source ../toolchains/emsdk-6.0.5/emsdk_env.sh
```

The build verifies the emsdk Git commit, installed-package marker,
`emcc --version`, release commit, and wasm32 target. The SDK is not
downloaded by `npm ci`, bundled for users, installed system-wide, or
committed to Git.

## Build and test

The host ABI, match-equity generator, and native evaluator tests do not need
Emscripten:

```bash
npm run test:wasm-abi-layout
npm run test:gnubg-met-generator
npm run test:gnubg-native
```

Safety-sensitive C layers also have ASan/UBSan variants:

```bash
npm run test:wasm-abi-layout:sanitized
npm run test:gnubg-native:sanitized
```

With the pinned SDK active:

```bash
npm run test:wasm-abi
npm run test:gnubg-wasm
npm run build:verification
npm run test:e2e
```

`test:gnubg-wasm` creates and verifies the corresponding-source archive
before building the linked evaluator. Its Node test covers the frozen
descriptor, recoverable invalid-weight and memory-pressure failures,
fresh-module recovery, checker and double/take cube goldens, successful
two-ply scoring, cache reset, idempotent disposal, and transactional terminal
output.

The three ordinary engine delivery files total approximately 1.37 MB
uncompressed: about 93 KB of module JavaScript, 161 KB of WebAssembly, and
1.11 MB of preloaded data. Their summed level-9 gzip estimate is approximately
598 KB. Exact per-build sizes and hashes are recorded in `build-info.json`
and the browser manifest. The source archive, Worker, notices, and license
files are separate and are not included in that three-file number.

The Chromium suite runs the real module in an opaque, cross-origin iframe and
covers exact checker/cube decisions, ranking, cancellation recreation, real
WASM 404 recovery, security and caching headers, immutable engine assets, and
the separately downloadable corresponding-source archive.

## Remaining release gates

Before claiming a production-ready public release:

- benchmark cold and warm download, startup, memory, checker, and cube
  behavior on representative slower devices;
- run the complete private-host integration across multiple games, timeout,
  cancellation, external failure, and built-in fallback;
- run Firefox and WebKit portability testing for opaque sandbox, Blob Worker,
  dynamic module import, CORS, and WebAssembly behavior;
- verify the chosen production host serves equivalent CSP, CORS/CORP, cache,
  and MIME headers and keeps the immutable source URL available; and
- obtain qualified GPL/compliance review.
