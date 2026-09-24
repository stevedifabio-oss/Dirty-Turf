import { describe, expect, it } from "vitest";
import { createCommunityPostPageGate } from "./communityPostPageGate";

describe("community post page requests", () => {
  it("ignores an old request after refresh without releasing a newer request", () => {
    const gate = createCommunityPostPageGate();
    expect(gate.begin()).toBeNull();
    gate.activate();
    const oldRequest = gate.begin();
    expect(oldRequest).not.toBeNull();
    expect(gate.begin()).toBeNull();

    gate.refresh();
    expect(gate.begin()).toBeNull();
    gate.activate();
    const currentRequest = gate.begin();
    expect(currentRequest).not.toBeNull();
    expect(gate.isCurrent(oldRequest!)).toBe(false);
    expect(gate.finish(oldRequest!)).toBe(false);
    expect(gate.begin()).toBeNull();
    expect(gate.isCurrent(currentRequest!)).toBe(true);
    expect(gate.finish(currentRequest!)).toBe(true);
    expect(gate.begin()).not.toBeNull();
  });
});
