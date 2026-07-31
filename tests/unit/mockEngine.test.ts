import { describe, expect, it } from "vitest";
import { chooseTurn, decideCube, hello, MOCK_ENGINE_METADATA } from "../../src/worker/mockEngine";
import { createChooseRequest, createCubeRequest } from "./fixtures";

describe("mock engine", () => {
  it("reports host-compatible capsule metadata", () => {
    const result = hello({
      supportedProtocolVersions: [1],
      host: { name: "Test host", version: "1" },
    });

    expect(result.selectedProtocolVersion).toBe(1);
    expect(result.metadata.engineId).toBe("gnubg-capsule");
    expect(result.metadata.runtime.transport).toBe("iframe");
    expect(result.metadata.capabilities.variations).toContain("standard");
    expect(result.metadata.capabilities.strengthPresets).toHaveLength(5);
    expect(MOCK_ENGINE_METADATA.license.spdxId).toBe("Apache-2.0");
  });

  it("deterministically chooses an opaque ID supplied by the host", () => {
    const request = createChooseRequest();
    const result = chooseTurn(request, performance.now());

    expect(result.positionRevision).toBe(request.position.revision);
    expect(result.chosenTurnId).toBe(request.legalTurns[0]?.id);
    expect(request.legalTurns.map(({ id }) => id)).toContain(
      result.chosenTurnId,
    );
    expect(result.stats.completed).toBe(true);
  });

  it("chooses no-double when it is legal", () => {
    const request = createCubeRequest();
    const result = decideCube(request, performance.now());

    expect(result.positionRevision).toBe(request.position.revision);
    expect(result.decision).toBe("no-double");
    expect(request.legalDecisions).toContain(result.decision);
  });

  it("falls back to the first legal cube action", () => {
    const request = { ...createCubeRequest(), legalDecisions: ["double"] } as const;
    expect(decideCube(request).decision).toBe("double");
  });
});
