import { describe, expect, it } from "vitest";
import { importSortOrder } from "./import-order";

describe("Academy import order", () => {
  it("applies explicit source reorder and preserves zero", () => {
    expect(importSortOrder(0, 9, 2)).toBe(0);
    expect(importSortOrder(7, 0, 0)).toBe(7);
  });

  it("keeps existing order when a legacy partial batch has no source position", () => {
    expect(importSortOrder(undefined, 9, 0)).toBe(9);
    expect(importSortOrder(undefined, 0, 3)).toBe(0);
  });

  it("uses the legacy array position only for a new record", () => {
    expect(importSortOrder(undefined, undefined, 3)).toBe(3);
    expect(importSortOrder(undefined, null, 0)).toBe(0);
  });

  it.each([-1, 0.5, null, "1", NaN, Infinity, 2147483648])("rejects malformed source position %s", (value) => {
    expect(() => importSortOrder(value, 3, 0)).toThrow(/sortOrder/);
  });
});
