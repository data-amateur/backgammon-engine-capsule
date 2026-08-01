# Architecture

```text
authoritative server
  -> proprietary browser host
  -> one origin-checked MessagePort
  -> opaque cross-origin iframe controller
  -> validated internal messages
  -> capsule compute Worker
  -> mock now / GNUbg WASM later
```

The host creates the iframe with `sandbox="allow-scripts"`, without
`allow-same-origin`, and transfers one fresh port after the iframe load event.
The controller registers its Window listener synchronously, requires the exact
configured parent origin and `event.source === parent`, accepts exactly one
port, then removes the Window listener. All normal BEP traffic uses the port
and the random session nonce.

The iframe retains the BEP port. It validates bounded BEP inputs before sending
only the engine method, request ID, and validated payload to the compute
Worker. It validates and correlates Worker results before constructing a BEP
response. Late results are discarded after cancellation.

The Worker is fetched credentiallessly with CORS and started from a Blob URL.
This is required because the sandbox makes the iframe's origin opaque. The
emitted mock Worker is self-contained and has no relative imports.

The authoritative server still recomputes the position and accepts only a
host-issued legal-turn ID or an offered cube action. The capsule has no game
mutation authority and receives no authentication, user, room, or socket data.

## Native GNUbg checkpoint

The default Worker remains the mock. Separately, the public repository can
authenticate and extract GNUbg into an ignored work directory, compile only its
headless evaluator core, and link the GPL adapter and golden tests under an
ignored build directory. Neither generated directory enters the Vite graph or
`dist/`. Every browser build finishes with an explicit mock-only output
allowlist and binary/source-marker audit, so a future accidental GNUbg archive,
network, native executable, or WASM copy fails verification.

The adapter accepts BEP-style absolute state through plain C types. It normalizes
the player on roll as GNUbg board row 1, replays each supplied checker candidate,
and requires the resulting position key to occur in GNUbg's own generated legal
set before scoring. For cube play it preserves the offerer's perspective,
validates the phase/state/player invariants, evaluates GNUbg's no-double,
double/take, and double/pass branches, and returns an index into the exact legal
action array supplied by the host. When GNUbg's preferred semantic action is
absent, the adapter ranks only the supplied alternatives; responders minimize
the offerer's equity.

The C boundary currently accepts standard backgammon only and rejects other
variation values and raccoon policy. It short-circuits unavailable offers and
bounds pre-offer cube values before GNUbg internally doubles them. This keeps
the future Worker API narrow and does not expose the GNUbg command parser.

ABI 1.0 adds a second, wasm-safe layer around that adapter. JavaScript owns one
bounded aligned byte arena and passes only offsets; the bridge validates all
ranges and wire values, converts explicitly into native scratch storage, and
commits output only after a complete successful adapter call. The public wrapper
owns one engine and has a terminal Worker-scoped lifecycle. Native parity tests
borrow the already-initialized golden engine so GNUbg is never initialized twice
in one process. None of these native files enter the current mock Vite graph.
