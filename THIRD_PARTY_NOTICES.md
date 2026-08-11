# Third-party notices

## Browser runtime

The active browser runtime uses GNU Backgammon 1.08.003 compiled to
WebAssembly. Vite and esbuild also compile the capsule shell, protocol code,
and real GPL engine Worker into static JavaScript and CSS. The old
deterministic mock is retained only as non-shipped test/reference code.

Development and test tools are listed in `package.json` and
`package-lock.json`; their packages include their respective license files.
Review the lockfile and applicable notices whenever those tools are updated.

## GNU Backgammon 1.08.003

The repository preserves an unmodified, signed GNU Backgammon source release
under `third_party/gnubg/upstream/`, then applies the ordered
capsule-authored compatibility patches under
`third_party/gnubg/patches/`. The native adapter, wasm32 runtime, ABI
boundary, and their tests live under `native/gnubg/`. GNUbg program code,
the GPL-marked patches and generator, adapter and runtime, real engine Worker,
generated module, and packaged engine data are licensed
`GPL-3.0-or-later`. The complete GPL v3 text is available at
`LICENSES/GPL-3.0-or-later.txt` and inside the authenticated upstream
archive. Patch purpose, order, and authorship are recorded in
`third_party/gnubg/patches/README.md`.

Upstream project: <https://www.gnu.org/software/gnubg/>

Copyright belongs to the GNU Backgammon contributors identified by the
upstream source. That source also contains bundled assets and support
components with their own attribution or license notices. The generated
corresponding-source archive preserves those notices with the exact source
snapshot used for the browser build.

The distributed `gnubg-wasm.data` package includes GNUbg's authenticated
`gnubg.weights` neural-network data. The ABI also preloads
`met/Kazaross-XG2.xml` as a readable path input, while evaluation uses the
generated embedded table. The generated table preserves this upstream notice:

> Copyright (C) 2011 Neil Kazaross. Transcribed for use by GNUbg by Michael
> Petch. Copying and distribution, with or without modification, are permitted
> in any medium without royalty provided the copyright and upstream notice are
> preserved. The file is offered as-is, without warranty.

The exact complete notice remains in the authenticated XML inside the signed
archive and is emitted into the generated C include.

## Emscripten 6.0.5 and musl

The locked external Emscripten 6.0.5 toolchain generates
`gnubg-wasm.mjs` and links selected musl libc code into
`gnubg-wasm.wasm`. Emscripten is offered under the MIT and University of
Illinois/NCSA licenses and its full license file contains applicable notices
for bundled components. Musl as a whole is under the MIT license, copyright
2005-2020 Rich Felker and contributors, with additional permissive component
notices recorded in its complete `COPYRIGHT` file.

The build retains Emscripten's generated runtime license banner and
distributes the exact pinned notices as `EMSCRIPTEN-LICENSE.txt` and
`MUSL-COPYRIGHT.txt` beside the immutable engine assets.

## GLib 2.0 (native harness only)

The local native golden-test executable obtains its GLib 2.0 compiler and
linker flags from `pkg-config` and dynamically links the system GLib
library. GLib is licensed `LGPL-2.1-or-later`; its source project is
<https://gitlab.gnome.org/GNOME/glib/>. GLib source or binaries are not
vendored, copied into `dist/`, or linked into the WebAssembly evaluator.
The WebAssembly build instead uses a capsule-authored narrow compatibility
surface for the selected GNUbg sources.

## Corresponding source

The build generates a deterministic, complete source archive for the exact
engine build and publishes it at:

```text
/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz
```

It contains the authenticated GNUbg archive, signature and key, ordered
patches, generated-side source, capsule adapter and Worker source, build and
verification scripts, package lock, license texts, notices, and toolchain
lock. An embedded `SOURCE-MANIFEST.json` records each path, size, and
SHA-256. The archive identity is bound into GNUbg `build-info.json`, the
browser asset manifest, and `SOURCE.txt`; distribution verification extracts
and checks the archive. Production builds reject a dirty Git working tree.

The archive is served as a separate immutable compliance artifact. The Worker
reports its URL but does not fetch it at startup or during evaluation. It is
therefore excluded from the normal three-file engine transfer measurement,
which remains approximately 1.37 MB uncompressed.
