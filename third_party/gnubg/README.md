# GNU Backgammon upstream source

This directory preserves the exact authenticated GNU Backgammon release used
by the native harness and active WebAssembly evaluator. The signed archive is
not a runtime engine asset, but is preserved inside the complete corresponding-
source archive distributed with every browser build.

## Pinned release

- Version: `1.08.003`
- Official release tag: `release-1_08_003`
- Tagged commit: `b1582e2600095ed0e43256246ae5a244265b63cf`
- Program license: `GPL-3.0-or-later`
- Archive SHA-256:
  `6f7d969b13cfff786fba90ff8cc5e5d564b97f4f0aa69afe4f3838f18c445979`
- Signing-key fingerprint:
  `39FC 530C 20B9 B8C6 27E7 1BAC 973B 63D4 ECB3 B8BD`

The archive and detached signature came from the official
[GNU FTP directory](https://ftp.gnu.org/gnu/gnubg/). The signing key was
exported from the official [GNU keyring](https://ftp.gnu.org/gnu/gnu-keyring.gpg).
GNU's keyring identifies it as Philippe Michel's release key. `gpgv` reported
a good signature dated 2024-04-28.

GNU does not publish a separate checksum manifest for this release. The hashes
in `source-lock.json` were computed locally after signature verification; they
pin the exact files used by this project and are not described as
upstream-published checksums.

Run this from the repository root to verify file sizes, SHA-256 hashes, the
detached signature, and its exact fingerprint:

```bash
npm run verify:gnubg-source
```

The verifier requires `gpgv`. It uses only the checked-in release key and does
not read or modify the user's personal GnuPG keyring.

## Modification policy

Keep the signed archive byte-for-byte unchanged. Builds must extract it into
an ignored work directory and apply checked-in patches as a separate, ordered
step. Do not silently edit an extracted upstream tree and do not place
generated native objects, WASM, or Emscripten output in this directory.

The archive preserves GNUbg's complete upstream source and its bundled notices.
Some bundled data, fonts, or support components may carry their own notices;
audit the exact subset included in a deployed build and retain every applicable
notice.

No GNUbg source, weights, build output, or patches may be copied into the
proprietary RollBG repository or deployment.

## Native harness

Run `npm run test:gnubg-native` from the capsule repository root. It verifies
the archive again, replaces the ignored extraction with a fresh copy, applies
the ordered public patches, records each patch path and SHA-256 hash, builds a
headless evaluator harness, and runs mapping, legality, scoring, and cube
goldens. See `docs/GNUBG-NATIVE.md` for the exact source boundary and
prerequisites.

The current ordered patch set contains:

- `0001-race-bearoff-without-two-sided-db.patch`, which provides a
  deterministic one-sided-heuristic fallback when the optional two-sided
  bearoff database is absent;
- `0002-recoverable-engine-initialization.patch`, which makes evaluator
  initialization and constrained cache allocation fail cleanly and supports
  safe shutdown; and
- `0003-embed-kazaross-met-for-wasm.patch`, which adds the authenticated
  embedded match-equity-table path used by the GLib-free wasm build.

The authoritative application order, exact purposes, compatibility details,
authorship, and generated-table provenance are documented in
[the patch README](patches/README.md).

The native adapter and executable link GNUbg and are GPL-3.0-or-later. The
same adapter and arena ABI are compiled into the active browser WebAssembly
engine; generated native executables remain ignored local artifacts.

## Browser distribution and corresponding source

Before WebAssembly is built, `npm run build:source` creates and verifies a
deterministic complete source archive at:

```text
/sources/sha256-<archive-hash>/backgammon-engine-capsule-source.tar.gz
```

It includes the signed GNUbg archive, signature and key, patches, adapter and
Worker sources, scripts, locks, licenses, and notices. Its identity is bound
into `build-info.json`, the browser manifest, and `SOURCE.txt`; production
requires a clean Git tree. BEP advertises the URL, but runtime never fetches
the archive, so the normal engine payload remains about 1.37 MB uncompressed.
