import { normalizeMemberEmail } from "./member-access.ts";

export type MemberInviteOperation = "provision" | "notify";
export type MemberInviteIdentity = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  deleted_at?: string | null;
};
export type MemberInviteRecord = {
  id: string;
  academy_member_id: string;
  email: string;
  status: string;
  invited_user_id: string | null;
  attempt_count: number;
  delivery_count: number;
  updated_at: string;
  last_action?: string | null;
  error_message?: string | null;
  member: {
    id: string;
    academy_community_id: string;
    display_name: string;
    company_name: string;
    status: string;
    user_id: string | null;
    updated_at: string;
  } | null;
};
export type MemberInviteCandidate = {
  academyMemberId: string;
  inviteId: string;
  email: string;
  displayName: string;
  inviteStatus: string;
};
export type MemberInviteBlock = { academyMemberId: string; reason: string };
export const MEMBER_INVITE_PREVIEW_LIFETIME_MS = 10 * 60 * 1000;
export const MEMBER_INVITE_DELIVERY_REVIEW_PREFIX =
  "Delivery outcome requires review.";

export function memberInviteMaximum(action: MemberInviteOperation) {
  return action === "notify" ? 25 : 50;
}

export function parseMemberInviteSelection(
  value: unknown,
  action: MemberInviteOperation,
  required = false,
) {
  if (value === undefined && !required) return null;
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.length > memberInviteMaximum(action)
  ) {
    throw new Error(
      `Select 1-${
        memberInviteMaximum(action)
      } exact members and review a fresh preview before continuing.`,
    );
  }
  if (
    value.some((id) =>
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(id)
    ) || new Set(value.map((id) => id.toLowerCase())).size !== value.length
  ) {
    throw new Error("Member selection requires unique valid member IDs.");
  }
  return [...value].map((id) => id.toLowerCase()).sort();
}

export function planMemberInvites(input: {
  communityId: string;
  action: MemberInviteOperation;
  rows: MemberInviteRecord[];
  users: MemberInviteIdentity[];
  memberIdentities?: { id: string; user_id: string | null }[];
  academyMemberIds: string[] | null;
  resend: boolean;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const byEmail = new Map<string, MemberInviteIdentity[]>();
  for (const user of input.users) {
    if (!user.email) continue;
    const email = normalizeMemberEmail(user.email);
    byEmail.set(email, [...(byEmail.get(email) ?? []), user]);
  }
  const byMember = new Map<string, MemberInviteRecord[]>();
  const inviteEmails = new Map<string, number>();
  const memberUserIds = new Map<string, number>();
  for (const row of input.rows) {
    byMember.set(row.academy_member_id, [
      ...(byMember.get(row.academy_member_id) ?? []),
      row,
    ]);
    const email = normalizeMemberEmail(row.email);
    inviteEmails.set(email, (inviteEmails.get(email) ?? 0) + 1);
  }
  for (
    const member of input.memberIdentities ??
      input.rows.flatMap((row) => row.member ? [row.member] : [])
  ) {
    if (member.user_id) {
      memberUserIds.set(
        member.user_id,
        (memberUserIds.get(member.user_id) ?? 0) + 1,
      );
    }
  }
  function reason(row: MemberInviteRecord) {
    const member = row.member;
    const email = normalizeMemberEmail(row.email);
    if (
      !member || member.id !== row.academy_member_id ||
      member.academy_community_id !== input.communityId
    ) return "member_identity_requires_review";
    if (byMember.get(row.academy_member_id)?.length !== 1) {
      return "duplicate_member_invites";
    }
    if (member.status !== "active") return "member_is_not_active";
    if (row.status === "cancelled") return "invitation_is_cancelled";
    if (
      row.last_action === "notify" &&
      row.error_message?.startsWith(MEMBER_INVITE_DELIVERY_REVIEW_PREFIX) &&
      (input.action !== "notify" || !input.resend)
    ) return "email_delivery_outcome_requires_review";
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "invalid_member_email";
    }
    if (inviteEmails.get(email) !== 1) return "duplicate_member_email";
    const users = byEmail.get(email) ?? [];
    if (users.length > 1) return "duplicate_auth_email";
    const user = users[0];
    if (
      (member.user_id && member.user_id !== user?.id) ||
      (row.invited_user_id && row.invited_user_id !== user?.id)
    ) return "linked_auth_identity_mismatch";
    if (member.user_id && memberUserIds.get(member.user_id) !== 1) {
      return "shared_auth_identity";
    }
    if (
      user &&
      (!user.email_confirmed_at || user.deleted_at ||
        (user.banned_until &&
          (!Number.isFinite(Date.parse(user.banned_until)) ||
            Date.parse(user.banned_until) > now)))
    ) return "auth_sign_in_restricted";
    const ready = Boolean(
      user && row.invited_user_id === user.id && member.user_id === user.id,
    );
    if (input.action === "provision") {
      return ready && ["provisioned", "sent", "accepted"].includes(row.status)
        ? "account_already_prepared"
        : null;
    }
    if (!ready) return "account_must_be_prepared_first";
    if (row.status === "accepted") return "member_already_signed_in";
    if (row.status === "sent" && !input.resend) {
      return "sign_in_email_already_sent";
    }
    return null;
  }
  const candidates: MemberInviteCandidate[] = [];
  for (const row of input.rows) {
    if (reason(row)) continue;
    candidates.push({
      academyMemberId: row.academy_member_id,
      inviteId: row.id,
      email: normalizeMemberEmail(row.email),
      displayName: row.member!.display_name,
      inviteStatus: row.status,
    });
  }
  candidates.sort((a, b) => a.academyMemberId.localeCompare(b.academyMemberId));
  const selected: MemberInviteCandidate[] = [];
  const blocked: MemberInviteBlock[] = [];
  for (const id of input.academyMemberIds ?? []) {
    const rows = byMember.get(id) ?? [];
    const blockReason = rows.length !== 1
      ? (rows.length
        ? "duplicate_member_invites"
        : "member_not_in_community_invite_queue")
      : reason(rows[0]);
    if (blockReason) blocked.push({ academyMemberId: id, reason: blockReason });
    else selected.push(candidates.find((row) => row.academyMemberId === id)!);
  }
  const fingerprints = selected.map((candidate) => {
    const row = byMember.get(candidate.academyMemberId)![0];
    const auth = byEmail.get(candidate.email)?.[0];
    return {
      ...row,
      auth: auth
        ? {
          id: auth.id,
          email: normalizeMemberEmail(auth.email!),
          email_confirmed_at: auth.email_confirmed_at ?? null,
          banned_until: auth.banned_until ?? null,
          deleted_at: auth.deleted_at ?? null,
        }
        : null,
    };
  });
  return { candidates, selected, blocked, fingerprints };
}

export async function memberInviteStateHash(state: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

export async function createMemberInvitePreviewToken(
  secret: string,
  stateHash: string,
  now = Date.now(),
) {
  const expiresAt = now + MEMBER_INVITE_PREVIEW_LIFETIME_MS;
  const payload = `${now}.${expiresAt}.${stateHash}`;
  return {
    token: `${payload}.${await sign(secret, payload)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function verifyMemberInvitePreviewToken(
  secret: string,
  token: unknown,
  stateHash: string,
  now = Date.now(),
) {
  const stale =
    "Member selection changed or the preview expired. Review a fresh preview of these exact members before continuing.";
  if (typeof token !== "string" || token.length > 400) throw new Error(stale);
  const [issuedText, expiresText, hash, signature, extra] = token.split(".");
  const issued = Number(issuedText), expires = Number(expiresText);
  if (
    extra !== undefined || !/^\d+$/.test(issuedText ?? "") ||
    !/^\d+$/.test(expiresText ?? "") || !Number.isSafeInteger(issued) ||
    !Number.isSafeInteger(expires) || issued > now || expires <= now ||
    expires - issued !== MEMBER_INVITE_PREVIEW_LIFETIME_MS ||
    hash !== stateHash || !/^[a-f0-9]{64}$/.test(hash ?? "") ||
    !/^[a-f0-9]{64}$/.test(signature ?? "")
  ) throw new Error(stale);
  const key = await signingKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature.match(/.{2}/g)!, (value) => parseInt(value, 16)),
    new TextEncoder().encode(`${issuedText}.${expiresText}.${hash}`),
  );
  if (!valid) throw new Error(stale);
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
function signingKey(secret: string) {
  if (!secret) throw new Error("Member preview signing is not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
async function sign(secret: string, value: string) {
  return hex(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await signingKey(secret),
        new TextEncoder().encode(value),
      ),
    ),
  );
}
