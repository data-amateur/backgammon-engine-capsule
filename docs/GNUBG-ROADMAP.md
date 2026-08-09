# GNUbg/WASM roadmap

Do not replace the mock until each remaining browser and release gate below is
complete.

0. **Completed.** Move this capsule into its independent public repository and
   keep the proprietary parent repository, bundles, and deployment free of
   capsule/GNUbg source and build artifacts.
1. **Completed.** Select and verify official GNUbg 1.08.003 from GNU/Savannah
   with GNU's official keyring.
2. **Completed.** Preserve the exact signed source, archive and signature,
   signer key, SHA-256 provenance, and license. See
   `third_party/gnubg/source-lock.json`.
3. **Completed.** Build the minimal native headless harness and golden tests.
   See `GNUBG-NATIVE.md`.
4. **Completed for the selected evaluator.** Exclude desktop UI, audio,
   Python, networking, arbitrary commands, and optional database features.
5. **Completed.** Provide typed initialization, candidate evaluation, five
   strengths, cache reset, disposal, and cube offer/response analysis over
   authoritative supplied actions.
6. **In progress.** The adapter translates absolute BEP-style positions,
   independently replays supplied legal turns, and matches GNUbg's generated
   legal set. The future BEP-to-WASM marshaller must additionally compare
   optional `resultingBoard` values; current host turns omit that field.
7. **Completed for the linked Node checkpoint.** ABI 1.0 freezes fixed-width
   fields, inline candidates, arena-relative offsets, and every structure size
   and offset. The bounded bridge, strict validation, terminal lifecycle,
   fake-adapter tests, native parity, recoverable initialization, small
   wasm-only compatibility surface, authenticated embedded match-equity data,
   reduced caches, and real Emscripten 6.0.5 checker/cube/lifecycle tests are in
   place. The module remains single-threaded and requires no
   `SharedArrayBuffer` or pthreads.
8. **Next.** Build the compute Worker loader and JavaScript/TypeScript arena
   marshaller. Fetch the module and data through explicit CORS-enabled URLs;
   never resolve them relative to the Blob Worker URL. Validate the runtime
   descriptor before initialization.
9. **Next.** Keep cancellation in the iframe controller, terminate synchronous
   compute, suppress stale output, and recreate a clean Worker/module. Add real
   browser asset-failure and Worker termination/recreation tests.
10. **Next.** Define measured candidate and time limits, especially for the
    two-ply maximum preset. Publish representative download, memory, startup,
    and decision measurements and honest BEP capabilities.
11. **Release gate.** Include complete corresponding source, every patch and
    build script, license text, network/data notices, checksums, and a
    reproducible archive for the exact deployed module. Run Firefox/WebKit
    portability testing and obtain legal review before production.

The iframe/Worker split is a technical isolation boundary, not a GPL
exception. The free-of-charge website and browser-local execution do not
remove source-distribution obligations. Keep GNUbg artifacts out of the
proprietary application and obtain legal review if proprietary licensing is
business-critical.
