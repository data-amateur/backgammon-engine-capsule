import { describe, expect, it } from "vitest";
import { getTrustedBootstrap } from "../../src/capsule/bootstrap";
import { BEP_PROTOCOL, BEP_VERSION } from "../../src/protocol/types";

const parentSource = {} as MessageEventSource;
const allowedParentOrigins = new Set(["http://localhost:3000"]);

function createEvent(
  overrides: Partial<MessageEvent<unknown>> = {},
): MessageEvent<unknown> {
  const channel = new MessageChannel();
  return {
    source: parentSource,
    origin: "http://localhost:3000",
    ports: [channel.port1],
    data: {
      protocol: BEP_PROTOCOL,
      version: BEP_VERSION,
      sessionNonce: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "bep.channel-connect",
    },
    ...overrides,
  } as MessageEvent<unknown>;
}

describe("getTrustedBootstrap", () => {
  it("accepts exactly one valid private port from the configured parent", () => {
    const trusted = getTrustedBootstrap(createEvent(), {
      parentWindow: parentSource,
      allowedParentOrigins,
      alreadyConnected: false,
    });

    expect(trusted?.message.kind).toBe("bep.channel-connect");
    expect(trusted?.port).toBeInstanceOf(MessagePort);
    trusted?.port.close();
  });

  it.each([
    ["wrong source", { source: {} as MessageEventSource }],
    ["wrong origin", { origin: "http://localhost:3001" }],
    ["opaque sender", { origin: "null" }],
    ["no port", { ports: [] }],
    [
      "multiple ports",
      { ports: [new MessageChannel().port1, new MessageChannel().port1] },
    ],
    ["wrong protocol", { data: { protocol: "other" } }],
  ])("rejects %s", (_label, override) => {
    expect(
      getTrustedBootstrap(createEvent(override), {
        parentWindow: parentSource,
        allowedParentOrigins,
        alreadyConnected: false,
      }),
    ).toBeNull();
  });

  it("rejects every later bootstrap after one was accepted", () => {
    expect(
      getTrustedBootstrap(createEvent(), {
        parentWindow: parentSource,
        allowedParentOrigins,
        alreadyConnected: true,
      }),
    ).toBeNull();
  });
});
