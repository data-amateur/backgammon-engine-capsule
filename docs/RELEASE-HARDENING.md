# Stage 6 release hardening

The host's standalone measurement harness uses the real capsule through the
normal opaque iframe and BEP port. It measures representative completed
recordings, serial Quick work, selected Deeper work, loading/recovery, cache
writes/reopening, cancellation and replay responsiveness. The host repository's
`docs/browser-local-analysis-device-checks.md` describes physical iOS Safari and
Android Chrome runs, including a trusted local HTTPS setup.

Desktop measurements are regression evidence. They do not establish mobile
performance, total iPhone footprint, or safe product promises. Retain the
provisional deadlines until actual-device results are reviewed. No deployment
or publication is part of this change.

## Optional runtime memory sample

`hello.metadata.runtime` may now contain `wasmMemoryBytes` and
`wasmMemoryLimitBytes`. Both are positive integer byte counts; when both are
present the allocation cannot exceed the ceiling. The GNUbg Worker samples
`module.HEAPU8.byteLength` for each hello and reports its configured 128 MiB
maximum. A later handshake observes growth. The static approximate memory
estimate remains separate.

This additive BEP v1 diagnostic does not change analysis profiles, numerical
provenance or the native ABI. Older hosts ignore it and older capsules omit it.
The mirrored serialized contract includes valid and invalid samples. Samples
are taken at request boundaries, not during synchronous native evaluation.
Allocated linear memory is neither native bytes in use nor total browser memory.
The host must label unavailable observations instead of substituting estimates.

## Exact release and rollback

1. Fetch the approved branch and confirm a clean working tree. Activate the
   pinned toolchain; run `npm run verify`, the native/ABI sanitizer checks and
   `npm run test:gnubg-wasm`. Keep protocol, evaluator and browser results with
   the release record.
2. Set the real production parent/public origins, unique build ID and license
   URL, then run `npm run build`. Its clean-tree check, generated corresponding
   source, Worker notice, asset manifest and `verify:dist` must pass. Retain the
   entire verified distribution, including every immutable asset/source path,
   and `build/browser-assets-manifest.json` / source-bundle info.
3. Record repository commit, source-tree/archive/manifest hashes, engine build
   and assets identities, environment and phone reports. A verification build
   with a dirty snapshot is not the release artifact.
4. Stage the capsule first. Verify entry/root Worker revalidation, immutable
   hashed assets, JavaScript/WASM/data MIME, CORS/CORP, CSP/frame ancestors,
   opaque/credentialless transport, source download/hash and absence of runtime
   source downloads. No SharedArrayBuffer or cross-origin isolation is required.
5. Exercise the previous application's checker/cube gameplay against the staged
   new capsule, then the new host's analysis. The host compatibility runner pins
   a pre-analysis host and real pre-analysis/Quick-only capsules. A missing
   capability must be reported as unsupported, never silently replaced.
6. Release the capability-gated client only after compatibility and actual-device
   gates are accepted. Keep the old client and capsule distributions available.
   Roll back the client first; if necessary restore the matching capsule entry
   and root Worker afterward. Keep already published immutable assets and exact
   source archives accessible for existing tabs and notices.

Cache identity includes engine/build/assets and independent profile provenance.
The host rechecks cached results on Resume and closes invalidated previews;
rollback must not relabel an old result as a new evaluation or delete another
owner's records. Stop/dispose existing sessions and reload when changing a
served build. Re-run gameplay and the handshake after rollback.
