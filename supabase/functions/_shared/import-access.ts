export type AcademyImportGrantStatus =
  | "active"
  | "suspended"
  | "revoked"
  | "expired";

type GrantWindow = {
  status: AcademyImportGrantStatus;
  startsAt: string;
  endsAt: string | null;
};

export function academyImportGrantWindow(
  sourceStatus: string,
  startsAt?: string,
  endsAt?: string,
  now = new Date(),
): GrantWindow {
  const normalizedStart = validDate(startsAt) ?? now;
  const parsedEnd = validDate(endsAt);
  const normalizedEnd = parsedEnd && parsedEnd > normalizedStart
    ? parsedEnd.toISOString()
    : null;

  let status: AcademyImportGrantStatus;
  if (sourceStatus === "active" || sourceStatus === "completed") {
    status = parsedEnd && parsedEnd <= now ? "expired" : "active";
  } else if (sourceStatus === "expired") {
    status = "expired";
  } else if (sourceStatus === "pending" || sourceStatus === "suspended") {
    status = "suspended";
  } else {
    status = "revoked";
  }

  return {
    status,
    startsAt: normalizedStart.toISOString(),
    endsAt: normalizedEnd,
  };
}

function validDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
