# Architecture

```text
authoritative server
  -> proprietary browser host
  -> one origin-checked MessagePort
  -> opaque cross-origin iframe controller
  -> validated internal messages
  -> capsule-owned Blob Worker
  -> content-versioned GNUbg module + WASM + data
  -> frozen arena ABI 1.0
  -> GNU Backgammon 1.08.003 evaluator
```

The host creates the iframe with `sandbox="allow-scripts"`, without
`allow-same-origin`, and transfers one fresh port after the iframe load
event. The controller registers its Window listener synchronously, requires an
exact configured parent origin and `event.source === parent`, accepts
exactly one port, then removes the Window listener. All normal BEP traffic
uses that private port and the random session nonce.

The iframe retains the BEP port. It validates bounded BEP inputs before
sending only the method, request ID, and validated payload to the compute
Worker. It correlates and validates Worker output before constructing a BEP
response. The authoritative server still accepts only a host-issued opaque
legal-turn ID or an offered cube action. The capsule receives no
authentication, user, room, or socket data and has no game-mutation authority.

## Worker and WebAssembly loading

The iframe fetches the root `gnubg-engine.worker.js` credentiallessly with
CORS, creates a Blob URL from its source, and starts a classic Worker. This is
required because the sandbox gives the iframe an opaque origin. The Worker
dynamically imports one exact absolute, same-capsule,
content-versioned `gnubg-wasm.mjs` URL. The Emscripten factory receives
explicit absolute URLs for `gnubg-wasm.wasm` and `gnubg-wasm.data`; no
asset is resolved relative to the Blob URL.

Before reporting ready, the Worker validates the complete ABI 1.0 descriptor,
allocates a bounded 512-KiB arena, and initializes GNUbg with its preloaded
weights and match-equity paths. The marshaller copies fields explicitly,
refreshes heap views after native calls because memory may grow, and validates
all result indices and finite scores before returning them.

One compute Worker owns one GNUbg module lifetime. Synchronous native
evaluation cannot be interrupted in place. Cancellation terminates that
Worker, suppresses stale output, fails any other interrupted requests, and
causes the next request to create a fresh Worker/module. Asset, initialization,
fatal engine, and integrity failures use the same recreation boundary.

## Decision limits

BEP structural validation caps messages at 2 MiB, legal turns at 4,096, and
checker turns at four steps. Only standard backgammon is supported. Match
length and match-play cube value are limited to 64; money-play cube value may
reach 4,096.

Search limits are hard upper bounds:

- after the Worker is ready, `timeMs` arms a controller watchdog; expiry
  terminates the synchronous Worker and returns a retryable timeout;
- `maxNodes` is rejected because the native adapter cannot count nodes;
- a supplied `memoryMb` below the module's 128-MiB ceiling is rejected;
- `candidateLimit` limits only returned rankings, never the legal turns
  eligible for selection; and
- maximum-strength checker play uses two plies only with at most eight legal
  candidates, at least 500 ms, and depth two available. Otherwise GNUbg uses
  expert zero-ply evaluation and reports `completed: false`. Maximum cube
  play uses two plies when the time/depth bounds permit it.

## Native and ABI boundary

The adapter accepts BEP-style absolute state through plain C types. It
normalizes the player on roll as GNUbg board row 1, replays each supplied
checker candidate, and requires the resulting position key to occur in
GNUbg's own generated legal set before scoring. For cube play it preserves the
offerer's perspective, validates phase/state/player invariants, evaluates the
available branches, and returns an index into the exact legal action array
supplied by the host.

ABI 1.0 adds a wasm-safe layer around that adapter. JavaScript owns one bounded
aligned byte arena and passes only offsets; the bridge validates all ranges
and wire values, converts into native scratch storage, and commits output only
after a complete successful adapter call. The command parser, desktop UI,
audio, networking, databases, Python, GTK, and GLib are excluded from the
browser module.

## Distribution and corresponding source

The normal GNUbg payload consists of the content-versioned module, WebAssembly,
and data files and is approximately 1.37 MB uncompressed. Notices and build
information accompany that immutable engine directory.

Before GNUbg is built, the release pipeline snapshots the complete repository
source, adds a per-file `SOURCE-MANIFEST.json`, and creates a deterministic
archive. It is staged separately at:

```text
/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz
```

The archive hash, manifest hash, source-tree hash, repository commit, clean
state, and file count are bound into the GNUbg `build-info.json` and browser
asset manifest; `SOURCE.txt` records the public URL and identities.
Production requires a clean Git working tree. Distribution verification
extracts the archive, rejects unsafe entries, checks every file, and verifies
the binding to the engine build.

The BEP hello response advertises the source URL for license compliance, but
the iframe and Worker never fetch the archive during normal execution. It is
not part of the approximately 1.37 MB engine payload.
