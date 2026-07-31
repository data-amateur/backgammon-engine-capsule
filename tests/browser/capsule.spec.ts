import { expect, test } from "@playwright/test";

interface CapsuleTestResults {
  readonly hello: {
    readonly kind: string;
    readonly payload: {
      readonly selectedProtocolVersion: number;
      readonly metadata: {
        readonly engineId: string;
        readonly runtime: { readonly transport: string };
      };
    };
  };
  readonly choose: {
    readonly payload: {
      readonly positionRevision: string;
      readonly chosenTurnId: string;
    };
  };
  readonly cube: {
    readonly payload: {
      readonly positionRevision: string;
      readonly decision: string;
    };
  };
  readonly cancelledResultCount: number;
  readonly secondChannelMessageCount: number;
  readonly sandbox: string | null;
  readonly credentialless: boolean;
}

test("runs BEP v1 over one private port in an opaque sandbox", async ({
  page,
}) => {
  const workerUrls: string[] = [];
  const consoleErrors: string[] = [];
  page.on("worker", (worker) => workerUrls.push(worker.url()));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("done");

  const error = await page.evaluate(() =>
    Reflect.get(window, "capsuleTestError"),
  );
  expect(error).toBeUndefined();
  const results = await page.evaluate(
    () => Reflect.get(window, "capsuleTestResults") as CapsuleTestResults,
  );

  expect(results.hello.kind, JSON.stringify(results.hello)).toBe("bep.result");
  expect(results.hello.payload.selectedProtocolVersion).toBe(1);
  expect(results.hello.payload.metadata.engineId).toBe("gnubg-capsule");
  expect(results.hello.payload.metadata.runtime.transport).toBe("iframe");
  expect(results.choose.payload.positionRevision).toBe("position:checker");
  expect(["turn:first", "turn:second"]).toContain(
    results.choose.payload.chosenTurnId,
  );
  expect(results.cube.payload.positionRevision).toBe("position:cube");
  expect(["double", "no-double"]).toContain(results.cube.payload.decision);
  expect(results.cancelledResultCount).toBe(0);
  expect(results.secondChannelMessageCount).toBe(0);
  expect(results.sandbox).toBe("allow-scripts");
  expect(results.sandbox).not.toContain("allow-same-origin");
  expect(results.credentialless).toBe(true);
  expect(workerUrls.some((url) => url.startsWith("blob:"))).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("serves the capsule with restrictive security headers", async ({
  request,
}) => {
  const response = await request.get("http://localhost:4174/");
  expect(response.ok()).toBe(true);
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  expect(response.headers()["cross-origin-resource-policy"]).toBe(
    "cross-origin",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const csp = response.headers()["content-security-policy"];
  expect(csp).toContain("worker-src blob:");
  expect(csp).toContain("frame-ancestors http://localhost:3100");
  expect(csp).not.toContain("'unsafe-inline'");
});
