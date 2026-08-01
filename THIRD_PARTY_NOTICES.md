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
under `third_party/gnubg/upstream/` for the forthcoming engine implementation.
GNUbg's program code is licensed under `GPL-3.0-or-later`; the complete GPL v3
text is available at `LICENSES/GPL-3.0-or-later.txt` and inside the signed
source archive.

Upstream project: <https://www.gnu.org/software/gnubg/>

Copyright belongs to the GNU Backgammon contributors identified by the
upstream source. The source archive also contains bundled assets and support
components with their own attribution or license notices. Those original
notices are retained inside the unmodified archive and must be audited before
deciding which files enter the deployed WASM build.

The capsule shell and GPL-free mock remain under the repository's root
Apache-2.0 license. No GNUbg code or data is currently linked into, bundled
with, or served by the default mock runtime. A future Worker that links GNUbg
will be distributed in compliance with GNUbg's GPL terms together with its
complete corresponding source.
