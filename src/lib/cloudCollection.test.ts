import { describe, expect, it } from "vitest";
import { cloudCollectionOrEmpty } from "./cloudCollection";

describe("cloud collection loading", () => {
  it("uses a successful cloud result, including an intentionally empty collection", () => {
    expect(cloudCollectionOrEmpty({ status: "fulfilled", value: ["course"] })).toEqual(["course"]);
    expect(cloudCollectionOrEmpty({ status: "fulfilled", value: [] })).toEqual([]);
  });

  it("does not substitute preview records after a cloud failure", () => {
    expect(cloudCollectionOrEmpty<string>({ status: "rejected", reason: new Error("network unavailable") })).toEqual([]);
  });
});
