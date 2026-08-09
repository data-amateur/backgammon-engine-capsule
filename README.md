# Backgammon engine capsule

A separately hosted browser-engine endpoint for Backgammon Light. It accepts a
single origin-checked `MessagePort`, speaks Backgammon Engine Protocol v1, and
runs all engine decisions in a capsule-owned Worker.

The active implementation is intentionally a tiny, deterministic, Apache-2.0
mock. It chooses the first opaque legal-turn ID supplied by the authoritative
server and chooses `no-double`/`take` when legal. Its purpose is to preserve a
fast isolation/protocol baseline while the GNUbg/WASM backend is developed.

The repository preserves an authenticated GNU Backgammon 1.08.003 source
archive and now builds a minimal GPL native harness with golden tests. The
default browser build still uses only the mock: no GNUbg code, neural-network
data, or native output is copied to `dist/` or served yet. A post-build
allowlist enforces that boundary. See
`NOTICE.md`, `THIRD_PARTY_NOTICES.md`, `third_party/gnubg/README.md`,
and `docs/GNUBG-NATIVE.md` for the mixed-license source map, provenance, build,
and licensing details.

## Requirements

- Node.js 20.19 or newer; Node 22 LTS is recommended (`.nvmrc` is included).
- npm
- `gpgv`, used to authenticate the pinned GNUbg upstream archive.
- For the native GNUbg checkpoint: a C11 compiler, GNU Make, `tar`,
  `patch`, `pkg-config`, and GLib 2.0 development headers.
- A browser installed through Playwright for the browser suite.
- Only for the WebAssembly builds and tests: the exact external Emscripten SDK
  pinned in `toolchains/emscripten-lock.json`. It is required by both
  `test:wasm-abi` and `test:gnubg-wasm`, but is not installed by npm or
  required to run the mock capsule.

## Run locally

```bash
npm ci
npm run dev
```

`npm ci` installs the exact development-tool versions in `package-lock.json`
into the ignored `node_modules/` directory. Use `npm install` only when you
intend to add or update a dependency and review the resulting lockfile change.

The server listens only on `http://localhost:4174` and fails if that port is
occupied. The development parent allowlist defaults to exactly
`http://localhost:3000`.

Copy `.env.example` to `.env.local` to change local origins. Production builds
must set exact HTTPS values for `VITE_ALLOWED_PARENT_ORIGINS` and
`VITE_CAPSULE_PUBLIC_ORIGIN`; comma-separated parent origins are supported.

## Connect Backgammon Light

In the private application's `client/.env.local`:

```dotenv
VITE_SERVER_URL=http://localhost:8000
VITE_GNUBG_ENGINE_URL=http://localhost:4174/
```

Restart the private Vite client after changing the file. Choose “GNU
Backgammon” in the computer-opponent selector. A successful mock handshake
should clear the preload toast without showing the built-in fallback, and the
computer should make a legal move on its first turn.

The private host requires iframe load, Worker initialization, and `hello` to
finish inside ten seconds. Current decisions normally have a 500 ms requested
budget plus a 2,000 ms host grace period; the mock responds immediately.

## Verification

```bash
npm run verify
npx playwright install chromium
npm run test:e2e
```

`npm run verify` runs every non-browser check, including every frozen
wasm32 ABI size and offset, overflow-safe arena and UTF-8 tests, isolated
fake-adapter lifecycle checks, successful and negative direct-versus-arena
parity, and a separate real public-wrapper lifecycle process. Dedicated
`test:wasm-abi-layout:sanitized` and `test:gnubg-native:sanitized`
commands repeat the C boundary under ASan/UBSan, and CI runs them with Clang.
With the separately installed pinned Emscripten SDK activated,
`npm run test:wasm-abi` builds and instantiates a tiny ABI-only
`.mjs + .wasm` module, while `npm run test:gnubg-wasm` builds and tests
the real linked GNUbg evaluator with authenticated assets. Both commands write
only ignored checkpoint artifacts, and neither alters the active mock Worker.
A separate CI job runs both pinned-toolchain checks. Normal verification also
makes a production-like browser build using the
checked-in loopback-only verification configuration. It checks the pinned
GNUbg archive's size, SHA-256 hash, detached signature, and exact signer
fingerprint without
accessing the user's GnuPG keyring. The native suite extracts that authenticated
archive into an ignored work directory and performs a clean headless rebuild.
The native build records its ambient compiler, target, flags, Make,
`pkg-config`, and GLib versions in ignored `build-info.json`; it is repeatable
but not yet a bit-for-bit reproducible build because those inputs are not
pinned. The browser build also rejects any output outside the audited mock-only
allowlist. The browser suite serves the built artifact, hosts a real parent at
`http://localhost:3100`,
embeds the capsule at port 4174 with
`sandbox="allow-scripts"`, transfers the private channel, and tests hello,
checker play, cube play, cancellation, a second rejected bootstrap, Blob
Worker creation, CORS, and CSP. Chromium is the current automated baseline;
Firefox and WebKit are release gates before claiming broad browser support.

## Production hosting

Production builds fail closed unless both trust-boundary variables are set.
Create an uncommitted `.env.production.local` containing your real HTTPS
origins, then build:

```dotenv
VITE_ALLOWED_PARENT_ORIGINS=https://backgammon.example
VITE_CAPSULE_PUBLIC_ORIGIN=https://engine.example
```

```bash
npm run build
```

`npm run build` emits `dist/`, including a `_headers` file for static hosts that
support that convention. Confirm equivalent headers on the actual host:

- wildcard credentialless CORS for public Worker/WASM assets;
- `Cross-Origin-Resource-Policy: cross-origin`;
- a restrictive CSP with `worker-src blob:`;
- exact private origins in `frame-ancestors`;
- no `Access-Control-Allow-Credentials`;
- immutable caching for hashed assets and no-cache entry HTML.

Do not add `X-Frame-Options: DENY` or `SAMEORIGIN`; cross-origin embedding by
the explicitly allowed private application is intentional.

## GNUbg phase

GNUbg 1.08.003 is pinned, authenticated, and exercised through a clean,
minimal native harness. The harness translates BEP-style absolute boards,
independently matches supplied turns against GNUbg's complete legal set, and
scores candidates through a typed C API. It remains deliberately absent from
the browser runtime.

ABI 1.0 provides a bounded arena bridge for initialization, checker and cube
decisions, reset, and terminal disposal. Fake-adapter tests, authenticated
native checker/cube goldens, public-wrapper lifecycle tests, and sanitizer runs
exercise that same marshalling path. Native verification also compares the
original and embedded match-equity tables byte for byte after full extension.

The pinned Emscripten 6.0.5 checkpoint now links the selected GNUbg evaluator,
a narrow wasm-only compatibility runtime, authenticated embedded match-equity
data, reduced caches, preloaded weights, and the public bridge into a real
modularized wasm32 evaluator. Node tests cover recoverable invalid-weights and
cache-allocation failures, fresh-module retries, checker and cube goldens,
reset, and disposal. The active browser Worker is still the GPL-free mock:
generated GNUbg artifacts remain ignored under `build/gnubg/wasm/` and are
not copied to `public/` or `dist/`.

All GNUbg source, patches, build scripts, modules, networks, license material,
and exact corresponding-source archives must remain in this public capsule
project—never in the proprietary application.

See [the native harness guide](docs/GNUBG-NATIVE.md),
[the WebAssembly checkpoint](docs/GNUBG-WASM.md), and
[the roadmap](docs/GNUBG-ROADMAP.md) before continuing that work.
