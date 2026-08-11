import { expect, test } from "@playwright/test";

interface EngineMetadata {
  readonly engineId: string;
  readonly name: string;
  readonly version: string;
  readonly buildId: string;
  readonly license: {
    readonly spdxId: string;
    readonly sourceUrl?: string;
    readonly licenseUrl?: string;
  };
  readonly runtime: {
    readonly transport: string;
    readonly approximateDownloadBytes?: number;
    readonly approximateMemoryBytes?: number;
  };
  readonly capabilities: {
    readonly moveRanking: boolean;
  };
}

interface CapsuleTestResults {
  readonly hello: {
    readonly kind: string;
    readonly payload: {
      readonly selectedProtocolVersion: number;
      readonly metadata: EngineMetadata;
    };
  };
  readonly choose: {
    readonly payload: {
      readonly positionRevision: string;
      readonly chosenTurnId: string;
      readonly rankedTurns?: readonly {
        readonly turnId: string;
        readonly rank: number;
        readonly score?: number;
      }[];
    };
  };
  readonly cube: {
    readonly payload: {
      readonly positionRevision: string;
      readonly decision: string;
    };
  };
  readonly postCancelHello: {
    readonly kind: string;
    readonly payload: {
      readonly metadata: EngineMetadata;
    };
  };
  readonly cancelledResultCount: number;
  readonly secondChannelMessageCount: number;
  readonly sandbox: string | null;
  readonly credentialless: boolean;
}

interface AssetRetryResults {
  readonly firstHello: {
    readonly kind: string;
    readonly error: {
      readonly code: string;
      readonly retryable: boolean;
    };
  };
  readonly retryHello: {
    readonly kind: string;
    readonly payload: {
      readonly metadata: EngineMetadata;
    };
  };
  readonly sandbox: string | null;
  readonly credentialless: boolean;
}

const isEngineAsset = (url: string): boolean =>
  /\/gnubg-wasm\.(?:mjs|wasm|data)$/u.test(url);

test("runs real GNUbg over BEP v1 in an opaque sandbox", async ({
  page,
  request,
}) => {
  const workerUrls: string[] = [];
  const engineAssetUrls = new Set<string>();
  const consoleErrors: string[] = [];
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("request", (assetRequest) => {
    if (isEngineAsset(assetRequest.url())) {
      engineAssetUrls.add(assetRequest.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("done", {
    timeout: 15_000,
  });

  const error = await page.evaluate(() =>
    Reflect.get(window, "capsuleTestError"),
  );
  expect(error).toBeUndefined();
  const results = await page.evaluate(
    () => Reflect.get(window, "capsuleTestResults") as CapsuleTestResults,
  );

  expect(results.hello.kind, JSON.stringify(results.hello)).toBe("bep.result");
  expect(results.hello.payload.selectedProtocolVersion).toBe(1);
  expect(results.hello.payload.metadata).toMatchObject({
    engineId: "gnubg-capsule",
    name: "GNU Backgammon",
    version: "1.08.003",
    license: {
      spdxId: "GPL-3.0-or-later",
    },
    runtime: {
      transport: "iframe",
    },
    capabilities: {
      moveRanking: true,
    },
  });
  expect(results.hello.payload.metadata.buildId).not.toContain("mock");
  expect(
    results.hello.payload.metadata.runtime.approximateDownloadBytes,
  ).toBeGreaterThan(1_000_000);
  expect(
    results.hello.payload.metadata.runtime.approximateMemoryBytes,
  ).toBeGreaterThanOrEqual(32 * 1024 * 1024);

  // These exact fixtures are shared with the native/Node GNUbg goldens. The
  // preferred turn and cube action are deliberately not first, so the old
  // first-legal mock cannot satisfy this test.
  expect(results.choose.payload.positionRevision).toBe("position:checker");
  expect(results.choose.payload.chosenTurnId).toBe("turn:best");
  expect(results.choose.payload.rankedTurns?.[0]).toMatchObject({
    turnId: "turn:best",
    rank: 1,
  });
  expect(results.cube.payload.positionRevision).toBe("position:cube");
  expect(results.cube.payload.decision).toBe("double");

  expect(results.cancelledResultCount).toBe(0);
  expect(results.postCancelHello.kind).toBe("bep.result");
  expect(results.postCancelHello.payload.metadata.engineId).toBe(
    "gnubg-capsule",
  );
  expect(results.secondChannelMessageCount).toBe(0);
  expect(results.sandbox).toBe("allow-scripts");
  expect(results.sandbox).not.toContain("allow-same-origin");
  expect(results.credentialless).toBe(true);
  expect(workerUrls.filter((url) => url.startsWith("blob:")).length).toBeGreaterThanOrEqual(2);
  expect(consoleErrors).toEqual([]);

  const requestedAssets = [...engineAssetUrls];
  expect(requestedAssets.some((url) => url.endsWith(".mjs"))).toBe(true);
  expect(requestedAssets.some((url) => url.endsWith(".wasm"))).toBe(true);
  expect(requestedAssets.some((url) => url.endsWith(".data"))).toBe(true);

  for (const assetUrl of requestedAssets) {
    expect(new URL(assetUrl).pathname).toMatch(
      /^\/engines\/sha256-[0-9a-f]{64}\/gnubg-wasm\.(?:mjs|wasm|data)$/u,
    );
    const response = await request.get(assetUrl);
    expect(response.ok(), assetUrl).toBe(true);
    expect(response.headers()["access-control-allow-origin"], assetUrl).toBe(
      "*",
    );
    expect(response.headers()["cross-origin-resource-policy"], assetUrl).toBe(
      "cross-origin",
    );
    expect(response.headers()["cache-control"], assetUrl).toBe(
      "public, max-age=31536000, immutable",
    );
    const queryResponse = await request.get(`${assetUrl}?cache-probe=1`);
    expect(queryResponse.ok(), assetUrl).toBe(true);
    expect(queryResponse.headers()["cache-control"], assetUrl).toBe(
      "public, max-age=31536000, immutable",
    );
    if (assetUrl.endsWith(".mjs")) {
      expect(response.headers()["content-type"]).toContain("javascript");
    } else if (assetUrl.endsWith(".wasm")) {
      expect(response.headers()["content-type"]).toContain("application/wasm");
    } else {
      expect(response.headers()["content-type"]).not.toContain("text/html");
    }
  }

  const missingEngineAsset = new URL(
    "missing-engine-file.bin",
    requestedAssets[0],
  );
  const missingResponse = await request.get(missingEngineAsset.href);
  expect(missingResponse.headers()["cache-control"]).toBe("no-cache");
});

test("recreates a fresh module after a real WASM asset failure", async ({
  page,
}) => {
  const workerUrls: string[] = [];
  let blobWorkerGeneration = 0;
  let failedWasmRequests = 0;
  let continuedWasmRequests = 0;
  page.on("worker", (worker) => {
    const workerUrl = worker.url();
    workerUrls.push(workerUrl);
    if (workerUrl.startsWith("blob:")) {
      blobWorkerGeneration += 1;
    }
  });
  await page.route(/\/gnubg-wasm\.wasm$/u, async (route) => {
    // Emscripten can retry a failed streaming instantiation with another
    // fetch (and, depending on the runtime, an XHR fallback). Reject every
    // WASM request from the first module instance so it cannot recover in
    // place. The controller must create a fresh Worker before loading is
    // allowed to succeed.
    if (blobWorkerGeneration < 2) {
      failedWasmRequests += 1;
      await route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "intentional test failure",
      });
      return;
    }
    continuedWasmRequests += 1;
    await route.continue();
  });

  await page.goto("/?asset-retry=1");
  await expect(page.locator("#status")).toHaveText("done", {
    timeout: 15_000,
  });

  const error = await page.evaluate(() =>
    Reflect.get(window, "capsuleTestError"),
  );
  expect(error).toBeUndefined();
  const results = await page.evaluate(
    () => Reflect.get(window, "capsuleTestResults") as AssetRetryResults,
  );

  expect(results.firstHello.kind).toBe("bep.error");
  expect(results.firstHello.error).toMatchObject({
    code: "asset-load-failed",
    retryable: true,
  });
  expect(results.retryHello.kind).toBe("bep.result");
  expect(results.retryHello.payload.metadata).toMatchObject({
    engineId: "gnubg-capsule",
    version: "1.08.003",
    license: { spdxId: "GPL-3.0-or-later" },
  });
  expect(failedWasmRequests).toBeGreaterThan(0);
  expect(continuedWasmRequests).toBeGreaterThan(0);
  expect(workerUrls.filter((url) => url.startsWith("blob:")).length).toBeGreaterThanOrEqual(2);
  expect(results.sandbox).toBe("allow-scripts");
  expect(results.credentialless).toBe(true);
});

test("serves the capsule with restrictive security headers", async ({
  request,
}) => {
  const response = await request.get("http://localhost:4174/");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toBe("no-cache");
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  expect(response.headers()["cross-origin-resource-policy"]).toBe(
    "cross-origin",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("worker-src blob:");
  expect(csp).toContain("frame-ancestors http://localhost:3100");
  expect(csp).not.toContain("'unsafe-inline'");
  const scriptSources = csp
    .split(";")
    .map((directive) => directive.trim().split(/\s+/u))
    .find(([name]) => name === "script-src")
    ?.slice(1);
  expect(scriptSources).toContain("'wasm-unsafe-eval'");
  expect(scriptSources).not.toContain("'unsafe-eval'");
  const body = await response.text();
  expect(body).toContain(
    '<meta name="robots" content="noindex, nofollow" />',
  );
  expect(body).toContain("GNU Backgammon");
  expect(body).not.toContain("GPL-free deterministic mock");

  const worker = await request.get(
    "http://localhost:4174/gnubg-engine.worker.js",
  );
  expect(worker.ok()).toBe(true);
  expect(worker.headers()["cache-control"]).toBe("no-cache");

  const robots = await request.get("http://localhost:4174/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
});
