# Backgammon engine capsule

A separately hosted browser-engine endpoint for Backgammon Light. It accepts a
single origin-checked `MessagePort`, speaks Backgammon Engine Protocol v1, and
runs all engine decisions in a capsule-owned Worker.

The active implementation is intentionally a tiny, deterministic, Apache-2.0
mock. It chooses the first opaque legal-turn ID supplied by the authoritative
server and chooses `no-double`/`take` when legal. Its purpose is to preserve a
fast isolation/protocol baseline while the GNUbg/WASM backend is developed.

The repository now preserves an authenticated GNU Backgammon 1.08.003 source
archive under `third_party/gnubg/`. It is not used by the current build, copied
to `dist/`, or served to browsers yet. See `THIRD_PARTY_NOTICES.md` and
`third_party/gnubg/README.md` for provenance and licensing details.

## Requirements

- Node.js 20.19 or newer; Node 22 LTS is recommended (`.nvmrc` is included).
- npm
- `gpgv`, used to authenticate the pinned GNUbg upstream archive.
- A browser installed through Playwright for the browser suite.

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

`npm run verify` runs every non-browser check and makes a production-like build
using the checked-in loopback-only verification configuration. It first checks
the pinned GNUbg archive's size, SHA-256 hash, detached signature, and exact
signer fingerprint without accessing the user's GnuPG keyring. The browser suite
serves the built artifact, hosts a real parent at `http://localhost:3100`,
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

GNUbg 1.08.003 is pinned and authenticated but deliberately absent from the
runtime. The next phase preserves the controller, protocol, tests, and mock
backend while adding a reproducible native headless harness, followed by a WASM
build inside the compute Worker. All GNUbg source, patches, build scripts, WASM,
networks, license material, and exact corresponding-source archives must remain
in this public capsule project—never in the proprietary application.

See [docs/GNUBG-ROADMAP.md](docs/GNUBG-ROADMAP.md) before starting that work.
