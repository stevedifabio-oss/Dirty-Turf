import { describe, expect, it } from "vitest";
import { academyImportGrantWindow } from "./import-access";

const now = new Date("2026-09-18T12:00:00.000Z");

describe("Academy import access grants", () => {
  it("keeps active and completed source access active", () => {
    expect(academyImportGrantWindow("active", "2026-01-01T00:00:00Z", undefined, now)).toMatchObject({
      status: "active",
      endsAt: null,
    });
    expect(academyImportGrantWindow("completed", undefined, "2027-01-01T00:00:00Z", now).status).toBe("active");
  });

  it("expires an active source membership when its access window has ended", () => {
    expect(academyImportGrantWindow(
      "active",
      "2026-01-01T00:00:00Z",
      "2026-09-01T00:00:00Z",
      now,
    )).toMatchObject({
      status: "expired",
      endsAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("maps pending, suspended, and cancelled source records safely", () => {
    expect(academyImportGrantWindow("pending", undefined, undefined, now).status).toBe("suspended");
    expect(academyImportGrantWindow("suspended", undefined, undefined, now).status).toBe("suspended");
    expect(academyImportGrantWindow("cancelled", undefined, undefined, now).status).toBe("revoked");
  });

  it("drops an invalid end window instead of violating the database constraint", () => {
    expect(academyImportGrantWindow(
      "expired",
      "2026-09-10T00:00:00Z",
      "2026-09-01T00:00:00Z",
      now,
    ).endsAt).toBeNull();
  });
});
