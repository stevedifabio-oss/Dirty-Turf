import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse } from "../_shared/http.ts";
import {
  type MemberAccessAction,
  type MemberAccessRow,
  normalizeMemberEmail,
  resolveMemberAccessAction,
  summarizeMemberAccess,
} from "../_shared/member-access.ts";

type InviteRequest = {
  academyCommunityId: string;
  action?: MemberAccessAction;
  send?: boolean;
  limit?: number;
  redirectTo?: string;
  resend?: boolean;
};

type AcademyMemberRelation = {
  display_name: string;
  company_name: string;
  status: string;
  user_id: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  academy_member_id: string;
  status: string;
  invited_user_id: string | null;
  attempt_count: number;
  delivery_count: number;
  academy_members: AcademyMemberRelation | AcademyMemberRelation[] | null;
};

type ProcessResult = {
  inviteId: string;
  status: "provisioned" | "accepted" | "sent" | "failed";
};

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, {
      status: 405,
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    return jsonResponse(request, { error: "Server is not configured" }, {
      status: 503,
    });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(request, { error: "Authentication required" }, {
      status: 401,
    });
  }
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(
    authorization.slice(7),
  );
  if (userError || !userData.user) {
    return jsonResponse(request, { error: "Invalid session" }, { status: 401 });
  }

  let body: InviteRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(request, { error: "Invalid JSON body" }, {
      status: 400,
    });
  }
  if (!isUuid(body.academyCommunityId)) {
    return jsonResponse(request, { error: "academyCommunityId is required" }, {
      status: 422,
    });
  }
  if (
    !(await canManageAcademy(admin, userData.user.id, body.academyCommunityId))
  ) {
    return jsonResponse(request, {
      error: "Academy administrator access required",
    }, { status: 403 });
  }

  let action: MemberAccessAction;
  try {
    action = resolveMemberAccessAction(body.action, body.send);
  } catch (error) {
    return jsonResponse(request, { error: errorMessage(error) }, {
      status: 422,
    });
  }

  const limit = boundedLimit(body.limit, action === "notify" ? 25 : 50);
  const [inviteRows, enrolledMemberIds, existingUsers] = await Promise.all([
    loadInviteRows(admin, body.academyCommunityId),
    loadEnrolledMemberIds(admin, body.academyCommunityId),
    loadUsersByEmail(admin),
  ]);
  const initialSummary = summarizeMemberAccess(
    inviteRows.map(toAccessRow),
    enrolledMemberIds,
    authIdentities(existingUsers),
  );
  const candidates = selectCandidates(
    inviteRows,
    existingUsers,
    action,
    Boolean(body.resend),
  );

  if (action === "preview") {
    return jsonResponse(request, {
      dryRun: true,
      action,
      readyToProcess: candidates.length,
      summary: initialSummary,
    });
  }

  let redirectTo: string | undefined;
  if (action === "notify") {
    try {
      redirectTo = resolveInviteRedirect(body.redirectTo);
      if (!redirectTo) {
        throw new Error(
          "APP_URL or an allowed redirectTo is required before notification delivery",
        );
      }
    } catch (error) {
      return jsonResponse(request, { error: errorMessage(error) }, {
        status: 422,
      });
    }
  }

  const batch = candidates.slice(0, limit);
  const results: ProcessResult[] = [];
  for (const invite of batch) {
    try {
      const member = relatedMember(invite);
      if (!member) throw new Error("Academy member record is missing");
      const user = action === "notify"
        ? requireProvisionedUser(invite, member, existingUsers)
        : await ensureProvisionedUser(
          admin,
          invite,
          member,
          existingUsers,
        );
      if (action === "notify") {
        const { error } = await admin.auth.signInWithOtp({
          email: normalizeMemberEmail(invite.email),
          options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        await markInviteNotified(admin, invite, user.id);
        results.push({ inviteId: invite.id, status: "sent" });
      } else {
        const status = user.last_sign_in_at ? "accepted" : "provisioned";
        await markInviteProvisioned(admin, invite, user.id, status);
        results.push({ inviteId: invite.id, status });
      }
    } catch (error) {
      await markInviteFailed(admin, invite, action, error);
      results.push({ inviteId: invite.id, status: "failed" });
    }
  }

  const refreshedRows = await loadInviteRows(admin, body.academyCommunityId);
  const summary = summarizeMemberAccess(
    refreshedRows.map(toAccessRow),
    enrolledMemberIds,
    authIdentities(existingUsers),
  );
  return jsonResponse(request, {
    action,
    processed: results.length,
    provisioned: results.filter((item) => item.status === "provisioned").length,
    accepted: results.filter((item) => item.status === "accepted").length,
    sent: results.filter((item) => item.status === "sent").length,
    failed: results.filter((item) => item.status === "failed").length,
    remainingForAction: Math.max(0, candidates.length - results.length),
    summary,
    results,
  });
});

function selectCandidates(
  rows: InviteRow[],
  users: Map<string, User>,
  action: MemberAccessAction,
  resend: boolean,
) {
  return rows.filter((invite) => {
    const member = relatedMember(invite);
    if (
      !member || member.status !== "active" || invite.status === "cancelled"
    ) return false;
    if (action === "preview") return !isAccessReady(invite, member, users);
    if (action === "provision") {
      return !isAccessReady(invite, member, users) ||
        !["provisioned", "sent", "accepted"].includes(invite.status);
    }
    if (!isAccessReady(invite, member, users)) return false;
    if (invite.status === "accepted") return false;
    return resend || invite.status !== "sent";
  });
}

function requireProvisionedUser(
  invite: InviteRow,
  member: AcademyMemberRelation,
  users: Map<string, User>,
) {
  const user = users.get(normalizeMemberEmail(invite.email));
  if (
    !user || invite.invited_user_id !== user.id || member.user_id !== user.id
  ) {
    throw new Error("Academy member must be provisioned before notification");
  }
  return user;
}

async function ensureProvisionedUser(
  admin: SupabaseClient,
  invite: InviteRow,
  member: AcademyMemberRelation,
  users: Map<string, User>,
) {
  const email = normalizeMemberEmail(invite.email);
  if (!looksLikeEmail(email)) {
    throw new Error("Imported member email is invalid");
  }

  let user = users.get(email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name: member.display_name,
        company_name: member.company_name,
      },
    });
    if (error || !data.user) {
      throw error ?? new Error("Supabase did not return a provisioned user");
    }
    user = data.user;
    users.set(email, user);
  }

  if (member.user_id && member.user_id !== user.id) {
    throw new Error("Academy member is linked to a different auth user");
  }
  if (invite.invited_user_id && invite.invited_user_id !== user.id) {
    throw new Error("Academy invite is linked to a different auth user");
  }

  const { error: workspaceError } = await admin.rpc(
    "ensure_academy_user_workspace",
    {
      target_user_id: user.id,
      target_full_name: member.display_name,
      target_company_name: member.company_name,
    },
  );
  if (workspaceError) throw workspaceError;

  const { data: linkedMembers, error: memberError } = await admin.from(
    "academy_members",
  )
    .update({ user_id: user.id })
    .eq("id", invite.academy_member_id)
    .or(`user_id.is.null,user_id.eq.${user.id}`)
    .select("id");
  if (memberError) throw memberError;
  if (!linkedMembers?.length) {
    throw new Error("Academy member could not be linked safely");
  }
  return user;
}

async function markInviteProvisioned(
  admin: SupabaseClient,
  invite: InviteRow,
  userId: string,
  status: "provisioned" | "accepted",
) {
  const now = new Date().toISOString();
  const { error } = await admin.from("academy_member_invites").update({
    invited_user_id: userId,
    status,
    provisioned_at: now,
    accepted_at: status === "accepted" ? now : null,
    last_attempt_at: now,
    attempt_count: invite.attempt_count + 1,
    last_action: "provision",
    error_message: null,
  }).eq("id", invite.id);
  if (error) throw error;
}

async function markInviteNotified(
  admin: SupabaseClient,
  invite: InviteRow,
  userId: string,
) {
  const now = new Date().toISOString();
  const { error } = await admin.from("academy_member_invites").update({
    invited_user_id: userId,
    status: "sent",
    provisioned_at: now,
    invite_sent_at: now,
    last_attempt_at: now,
    attempt_count: invite.attempt_count + 1,
    delivery_count: invite.delivery_count + 1,
    last_action: "notify",
    error_message: null,
  }).eq("id", invite.id);
  if (error) throw error;
}

async function markInviteFailed(
  admin: SupabaseClient,
  invite: InviteRow,
  action: Exclude<MemberAccessAction, "preview">,
  error: unknown,
) {
  await admin.from("academy_member_invites").update({
    status: "failed",
    last_attempt_at: new Date().toISOString(),
    attempt_count: invite.attempt_count + 1,
    last_action: action,
    error_message: errorMessage(error).slice(0, 500),
  }).eq("id", invite.id);
}

async function loadInviteRows(admin: SupabaseClient, communityId: string) {
  const rows: InviteRow[] = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await admin.from("academy_member_invites")
      .select(
        "id,email,academy_member_id,status,invited_user_id,attempt_count,delivery_count,academy_members(display_name,company_name,status,user_id)",
      )
      .eq("academy_community_id", communityId)
      .order("created_at")
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as unknown as InviteRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function loadEnrolledMemberIds(
  admin: SupabaseClient,
  communityId: string,
) {
  const memberIds = new Set<string>();
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await admin.from("course_enrollments")
      .select("academy_member_id")
      .eq("academy_community_id", communityId)
      .in("status", ["active", "completed"])
      .range(offset, offset + 999);
    if (error) throw error;
    for (const row of data ?? []) memberIds.add(row.academy_member_id);
    if ((data?.length ?? 0) < 1000) break;
  }
  return memberIds;
}

async function canManageAcademy(
  admin: SupabaseClient,
  userId: string,
  communityId: string,
) {
  const { data: academyRole, error: academyError } = await admin.from(
    "academy_members",
  ).select("id")
    .eq("academy_community_id", communityId).eq("user_id", userId).eq(
      "status",
      "active",
    )
    .in("role", ["owner", "admin"]).limit(1).maybeSingle();
  if (academyError) throw academyError;
  if (academyRole) return true;

  const { data: community, error: communityError } = await admin.from(
    "academy_communities",
  )
    .select("owner_organization_id").eq("id", communityId).single();
  if (communityError || !community.owner_organization_id) return false;
  const { data: organizationRole, error: organizationError } = await admin.from(
    "organization_members",
  ).select("user_id")
    .eq("organization_id", community.owner_organization_id).eq(
      "user_id",
      userId,
    )
    .in("role", ["owner", "admin"]).limit(1).maybeSingle();
  if (organizationError) throw organizationError;
  return Boolean(organizationRole);
}

async function loadUsersByEmail(admin: SupabaseClient) {
  const users = new Map<string, User>();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) users.set(normalizeMemberEmail(user.email), user);
    }
    if (data.users.length < 1000) break;
  }
  return users;
}

function authIdentities(users: Map<string, User>) {
  return Array.from(users.values()).flatMap((user) =>
    user.email ? [{ id: user.id, email: user.email }] : []
  );
}

function toAccessRow(invite: InviteRow): MemberAccessRow {
  const member = relatedMember(invite);
  return {
    academyMemberId: invite.academy_member_id,
    inviteStatus: invite.status,
    invitedUserId: invite.invited_user_id,
    memberStatus: member?.status ?? "missing",
    memberUserId: member?.user_id ?? null,
    email: invite.email,
  };
}

function isAccessReady(
  invite: InviteRow,
  member: AcademyMemberRelation,
  users: Map<string, User>,
) {
  const user = users.get(normalizeMemberEmail(invite.email));
  return Boolean(
    user && invite.invited_user_id === user.id && member.user_id === user.id,
  );
}

function relatedMember(invite: InviteRow) {
  return Array.isArray(invite.academy_members)
    ? invite.academy_members[0]
    : invite.academy_members;
}

function boundedLimit(value: unknown, maximum: number) {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : maximum;
  return Math.min(maximum, Math.max(1, parsed));
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Member access operation failed";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function resolveInviteRedirect(requested?: string) {
  const appUrl = Deno.env.get("APP_URL")?.trim();
  const allowed = new Set<string>(["com.dirtyturf.academy://auth/callback"]);
  if (appUrl) allowed.add(normalizeRedirect(appUrl));
  for (
    const configured of (Deno.env.get("AUTH_REDIRECT_URLS") ?? "").split(",")
  ) {
    const value = configured.trim();
    if (value) allowed.add(normalizeRedirect(value));
  }

  if (!requested) return appUrl ? normalizeRedirect(appUrl) : undefined;
  const normalized = normalizeRedirect(requested);
  if (!allowed.has(normalized)) {
    throw new Error("Invite redirect is not in the server allowlist");
  }
  return normalized;
}

function normalizeRedirect(value: string) {
  const url = new URL(value);
  if (!url.protocol || url.username || url.password || url.hash) {
    throw new Error("Invite redirect is invalid");
  }
  return url.toString();
}
