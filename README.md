# Backgammon engine capsule

A separately hosted, public browser-engine endpoint for Backgammon Light. It
accepts one origin-checked `MessagePort`, speaks Backgammon Engine Protocol v1
(BEP v1), and runs GNU Backgammon decisions in a capsule-owned Worker.

The active engine is GNU Backgammon 1.08.003 compiled to WebAssembly. The
browser Worker evaluates only the positions and authoritative legal choices
provided through BEP; it does not receive authentication, room, socket, or user
data and cannot mutate a game. The proprietary application remains in its own
repository and deployment. It embeds this public capsule and communicates only
through the versioned BEP v1 port contract.

This is a mixed-license public repository. The capsule shell and protocol code
are Apache-2.0 except where a file says otherwise. GNUbg, its adapter and ABI,
the real engine Worker, generated module and data, and the relevant build
sources are GPL-3.0-or-later. The old deterministic mock remains only as
non-shipped test/reference code. See `NOTICE.md`,
`THIRD_PARTY_NOTICES.md`, `third_party/gnubg/README.md`, and
`docs/GNUBG-NATIVE.md` for the exact source and license map.

The iframe/Worker split is a useful technical and maintenance boundary, not a
legal exception. Keep the capsule, GNUbg artifacts, build scripts, notices,
and complete corresponding source public and separate from the proprietary
host, and obtain qualified legal advice before relying on that separation.

## Requirements

- Node.js 20.19 or newer; Node 22 LTS is recommended (`.nvmrc` is included).
- npm.
- `gpgv`, used to authenticate the pinned GNUbg upstream archive.
- GNU tar 1.28 or newer, required for deterministic corresponding-source
  archives. The scripts prefer `gtar` and then `tar` from `PATH`; set
  `BGC_GNU_TAR` to an absolute GNU tar path when neither name selects it.
  macOS normally needs the Homebrew `gnu-tar` package; native Windows needs a
  GNU tar installation such as MSYS2, or use WSL.
- For native verification: a C11 compiler, GNU Make, `patch`,
  `pkg-config`, and GLib 2.0 development headers.
- For development and browser builds: the exact external Emscripten SDK in
  `toolchains/emscripten-lock.json`. npm does not install it. Follow
  `docs/GNUBG-WASM.md` to install and activate Emscripten 6.0.5 outside this
  repository.
- Chromium installed through Playwright for the browser suite.

## Run locally

Activate the pinned Emscripten SDK first, then run:

```bash
npm ci
npm run dev
```

`npm ci` installs the exact JavaScript development tools from
`package-lock.json` into ignored `node_modules/`. Use `npm install` only when
you intend to change dependencies and review the lockfile change.

`npm run dev` authenticates and builds the real GNUbg evaluator, stages its
browser distribution, builds the GPL Worker, and starts Vite at
`http://localhost:4174`. It listens only on `127.0.0.1` and fails if the port
is occupied. The local parent allowlist defaults to exactly
`http://localhost:3000`.

Copy `.env.example` to `.env.local` to change local origins. Loopback HTTP is
accepted only outside production. The corresponding-source URL is generated
from the capsule origin and exact archive digest. The license URL has a safe
local default; production requires an explicit HTTPS value.

## Connect Backgammon Light

In the private application's `client/.env.local`:

```dotenv
VITE_SERVER_URL=http://localhost:8000
VITE_GNUBG_ENGINE_URL=http://localhost:4174/
```

Restart the private Vite client after changing the file. Choose “GNU
Backgammon” in the computer-opponent selector. A successful preload clears the
engine-loading toast without activating the built-in fallback. The engine
module initializes once in its Worker and that Worker is retained across games
in the match. It is not downloaded and initialized again for each game.

The host remains authoritative: every checker result is one opaque legal-turn
ID supplied by the server, and every cube result is one supplied legal action.
The server must continue to validate and apply the choice.

## Browser runtime

The sandboxed iframe fetches the root `gnubg-engine.worker.js` without
credentials and starts it from a Blob URL. That classic Worker dynamically
imports one exact absolute, same-capsule, content-versioned
`gnubg-wasm.mjs` URL. The Emscripten factory receives explicit absolute URLs
for `gnubg-wasm.wasm` and `gnubg-wasm.data`; none is resolved relative to the
Blob URL.

Before announcing readiness, the Worker checks the complete ABI 1.0 runtime
descriptor, allocates a 512-KiB caller-owned arena, and initializes GNUbg with
the preloaded weights and match-equity paths. Emscripten memory may grow, so
the marshaller obtains fresh heap views after every native call rather than
retaining views into an older buffer.

Synchronous GNUbg evaluation cannot be interrupted in place. A BEP cancel
terminates the Worker, suppresses stale output, and makes the next request
create and initialize a fresh Worker/module. Initialization failure, fatal
engine failure, and malformed fatal output use the same recreation boundary.

The pinned delivery files total about 1.37 MB uncompressed: approximately
93 KB JavaScript, 161 KB WebAssembly, and 1.11 MB preloaded data. The current
build starts with 32 MiB of WebAssembly memory and allows growth to 128 MiB.
Actual transfer size depends on host compression and cache state; the staged
manifest and `build-info.json` are authoritative for a particular build.

## Verification

Run the ordinary host/native checks without Emscripten:

```bash
npm run verify
```

With the pinned Emscripten SDK activated, run the linked evaluator, production-
like browser build, and Chromium boundary tests:

```bash
npm run test:gnubg-wasm
npm run build:verification
npx playwright install chromium
npm run test:e2e
```

`npm run verify` checks authenticated source, deterministic match-equity
generation, a byte-reproducible and tamper-detecting corresponding-source
archive, TypeScript, lint, unit tests, every frozen ABI layout/range rule, and
native GNUbg goldens. Dedicated `test:wasm-abi-layout:sanitized` and
`test:gnubg-native:sanitized` commands repeat the C boundary under ASan/UBSan.

The Chromium suite embeds the real built capsule in an opaque cross-origin
sandbox. Its checker and cube fixtures deliberately put GNUbg's exact golden
choice after another legal option, so the old first-legal mock cannot pass. It
also verifies ranking, Blob Worker recreation after cancellation, retry after
a real `.wasm` 404, one-time port bootstrap, immutable engine asset headers,
CORS/CORP, MIME types, CSP, absence of console errors, and availability of the
exact advertised source archive without downloading it during startup. See
`docs/TESTING.md` for the full matrix.

## Production build and hosting

Create an uncommitted `.env.production.local` with exact release values:

```dotenv
VITE_ALLOWED_PARENT_ORIGINS=https://backgammon.example
VITE_CAPSULE_PUBLIC_ORIGIN=https://engine.example
VITE_BUILD_ID=gnubg-1.08.003-release.1
VITE_LICENSE_URL=https://engine.example/LICENSES/GPL-3.0-or-later.txt
```

The build generates `VITE_SOURCE_URL` internally from the exact capsule
origin and source-archive digest; an external or moving source URL cannot be
substituted accidentally. `VITE_LICENSE_URL` must be the public
GPL-3.0-or-later text. Production rejects a dirty tracked or untracked source
tree, missing metadata, non-HTTPS URLs, or unsafe build IDs.

With the pinned SDK activated:

```bash
npm run build
```

The build first snapshots every tracked and nonignored public source file,
normalizes archive metadata, embeds a per-file SHA-256 manifest, and verifies
the archive before compiling. A production source snapshot must be clean. It
includes the signed GNUbg archive/signature/key, ordered patches, capsule
sources, build scripts, tests, package lock, toolchain lock, licenses, and
notices. The resulting archive is served separately at
`/sources/sha256-<archive-digest>/backgammon-engine-capsule-source.tar.gz`.
It adds about 14.3 MB of deployment storage but is never fetched by normal
engine startup.

Source packaging validates that the selected archive tool identifies itself
as GNU tar 1.28 or newer. If `gtar` or `tar` on `PATH` selects BSD tar, set
the override in the shell that runs npm, for example
`BGC_GNU_TAR=/opt/homebrew/bin/gtar npm run build`.

The build then authenticates and rebuilds GNUbg, binds the source commit/tree
and archive hashes into `build-info.json`, checks payload hashes, and stages
the module, WebAssembly, data, build information, and Emscripten/musl notices
under one
`/engines/sha256-<content-digest>/` directory. The digest covers every file in
that immutable engine directory. The source archive has its own independent
content address and does not count toward the engine's 1.37 MB runtime payload.
The Worker stays at the root and is served with `no-cache`, allowing loader
fixes without pretending they are the same engine payload. `SOURCE.txt`
records the archive URL, bytes, SHA-256, repository commit, and source-tree
digest. Both license texts and notices are included.

`verify:dist` compares every staged size and SHA-256 hash, permits only the
manifested files and expected Vite output, checks the WebAssembly magic and
GPL Worker banner, rejects private build paths and stale mock runtime text,
extracts and verifies the one explicitly manifested source archive, rejects
all other archives, and requires matching source provenance in the Worker,
browser manifest, `SOURCE.txt`, and `build-info.json`.

The generated `_headers` file is suitable only for hosts that implement that
convention. Confirm equivalent behavior on the deployed host:

- wildcard credentialless CORS and `Cross-Origin-Resource-Policy: cross-origin`;
- exact allowed parent origins in `frame-ancestors`;
- restrictive CSP with `worker-src blob:` and `wasm-unsafe-eval` but not
  unrestricted `unsafe-eval`;
- no `Access-Control-Allow-Credentials`;
- immutable one-year caching for the content-versioned engine directory;
- immutable one-year caching for the content-addressed source directory;
- no-cache entry HTML and root Worker; and
- correct JavaScript, WebAssembly, and data MIME types.

Do not add `X-Frame-Options: DENY` or `SAMEORIGIN`; cross-origin embedding by
the explicitly allowed private host is intentional.

## Remaining release work

Before a public production release, publish the complete generated static
artifact atomically, preserve an immutable signed tag or release attestation,
benchmark cold and warm startup and decisions on representative slow devices,
and run the manual private-application integration across multiple games,
cancellation, failure, and fallback. Firefox/WebKit portability and qualified
license review also remain release gates.

See [the protocol](docs/BEP-v1.md),
[architecture](docs/ARCHITECTURE.md),
[native harness guide](docs/GNUBG-NATIVE.md),
[WebAssembly integration](docs/GNUBG-WASM.md), and
[roadmap](docs/GNUBG-ROADMAP.md).
