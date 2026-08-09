# Notice

Copyright 2026 Backgammon Light contributors.

This is a mixed-license source repository. The original capsule shell, mock
engine, TypeScript protocol code, documentation, and build scripts are
Apache-2.0 under the root `LICENSE`, except where a file says otherwise.

The authenticated GNU Backgammon source release under
`third_party/gnubg/upstream/`, the capsule-authored GNUbg patches under
`third_party/gnubg/patches/`, the GPL-marked match-equity generator, and the
adapter, wasm32 runtime and ABI boundary, and their tests under `native/gnubg/`
are GPL-3.0-or-later. See `LICENSES/GPL-3.0-or-later.txt` and
`THIRD_PARTY_NOTICES.md`.

`npm run test:gnubg-wasm` generates an ignored GPL-covered GNUbg module and
data package under `build/gnubg/wasm/`. They contain linked GNUbg program code
and its neural-network weights and are test artifacts, not Apache-2.0 capsule
files.

The default browser capsule contains the original deterministic mock engine and
no GNU Backgammon binary, neural-network data, or other GPL engine component.
The generated evaluator is not copied into `public/` or `dist/` and is not
served by the current capsule build.
