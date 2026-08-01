# GNU Backgammon upstream source

This directory preserves the exact authenticated GNU Backgammon release that
will be used for the future native and WebAssembly engine builds. It is not
part of the current mock Worker build and is not copied into `dist/`.

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

Keep the signed archive byte-for-byte unchanged. Future builds must extract it
into an ignored work directory and apply checked-in patches as a separate,
ordered step. Do not silently edit an extracted upstream tree and do not place
generated native objects, WASM, or Emscripten output in this directory.

The archive preserves GNUbg's complete upstream source and its bundled notices.
Some bundled data, fonts, or support components may carry their own notices;
audit the exact subset included in a deployed build and retain every applicable
notice.

No GNUbg source, weights, build output, or patches may be copied into the
proprietary Backgammon Light repository or deployment.

## Native checkpoint

Run `npm run test:gnubg-native` from the capsule repository root. It verifies
the archive again, replaces the ignored extraction with a fresh copy, builds a
headless evaluator harness, and runs mapping, legality, and scoring fixtures.
See `docs/GNUBG-NATIVE.md` for the exact source boundary and prerequisites.

The native adapter and executable link GNUbg and are GPL-3.0-or-later. The
default browser mock remains separate and does not include these generated
artifacts.
