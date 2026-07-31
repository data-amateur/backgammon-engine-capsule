import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerRuntime } from "../../src/capsule/workerRuntime";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkerRuntime startup", () => {
  it("does not create a Worker when disposed while its source body is loading", async () => {
    let resolveSource!: (source: string) => void;
    let markTextStarted!: () => void;
    const source = new Promise<string>((resolve) => {
      resolveSource = resolve;
    });
    const textStarted = new Promise<void>((resolve) => {
      markTextStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      ({
        ok: true,
        status: 200,
        text: () => {
          markTextStarted();
          return source;
        },
      }) as Response,
    );
    const workerMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Worker", workerMock);

    const runtime = new WorkerRuntime(
      "http://localhost:4174/mock-engine.worker.js",
      {
        onResult: vi.fn(),
        onError: vi.fn(),
        onFatal: vi.fn(),
      },
    );
    const startup = runtime.start();
    await textStarted;

    runtime.dispose();
    resolveSource("self.postMessage({ kind: 'capsule.worker-ready' });");

    await expect(startup).rejects.toThrow("Worker runtime is disposed");
    expect(workerMock).not.toHaveBeenCalled();
    const requestInit = fetchMock.mock.calls[0]?.[1] as
      | RequestInit
      | undefined;
    expect(requestInit?.signal?.aborted).toBe(true);
  });
});
