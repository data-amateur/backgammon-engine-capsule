# Security model

The capsule assumes every structured-clone value is untrusted even though BEP
traffic arrives through a private `MessagePort`.

Runtime controls include:

- an exact parent-origin allowlist and `event.source === parent`;
- one port accepted once, followed by removal of the Window listener;
- a cryptographically random session nonce on every port message;
- bounded JSON shape, method, position, legal-choice, and result validation;
- duplicate request rejection and request/result correlation;
- authoritative legal ID/action checks before returning Worker output;
- late-result suppression after cancellation;
- termination and clean recreation after cancellation, timeout, asset failure,
  fatal engine failure, or malformed fatal output;
- credentialless CORS fetches from explicit same-capsule public URLs;
- an opaque iframe sandbox without `allow-same-origin`;
- restrictive CSP and exact `frame-ancestors`;
- no cookies, storage, sockets, analytics, third-party scripts, or Service
  Worker; and
- no command parser, `eval`, arbitrary commands, unsafe HTML, GTK, Python,
  database, or GNUbg networking surface.

The root Worker is fetched with `no-cache`; the GNUbg module, WebAssembly,
and data live under a SHA-256 content-versioned directory with immutable
caching. The wildcard CORS and
`Cross-Origin-Resource-Policy: cross-origin` headers apply only to public
capsule assets and never allow credentials. They are necessary because the
sandboxed iframe has an opaque origin. Parent authorization is enforced
separately during the one-time bootstrap.

Search limits are defense in depth. The controller enforces `timeMs` by
terminating the Worker once a ready engine exceeds the decision deadline.
`maxNodes` is rejected because it cannot be measured, and memory requests
below the 128-MiB WebAssembly ceiling are rejected. Maximum checker search is
restricted to at most eight candidates with at least 500 ms and depth two;
tighter requests fall back to expert zero-ply and are marked incomplete.
Match play is bounded to length 64 and cube 64; money cubes are bounded to
4,096. The authoritative server must still validate all room options and
returned choices.

## Build and source integrity

The GNUbg release archive is pinned by hash and authenticated with a checked-in
release key and exact fingerprint. Ordered patches, the Emscripten lock,
engine artifacts, notices, and browser manifest are hashed and verified.

Each build creates a deterministic corresponding-source archive at:

```text
/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz
```

The verifier rejects absolute paths, traversal, links, special files, missing
or extra files, hash mismatches, and an archive that differs from the source
snapshot. Production additionally requires a clean Git working tree. Because
the snapshot includes tracked and non-ignored source files, never place
credentials or private material in this public repository or in an unignored
path.

The source URL is advertised through BEP metadata and `SOURCE.txt`, but the
runtime never fetches it. Chromium tests explicitly assert that normal engine
startup does not request the source archive; the suite downloads it separately
only to verify its immutable URL, headers, gzip signature, and SHA-256.

Report security issues privately to the project owner until a public security
contact is configured.
