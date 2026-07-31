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
