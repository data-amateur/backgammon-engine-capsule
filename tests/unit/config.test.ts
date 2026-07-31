import { describe, expect, it } from "vitest";
import { getAllowedParentOrigins } from "../../src/capsule/config";

describe("parent origin configuration", () => {
  it("defaults to only the real local client origin", () => {
    expect([...getAllowedParentOrigins(undefined)]).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("normalizes a comma-separated exact allowlist", () => {
    expect(
      [...getAllowedParentOrigins("https://app.example.test/,http://localhost:3000")],
    ).toEqual(["https://app.example.test", "http://localhost:3000"]);
  });

  it.each(["*", "", "file:///tmp/capsule"])(
    "rejects unsafe configuration %j",
    (value) => {
      expect(() => getAllowedParentOrigins(value)).toThrow();
    },
  );

  it("rejects non-loopback HTTP parent origins", () => {
    expect(() =>
      getAllowedParentOrigins("http://app.example.test"),
    ).toThrow();
  });
});
