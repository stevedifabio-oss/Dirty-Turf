export type MemberAccessAction = "preview" | "provision" | "notify";

export type MemberAccessRow = {
  academyMemberId: string;
  inviteStatus: string;
  invitedUserId: string | null;
  memberStatus: string;
  memberUserId: string | null;
  email: string;
};

export type AuthUserIdentity = {
  id: string;
  email: string;
};

export function resolveMemberAccessAction(
  action: unknown,
  legacySend: unknown,
): MemberAccessAction {
  if (action === undefined) return legacySend === true ? "notify" : "preview";
  if (action === "preview" || action === "provision" || action === "notify") {
    return action;
  }
  throw new Error("action must be preview, provision, or notify");
}

export function normalizeMemberEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function summarizeMemberAccess(
  rows: MemberAccessRow[],
  enrolledMemberIds: Iterable<string>,
  authUsers: Iterable<AuthUserIdentity>,
) {
  const authByEmail = new Map<string, AuthUserIdentity>();
  for (const user of authUsers) {
    authByEmail.set(normalizeMemberEmail(user.email), user);
  }

  const enrolled = new Set(enrolledMemberIds);
  const eligibleRows = rows.filter((row) =>
    row.memberStatus === "active" && row.inviteStatus !== "cancelled"
  );
  const inviteByMember = new Map(
    eligibleRows.map((row) => [row.academyMemberId, row]),
  );
  const readyMembers = new Set<string>();
  const statusCounts: Record<string, number> = {};

  for (const row of rows) {
    statusCounts[row.inviteStatus] = (statusCounts[row.inviteStatus] ?? 0) + 1;
  }
  for (const row of eligibleRows) {
    const user = authByEmail.get(normalizeMemberEmail(row.email));
    if (user && row.invitedUserId === user.id && row.memberUserId === user.id) {
      readyMembers.add(row.academyMemberId);
    }
  }

  let enrolledReady = 0;
  let enrolledMissingInvite = 0;
  for (const memberId of enrolled) {
    if (!inviteByMember.has(memberId)) enrolledMissingInvite += 1;
    if (readyMembers.has(memberId)) enrolledReady += 1;
  }

  return {
    inviteRows: rows.length,
    eligibleMembers: eligibleRows.length,
    provisionedMembers: readyMembers.size,
    membersNotReady: Math.max(0, eligibleRows.length - readyMembers.size),
    allEligibleReady: eligibleRows.length > 0 &&
      readyMembers.size === eligibleRows.length,
    enrolledMembers: enrolled.size,
    enrolledReady,
    enrolledNotReady: Math.max(0, enrolled.size - enrolledReady),
    enrolledMissingInvite,
    allEnrolledReady: enrolled.size > 0 && enrolledReady === enrolled.size &&
      enrolledMissingInvite === 0,
    statusCounts,
  };
}
