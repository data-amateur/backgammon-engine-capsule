# GNUbg/WASM roadmap

Do not begin this phase until the mock passes the real private-host browser
integration.

0. Move this capsule into its independent public repository. Verify that the
   proprietary parent repository, its bundles, and its deployment contain no
   capsule or GNUbg source, patches, WASM, neural networks, or build artifacts.
   Do not add any GPL material before this separation is complete.
1. Select and verify an official signed GNUbg stable release from GNU/Savannah.
2. Vendor the complete exact source and record archive, signature, commit, and
   SHA-256 provenance.
3. Build a minimal native headless harness and golden tests first.
4. Exclude desktop UI, audio, database, Python, networking, and unrelated
   command features. Do not expose GNUbg's arbitrary command parser.
5. Expose a narrow typed C API for initialization, candidate evaluation, cube
   analysis, settings, reset, and disposal.
6. Translate the absolute BEP position and independently apply every supplied
   legal turn; current host turns do not include `resultingBoard`.
7. Pin Emscripten and start with single-threaded modularized output inside the
   existing Worker. Do not require SharedArrayBuffer/pthreads for v1.
8. Fetch WASM/networks through explicit CORS-enabled URLs; do not resolve them
   relative to the Blob Worker URL.
9. If synchronous native search cannot be interrupted, keep cancellation in
   the iframe controller, terminate the compute Worker, suppress stale output,
   and recreate a clean runtime.
10. Publish measured download/memory/startup/decision figures and honest BEP
    capabilities.
11. Include complete corresponding source, every patch/build script, license
    text, dependency/network notices, checksums, and a reproducible release
    archive for the exact deployed WASM.

The iframe/Worker split is a technical isolation boundary, not a GPL exception.
The free-of-charge website and browser-local execution do not remove source
distribution obligations. Keep GNUbg artifacts out of the proprietary
application and obtain legal review before production if proprietary licensing
is business-critical.
