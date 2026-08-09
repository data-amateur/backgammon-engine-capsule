# GNUbg WebAssembly checkpoint

This checkpoint builds and tests a real GNU Backgammon 1.08.003 evaluator for
wasm32 behind the frozen arena ABI. It still does **not** change the capsule's
active GPL-free mock Worker, and the generated GNUbg files are not copied into
`public/` or `dist/`.

## What is frozen

`native/gnubg/gnubg_wasm_abi.h` defines ABI version 1.0. It is deliberately a
separate layer from the native adapter because native pointers, `size_t`, and C
enum layouts are not stable JavaScript contracts.

The boundary uses only fixed-width integers and 32-bit floats. Checker
candidates contain four inline steps. Pointer-like fields are 32-bit byte
offsets relative to one caller-owned arena. ABI 1.0 also fixes alignment,
pairwise non-overlap, overflow checking, and required UTF-8 path semantics.
Every top-level request and result starts with an ABI version and byte size, and
every reserved field must be zero. The runtime descriptor lets JavaScript
reject an unexpected layout at startup instead of silently reading the wrong
bytes.

The linked module exports:

- `bgc_wasm_abi_version`, `bgc_wasm_abi_descriptor_size`, and
  `bgc_wasm_get_abi_descriptor`;
- bounded zeroed allocation through `bgc_wasm_alloc` and `bgc_wasm_free`;
- `bgc_wasm_init`, `bgc_wasm_choose_turn`, `bgc_wasm_decide_cube`,
  `bgc_wasm_reset`, and `bgc_wasm_dispose`.

The wrapper owns one module-scoped engine and has a terminal lifecycle. A
wire-validation failure before the adapter call is retryable; once init reaches
GNUbg, success or failure consumes that module instance. Dispose is idempotent
and terminal. Calls are serial and non-reentrant, and no arena pointer is
retained. In the browser, a failed or cancelled engine must therefore be
recovered by terminating its compute Worker and creating a fresh Worker/module.

The caller provides one four-byte-aligned, at-most-512-KiB arena. Every typed
range is bounds-, overflow-, alignment-, and overlap-checked before use. Paths
receive strict RFC 3629 UTF-8 validation. Wire values are copied into native
structs field by field; native pointers and enum representations never cross
the boundary. Results, score capacity, and the 256-byte error buffer are
cleared before evaluation, and adapter outputs are committed only after full
validation.

## Real evaluator build

`scripts/build-gnubg-wasm.mjs` authenticates and freshly prepares the locked
GNUbg source, tests and runs the deterministic match-equity generator, compiles
only the selected evaluator and capsule boundary sources, and links a
single-threaded modularized Emscripten module. It rejects unexpected desktop,
generic GLib parser, GNUbg list, and match-equity calculator symbols before the
link.

The wasm build does not link GLib. The small compatibility surface under
`native/gnubg/wasm-compat/` and `native/gnubg/gnubg_wasm_runtime.c` provides
only the allocation, file, logging, and process-global helpers required by the
selected headless evaluator. The generic GNUbg XML parser is excluded.

For wasm, patch 0003 compiles an authenticated Kazaross-XG2 match-equity table
from exact IEEE-754 binary32 bit patterns generated from the upstream XML. The
generator pins the XML SHA-256, strictly validates the expected 25-point table,
and preserves its upstream notice. Native verification compares the complete
extended 64-by-64 pre-Crawford table, both 64-entry post-Crawford tables, and
all cached gammon-price tables byte for byte between GNUbg's original XML path
and the embedded-data path.

The current ABI still requires two readable asset paths, so the build preloads
both `gnubg.weights` and the small Kazaross XML. Evaluation uses the compiled
match-equity data; the XML remains only as the temporary readable path input.
Removing that duplicate file requires an intentional ABI-compatible adapter
change, not a silent packaging omission.

The checkpoint uses 65,536 evaluator-cache entries, 8,192 pruning-cache
entries, a 32-MiB initial memory, a 128-MiB maximum, and a 1-MiB stack. Memory
growth is allowed, checked initialization cache/resource failures are
recoverable, and pthreads and `SharedArrayBuffer` are not required. Normal
GNUbg runtime allocations retain GLib's abort-on-OOM contract; a Worker that
exhausts memory must be terminated and recreated rather than allowed to
continue with a null allocation. These values are build inputs recorded in
`build-info.json`; they are not yet production performance promises.

## Pinned toolchain

`toolchains/emscripten-lock.json` pins Emscripten 6.0.5, the matching emsdk
tag commit, the Emscripten release commit, and the immutable binary-build
commit from the official release mapping. Do not substitute `latest`, `main`,
or `tot` in release builds.

Keep the SDK outside this repository. For example:

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

The build refuses to run unless the emsdk Git commit equals the lock, the
release mapping resolves 6.0.5 to the locked binary-build commit, the installed
package marker matches, `emcc --version` reports the locked version and release
commit, and the compiler target is wasm32. CI repeats the build and Node tests
from a fresh exact-tag SDK checkout.

The SDK is a large external development dependency. It is not downloaded by
`npm ci`, bundled for users, installed system-wide, or committed to Git. Emsdk
downloads its binary archives over HTTPS but does not independently verify an
upstream-published checksum manifest. Before a release, preserve and review
per-platform archive hashes or pin the official container image by OCI digest
in CI.

## Run the checkpoint

The host-native boundary suite and authenticated match-equity generator test
run in ordinary `npm run verify` without Emscripten:

```bash
npm run test:wasm-abi-layout
npm run test:gnubg-met-generator
```

They check every frozen layout, range arithmetic, strict UTF-8, isolated
fake-adapter validation and lifecycle scenarios, deterministic source-data
generation, notice preservation, and malformed-input rejection.

The native evaluator parity command additionally needs the authenticated
native-build prerequisites documented in `GNUBG-NATIVE.md`:

```bash
npm run test:gnubg-native
```

It clean-builds the authenticated GNUbg source, requires successful and
negative direct-adapter versus arena-bridge parity, verifies the parsed and
embedded match-equity tables, and starts a separate process that initializes
and exercises the public wrapper with real assets. Repeat both safety-sensitive
layers with AddressSanitizer and UndefinedBehaviorSanitizer using:

```bash
npm run test:wasm-abi-layout:sanitized
npm run test:gnubg-native:sanitized
```

With the pinned SDK activated, build and instantiate the small ABI-only module:

```bash
npm run test:wasm-abi
```

It writes ignored files under `build/gnubg/wasm-abi/`. The Node smoke test
checks the exported ABI version, wasm32 pointer width, endianness marker, every
published structure size, all reserved descriptor words, and failure behavior
for null or undersized output buffers. This fast module deliberately does not
link GNUbg.

Build and test the real linked evaluator with:

```bash
npm run test:gnubg-wasm
```

This command writes ignored checkpoint artifacts under `build/gnubg/wasm/`:

- `gnubg-wasm.mjs`, the Emscripten module factory;
- `gnubg-wasm.wasm`, the selected linked evaluator and ABI bridge;
- `gnubg-wasm.data`, containing the authenticated weights and temporary XML
  path input;
- `EMSCRIPTEN-LICENSE.txt` and `MUSL-COPYRIGHT.txt`, copied exactly from
  the pinned toolchain as distribution notices;
- `objects/` and `undefined-symbols.txt`, which make the selected link surface
  auditable; and
- `build-info.json`, containing source and patch provenance, the toolchain
  identity, flags, exports, memory settings, asset and artifact sizes, gzip
  estimates, notice hashes, and SHA-256 hashes.

The module JavaScript retains Emscripten's generated runtime license banner.
Any distribution of the GNUbg WASM checkpoint must include both copied notice
files, the GPL license and applicable GNUbg notices, and complete corresponding
source for the exact build. The notice files are compliance companions, not
browser payload, so the three-file transfer measurement below excludes them.

With the pinned checkpoint, those three delivery files total about 1.37 MB
uncompressed: roughly 93 KB of module JavaScript, 161 KB of WebAssembly, and
1.11 MB of preloaded data. Their summed level-9 gzip estimate is about 598 KB.
Actual browser transfer size depends on hosting compression and caching, so the
build manifest remains the authoritative per-build measurement.

The Node test first gives an existing but invalid weights asset to GNUbg and
requires a recoverable initialization error instead of a process abort. It
also fills a separate module to its 128-MiB memory limit and requires evaluator
cache allocation to fail cleanly without a trap. Both consumed modules reject
reuse. A fresh module then initializes the authenticated evaluator, checks the
frozen descriptor, runs the native checker and double/take cube goldens
through the JavaScript arena, exercises successful two-ply maximum-strength
checker scoring, resets caches, disposes idempotently, and verifies
transactional `NOT_READY`
output afterward. Checker and cube selections are exact; documented float
goldens use a `1e-5` tolerance across host and wasm compilers.

The test prints local Node instantiation, initialization, and final-memory
diagnostics. Those values help catch large regressions but are not browser
cold-start or decision benchmarks.

## Next implementation boundary

The linked evaluator checkpoint is testable but remains disconnected from the
capsule application. The next boundary is a compute Worker loader and
JavaScript/TypeScript arena marshaller that fetch the module and data through
explicit CORS-enabled URLs, validates the descriptor, and maps BEP requests to
the frozen ABI. Cancellation must terminate the compute Worker, suppress stale
results, and create a fresh runtime because synchronous GNUbg evaluation is not
interruptible through the current public API.

Before replacing the GPL-free mock, add browser-level asset failure and Worker
termination/recreation tests, exercise remaining checker edge cases, measure
cold and warm download/startup/decision behavior on representative devices,
set candidate and time limits for the two-ply maximum preset, and complete the
public release/corresponding-source packaging and legal review. Until then,
`npm run build` and `npm run build:verification` continue to publish only the
mock capsule.
