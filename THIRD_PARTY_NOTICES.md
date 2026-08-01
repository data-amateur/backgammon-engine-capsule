# Third-party notices

## Current mock runtime

The browser runtime has no third-party production dependency. Vite and esbuild
compile the original project source into static JavaScript and CSS without
shipping their optional module-preload polyfill or another runtime library.

Development and test tools are listed in `package.json` and
`package-lock.json`; their packages include their respective license files.
Run `npm audit` and review the lockfile whenever these tools are updated.

## GNU Backgammon 1.08.003

The repository preserves an unmodified, signed GNU Backgammon source release
under `third_party/gnubg/upstream/`, then applies the ordered capsule-authored
compatibility patches under `third_party/gnubg/patches/` to build a minimal
native adapter and golden-test executable. GNUbg's program code, those patches,
and the linked adapter and tests are licensed under `GPL-3.0-or-later`; the
complete GPL v3 text is available at `LICENSES/GPL-3.0-or-later.txt` and inside
the signed source archive. Patch purpose, order, and authorship are recorded in
`third_party/gnubg/patches/README.md`.

Upstream project: <https://www.gnu.org/software/gnubg/>

Copyright belongs to the GNU Backgammon contributors identified by the
upstream source. The source archive also contains bundled assets and support
components with their own attribution or license notices. Those original
notices are retained inside the unmodified archive and must be audited before
deciding which files enter the deployed WASM build.

## GLib 2.0 (native harness only)

The local native golden-test executable obtains its GLib 2.0 compiler and
linker flags from `pkg-config` and dynamically links the system GLib library.
GLib is licensed `LGPL-2.1-or-later`; its source project is
<https://gitlab.gnome.org/GNOME/glib/>. GLib source or binaries are not
vendored, copied into `dist/`, or bundled with this repository. Audit the exact
runtime dependency and retain its applicable notices before distributing a
native binary.

The capsule shell and GPL-free mock remain under the repository's root
Apache-2.0 license. GNUbg code and data are not linked into, bundled with, or
served by the default mock browser runtime. The generated native harness is an
ignored local build and GPL-covered test artifact. A future Worker that links
GNUbg will be distributed in compliance with GNUbg's GPL terms together with
its complete corresponding source.
