# GNUbg WebAssembly checkpoint

This checkpoint proves the browser-facing binary boundary before attempting to
link GNUbg. It does **not** change the capsule's active mock Worker and it does
not copy WebAssembly into `public/` or `dist/`.

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

The current exports only report and describe the ABI:

- `bgc_wasm_abi_version`
- `bgc_wasm_abi_descriptor_size`
- `bgc_wasm_get_abi_descriptor`

Engine initialization and decisions are intentionally deferred until arena
range validation and native marshalling parity tests exist.

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

The native layout test needs only a C11 compiler and always runs in
`npm run verify`:

```bash
npm run test:wasm-abi-layout
```

With the pinned SDK activated, build and instantiate the ABI-only module:

```bash
npm run test:wasm-abi
```

The build writes ignored files under `build/gnubg/wasm-abi/`:

- `gnubg-wasm-abi.mjs`
- `gnubg-wasm-abi.wasm`
- `build-info.json`, containing the exact lock, compiler identity, flags,
  artifact sizes, and SHA-256 hashes

The Node smoke test checks the exported ABI version, wasm32 pointer width,
endianness marker, every published structure size, all reserved descriptor
words, and failure behavior for null or undersized output buffers.

## Next implementation boundary

After this smoke module passes, add overflow-safe arena range helpers and pure
conversion tests. Then marshal the existing native checker and cube goldens
through the wrapper and compare them with direct adapter results. Only after
that parity is green should the GNUbg evaluator objects be compiled for wasm32.

GNUbg's GLib dependency and fatal initialization paths remain separate link
and runtime problems. They are not hidden by this ABI checkpoint.
