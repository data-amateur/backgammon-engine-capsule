# Third-party notices

## Current mock runtime

The active browser runtime has no third-party production dependency. Vite and
esbuild compile the original project source into static JavaScript and CSS
without shipping their optional module-preload polyfill or another runtime
library.

Development and test tools are listed in `package.json` and
`package-lock.json`; their packages include their respective license files.
Run `npm audit` and review the lockfile whenever these tools are updated.

## GNU Backgammon 1.08.003

The repository preserves an unmodified, signed GNU Backgammon source release
under `third_party/gnubg/upstream/`, then applies the ordered capsule-authored
compatibility patches under `third_party/gnubg/patches/`. The selected native
harness and real wasm32 evaluator boundary live under `native/gnubg/`. GNUbg's
program code, the GPL-marked patches and generator, the adapter, the wasm
runtime and ABI boundary, and their tests are licensed
`GPL-3.0-or-later`; the complete GPL v3 text is available at
`LICENSES/GPL-3.0-or-later.txt` and inside the signed source archive. Patch
purpose, order, and authorship are recorded in
`third_party/gnubg/patches/README.md`.

Upstream project: <https://www.gnu.org/software/gnubg/>

Copyright belongs to the GNU Backgammon contributors identified by the
upstream source. The source archive also contains bundled assets and support
components with their own attribution or license notices. Those original
notices remain available inside the unmodified archive and must accompany any
distributed files to which they apply.

The generated `gnubg-wasm.data` package includes GNUbg's authenticated
`gnubg.weights` neural-network data. The current ABI also temporarily preloads
`met/Kazaross-XG2.xml` as a readable path input, while evaluation uses the
generated embedded table. The generated table preserves this upstream notice:

> Copyright (C) 2011 Neil Kazaross. Transcribed for use by GNUbg by Michael
> Petch. Copying and distribution, with or without modification, are permitted
> in any medium without royalty provided the copyright and upstream notice are
> preserved. The file is offered as-is, without warranty.

The exact complete notice remains in the authenticated XML inside the signed
archive and is emitted into the generated C include.

## Emscripten 6.0.5 and musl (generated GNUbg WASM checkpoint only)

The locked external Emscripten 6.0.5 toolchain generates
`gnubg-wasm.mjs` and links selected musl libc code into
`gnubg-wasm.wasm`. Emscripten is offered under the MIT and University of
Illinois/NCSA licenses and its full license file also contains applicable
notices for bundled components. Musl as a whole is under the MIT license,
copyright 2005-2020 Rich Felker and contributors, with additional permissive
component notices recorded in its complete `COPYRIGHT` file.

The build retains Emscripten's generated runtime license banner and copies the
exact pinned notices beside the ignored checkpoint artifacts as
`EMSCRIPTEN-LICENSE.txt` and `MUSL-COPYRIGHT.txt`. Distribute those files
with any generated GNUbg WASM package and retain the banner in the module
JavaScript. Emscripten and musl are not linked into, bundled with, or served by
the active GPL-free mock runtime.

## GLib 2.0 (native harness only)

The local native golden-test executable obtains its GLib 2.0 compiler and
linker flags from `pkg-config` and dynamically links the system GLib library.
GLib is licensed `LGPL-2.1-or-later`; its source project is
<https://gitlab.gnome.org/GNOME/glib/>. GLib source or binaries are not
vendored, copied into `dist/`, or linked into the wasm evaluator. The wasm
build instead uses a capsule-authored narrow compatibility surface for the
selected GNUbg sources. Audit the exact runtime dependency and retain its
applicable notices before distributing a native binary.

The capsule shell and GPL-free mock remain under the repository's root
Apache-2.0 license. GNUbg code and data are not linked into, bundled with, or
served by the active mock browser runtime. The generated native harness,
ABI-only smoke module, real GNUbg wasm module/data package, and compile objects
are ignored local test artifacts. If the GNUbg module is distributed, it must
be accompanied by the GPL license, applicable notices, and complete
corresponding source for the exact deployed build.
