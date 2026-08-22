# Notice

Copyright 2026 RollBG contributors.

This is a mixed-license public source repository. The capsule shell, BEP
protocol code, documentation, and original project build/test code are
Apache-2.0 under the root `LICENSE`, except where a file says otherwise.
The retired deterministic mock remains only as non-shipped test/reference
code.

GNU Backgammon 1.08.003, the ordered compatibility patches, match-equity
generator, native adapter, wasm32 runtime and ABI bridge, real engine Worker,
generated WebAssembly module and data package, and their GPL-side tests are
GPL-3.0-or-later. See `LICENSES/GPL-3.0-or-later.txt`,
`THIRD_PARTY_NOTICES.md`, and the file-level SPDX notices.

The browser capsule currently serves the real GNUbg engine. Its normal
three-file engine payload is approximately 1.37 MB uncompressed:
`gnubg-wasm.mjs`, `gnubg-wasm.wasm`, and `gnubg-wasm.data`. The data
package contains GNUbg's authenticated neural-network weights and the
temporary readable match-equity XML path input. Emscripten and musl notices
are distributed beside the content-versioned engine assets.

Every browser build first creates and verifies a deterministic archive of the
complete source snapshot used for that build. It is published separately at:

```text
/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz
```

The archive hash, source-tree hash, repository commit, and embedded source
manifest are bound into the GNUbg `build-info.json`, browser asset manifest,
and `SOURCE.txt`. Production builds require a clean Git working tree. The
source archive is a compliance download: the Worker advertises its URL in BEP
metadata but never fetches it while loading or making decisions, so it does
not increase the normal 1.37 MB engine payload.
