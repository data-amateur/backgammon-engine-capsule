# GNUbg WebAssembly checkpoint

This checkpoint implements and tests the browser-facing binary boundary before
attempting to link GNUbg for wasm32. It does **not** change the capsule's active
mock Worker and it does not copy WebAssembly into `public/` or `dist/`.

## What is frozen

`native/gnubg/gnubg_wasm_abi.h` defines ABI version 1.0. It is deliberately a
separate layer from the native adapter because native pointers, `size_t`, and C
enum layouts are not stable JavaScript contracts.

The boundary uses only fixed-width integers and 32-bit floats. Checker
candidates contain four inline steps. Future pointer-like fields are 32-bit
byte offsets relative to one caller-owned arena. ABI 1.0 also fixes alignment,
pairwise non-overlap, overflow checking, and required UTF-8 path semantics.
Every top-level request and result starts with an ABI version and byte size, and
every reserved field must be zero. The runtime descriptor lets TypeScript
reject an unexpected layout at startup instead of silently reading the wrong
bytes.

The native wrapper now implements these public exports:

- `bgc_wasm_abi_version`, `bgc_wasm_abi_descriptor_size`, and
  `bgc_wasm_get_abi_descriptor`;
- bounded zeroed allocation through `bgc_wasm_alloc` and `bgc_wasm_free`;
- `bgc_wasm_init`, `bgc_wasm_choose_turn`, `bgc_wasm_decide_cube`,
  `bgc_wasm_reset`, and `bgc_wasm_dispose`.

The wrapper owns one process-scoped engine and has a terminal lifecycle. A
wire-validation failure before the adapter call is retryable; once init reaches
GNUbg, success or failure consumes that Worker. Dispose is idempotent and
terminal. Calls are serial and non-reentrant, and no arena pointer is retained.

The caller provides one four-byte-aligned, at-most-512-KiB arena. Every typed
range is bounds-, overflow-, alignment-, and overlap-checked before use. Paths
receive strict RFC 3629 UTF-8 validation. Wire values are copied into native
structs field by field; native pointers and enum representations never cross the
boundary. Results, score capacity, and the 256-byte error buffer are cleared
before evaluation, and adapter outputs are committed only after full validation.
The current pinned Emscripten smoke remains ABI-only; these engine exports are
native-tested but are not yet linked to a wasm32 GNUbg evaluator.

## Pinned toolchain

`toolchains/emscripten-lock.json` pins Emscripten 6.0.5, the matching emsdk
tag commit, the Emscripten release commit, and the immutable binary-build
commit from the official release mapping. Do not substitute `latest`, `main`,
or `tot` in release builds.

Keep the SDK outside this repository. For example:

```bash
git clone --branch 6.0.5 --depth 1 \
  https://github.com/emscripten-core/emsdk.git \
  /home/xiao/code/toolchains/emsdk-6.0.5

emsdk_checkout_commit="$(git -C /home/xiao/code/toolchains/emsdk-6.0.5 rev-parse HEAD)"
if [ "${emsdk_checkout_commit}" != "dfb9d1a46c3bb8f52e1e6324be23123b9d73c190" ]; then
  echo "Unexpected emsdk commit: ${emsdk_checkout_commit}" >&2
  exit 1
fi

/home/xiao/code/toolchains/emsdk-6.0.5/emsdk install 6.0.5
/home/xiao/code/toolchains/emsdk-6.0.5/emsdk activate 6.0.5
source /home/xiao/code/toolchains/emsdk-6.0.5/emsdk_env.sh
```

Verify the checkout before running any of its scripts, as shown above. The
build independently refuses to run unless the emsdk Git commit equals
`dfb9d1a46c3bb8f52e1e6324be23123b9d73c190`, its release mapping resolves
6.0.5 to the locked binary-build commit, its installed-package marker matches,
`emcc --version` reports both the locked version and Emscripten release commit,
and the compiler target is wasm32. A separate CI job repeats this full build and
Node instantiation from a fresh exact-tag SDK checkout.

The SDK is a large external development dependency. It is not downloaded by
`npm ci`, bundled for users, installed system-wide, or committed to Git.
Emsdk downloads its binary archives over HTTPS but does not independently
verify an upstream-published checksum manifest. Before a release, preserve and
review per-platform archive hashes or pin the official container image by OCI
digest in CI.

## Run the checkpoint

The compiler-only host-native boundary suite always runs in
`npm run verify`:

```bash
npm run test:wasm-abi-layout
```

It checks every frozen layout, range arithmetic, strict UTF-8, and isolated
fake-adapter validation/lifecycle scenarios. The real evaluator parity command additionally
needs the authenticated native-build prerequisites documented in
`GNUBG-NATIVE.md`:

```bash
npm run test:gnubg-native
```

It clean-builds the authenticated GNUbg source, requires successful and
negative direct-adapter versus arena-bridge parity, and then starts a separate
process that initializes and exercises the public wrapper with real assets. To repeat
both safety-sensitive layers with AddressSanitizer and
UndefinedBehaviorSanitizer:

```bash
npm run test:wasm-abi-layout:sanitized
npm run test:gnubg-native:sanitized
```

With the pinned SDK activated, build and instantiate the ABI-only module:

```bash
npm run test:wasm-abi
```

The build writes ignored files under `build/gnubg/wasm-abi/`:

- `gnubg-wasm-abi.mjs`
- `gnubg-wasm-abi.wasm`
- compile-only `gnubg_wasm_marshal.o` and `gnubg_wasm_bridge.o`, proving
  the reviewed bridge is valid wasm32 C without linking the evaluator
- `build-info.json`, containing the exact lock, compiler identity, flags,
  artifact sizes, and SHA-256 hashes

The Node smoke test checks the exported ABI version, wasm32 pointer width,
endianness marker, every published structure size, all reserved descriptor
words, and failure behavior for null or undersized output buffers.

## Next implementation boundary

The bridge and marshaller now compile cleanly to wasm32 objects. The next
boundary is linking them with the typed adapter and selected GNUbg evaluator
objects in a runnable Emscripten module. First resolve the pinned
GLib surface (or replace it with a reviewed public compatibility patch), make
upstream initialization report failures instead of terminating, and reduce the
large evaluator caches before startup. Then run the same fixtures through a real
Emscripten module, using exact decision/index comparison and a documented small
float tolerance across host and wasm compilers.

Only after real wasm32 parity, asset-failure handling, Worker termination and
recreation tests, and measured memory/download/latency results are green should
the compute Worker replace the GPL-free mock.
