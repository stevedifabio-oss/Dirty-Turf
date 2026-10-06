const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const email = value => typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const memberStatuses = new Set(["active", "pending", "cancelled", "suspended"]);
const roles = new Set(["owner", "admin", "moderator", "member"]);
const grantStatuses = new Set(["active", "suspended", "revoked", "expired"]);
const grantSources = new Set(["import", "manual", "stripe_subscription", "stripe_payment"]);
const validTimestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function timestamp(value, label) {
  if (!validTimestamp(value)) {
    throw new Error(`${label} requires a timestamp with a timezone`);
  }
  return Date.parse(value);
}

function rows(value, label, max = 10_000) {
  if (!Array.isArray(value) || value.length > max || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`${label} requires a bounded complete array`);
  }
  return value;
}

function uniqueRows(value, label) {
  const result = rows(value, label);
  const ids = result.map(row => row.id);
  if (ids.some(id => !identifier(id)) || new Set(ids).size !== ids.length) throw new Error(`${label} requires unique record IDs`);
  return result;
}

function requireScope(value, scope, label) {
  if (!value || value.locationId !== scope.locationId || value.groupId !== scope.groupId) throw new Error(`${label} does not match the exact group scope`);
}

function scopedRows(value, label, communityId) {
  const result = uniqueRows(value, label);
  if (result.some(row => row.academy_community_id !== communityId)) throw new Error(`${label} contains a different Academy community`);
  return result;
}

function isActiveGrant(grant, now) {
  return grant.status === "active" && Date.parse(grant.starts_at) <= now && (grant.ends_at === null || Date.parse(grant.ends_at) > now);
}

/** Read-only snapshot reconciliation. Never creates accounts, access or invitations. */
export function auditMemberMigration(source, app, policy, options = {}) {
  const now = options.now ?? Date.now();
  const maxAgeHours = options.maxAgeHours ?? 24;
  if (!Number.isFinite(now) || !Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 168) throw new Error("Audit time and max age are invalid");
  const scope = options.scope;
  if (!identifier(scope?.locationId) || !identifier(scope?.groupId)) throw new Error("An explicit location and group scope is required");
  for (const [snapshot, label] of [[source, "Source roster"], [app, "App snapshot"], [policy, "Approved cohort"]]) {
    if (snapshot?.schemaVersion !== 1) throw new Error(`${label} requires schemaVersion 1`);
    requireScope(snapshot.scope, scope, label);
  }
  if (source.source !== "ghl-exact-community-roster" || source.coverage !== "complete") throw new Error("Source roster must be a complete exact Community roster, not CRM contacts");
  if (app.source !== "dirty-turf-member-readonly-export" || app.coverage !== "complete") throw new Error("App snapshot must declare complete read-only export coverage");
  const mapping = app.sourceMapping;
  if (!identifier(source.groupSlug) || mapping?.groupId !== scope.groupId || mapping.groupSlug !== source.groupSlug || mapping.databaseExternalGroupId !== source.groupSlug || mapping.externalProvider !== "highlevel" || !identifier(mapping.verificationReference)) throw new Error("App snapshot requires verified stable group ID to database slug mapping");
  const mappingVerifiedAt = timestamp(mapping.verifiedAt, "App snapshot mapping");
  if (mappingVerifiedAt > now || now - mappingVerifiedAt > maxAgeHours * 3_600_000) throw new Error("App snapshot mapping is stale or future dated");
  for (const [snapshot, label] of [[source, "Source roster"], [app, "App snapshot"]]) {
    const captured = timestamp(snapshot.capturedAt, label);
    if (captured > now || now - captured > maxAgeHours * 3_600_000) throw new Error(`${label} is stale or future dated`);
  }
  if (Math.abs(Date.parse(source.capturedAt) - Date.parse(app.capturedAt)) > 3_600_000) throw new Error("Source and app snapshots must be captured within one hour of each other");
  if (timestamp(policy.approvedAt, "Approved cohort") > now) throw new Error("Approved cohort is future dated");
  if (!identifier(policy.approvedBy)) throw new Error("Approved cohort requires an approval reference");
  if (!identifier(app.academyCommunityId)) throw new Error("App snapshot requires academyCommunityId");

  const sourceMembers = rows(source.members, "Source members", 5_000);
  if (!sourceMembers.length) throw new Error("An empty source roster cannot prove migration readiness");
  if (sourceMembers.some(row => !identifier(row.externalId) || (row.contactId !== null && !identifier(row.contactId)) || !memberStatuses.has(row.status) || !roles.has(row.role) || typeof row.email !== "string")) throw new Error("Source members require exact IDs, explicit status, role and email");
  const freeIds = policy.freeMemberExternalIds;
  if (!Array.isArray(freeIds) || freeIds.some(id => !identifier(id)) || new Set(freeIds).size !== freeIds.length) throw new Error("Approved cohort requires unique free member source IDs");
  const courseIds = policy.currentAcademyCourseIds;
  if (!Array.isArray(courseIds) || !courseIds.length || courseIds.some(id => !identifier(id)) || new Set(courseIds).size !== courseIds.length) throw new Error("Approved cohort requires the included current Academy course IDs");

  const communityId = app.academyCommunityId;
  const members = scopedRows(app.members, "App members", communityId);
  if (members.some(row => !memberStatuses.has(row.status) || !roles.has(row.role) || (row.user_id !== null && !identifier(row.user_id)))) throw new Error("App members have an invalid status, role or user ID");
  // Links use academy_member_id as their primary key in the existing database.
  const links = rows(app.links, "App member links");
  if (links.some(row => row.academy_community_id !== communityId || !identifier(row.academy_member_id) || row.external_provider !== "highlevel" || (row.external_member_id !== null && !identifier(row.external_member_id)) || (row.external_contact_id !== null && !identifier(row.external_contact_id)) || (!row.external_member_id && !row.external_contact_id))) throw new Error("App member links are invalid or outside the exact community");
  const invites = scopedRows(app.invites, "App invites", communityId);
  if (invites.some(row => !identifier(row.academy_member_id) || typeof row.email !== "string" || !["pending", "provisioned", "sent", "accepted", "failed", "cancelled"].includes(row.status) || (row.invited_user_id !== null && !identifier(row.invited_user_id)))) throw new Error("App invites are invalid");
  const users = uniqueRows(app.authUsers, "Auth identities");
  if (users.some(row => typeof row.email !== "string" || (row.email_confirmed_at !== null && !validTimestamp(row.email_confirmed_at)) || (row.banned_until !== null && !validTimestamp(row.banned_until)) || (row.deleted_at !== null && !validTimestamp(row.deleted_at)))) throw new Error("Auth identities require email confirmation, ban and deletion state");
  const courses = scopedRows(app.courses, "App courses", communityId);
  if (courses.some(course => !["draft", "published", "archived"].includes(course.status))) throw new Error("App courses require explicit publication status");
  if (courseIds.some(id => !courses.some(course => course.id === id))) throw new Error("An included Academy course is missing from the app snapshot");
  const grants = scopedRows(app.accessGrants, "App access grants", communityId);
  if (grants.some(row => !identifier(row.academy_member_id) || (row.course_id !== null && !courses.some(course => course.id === row.course_id)) || !grantStatuses.has(row.status) || !grantSources.has(row.source_type) || !validTimestamp(row.starts_at) || (row.ends_at !== null && (!validTimestamp(row.ends_at) || Date.parse(row.ends_at) <= Date.parse(row.starts_at))))) throw new Error("App access grants are invalid");
  const plans = scopedRows(app.billingPlans, "App billing plans", communityId);
  if (plans.some(row => !["membership", "course", "tool"].includes(row.offer_kind))) throw new Error("App billing plans require explicit offer kinds");
  const subscriptions = scopedRows(app.billingSubscriptions, "App billing subscriptions", communityId);
  if (subscriptions.some(row => !identifier(row.academy_member_id) || !plans.some(plan => plan.id === row.plan_id) || !["pending", "trialing", "active", "past_due", "paused", "cancelled", "expired"].includes(row.status))) throw new Error("App billing subscriptions are invalid");
  const memberById = new Map(members.map(member => [member.id, member]));
  if ([...links, ...invites, ...grants, ...subscriptions].some(row => !memberById.has(row.academy_member_id))) throw new Error("App snapshot contains a dangling member reference");

  const tally = (records, getKey) => {
    const result = new Map();
    for (const record of records) {
      const key = getKey(record);
      if (key) result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const sourceIdCounts = tally(sourceMembers, row => row.externalId);
  const sourceContactCounts = tally(sourceMembers, row => row.contactId);
  const sourceEmailCounts = tally(sourceMembers.filter(row => row.status === "active"), row => email(row.email));
  const authEmailCounts = tally(users, row => email(row.email));
  const linkedUserCounts = tally(members, row => row.user_id);
  const linkedSourceIds = new Set();
  const matchedAppIds = new Set();
  const freeCohort = new Set(freeIds);
  const results = sourceMembers.map(sourceMember => {
    const reasons = new Set();
    const normalizedEmail = email(sourceMember.email);
    if (sourceIdCounts.get(sourceMember.externalId) > 1) reasons.add("duplicate_source_member_id");
    if (sourceMember.contactId && sourceContactCounts.get(sourceMember.contactId) > 1) reasons.add("duplicate_source_contact_id");
    if (sourceMember.status === "active" && sourceEmailCounts.get(normalizedEmail) > 1) reasons.add("duplicate_source_email");
    const matches = links.filter(link => link.external_member_id === sourceMember.externalId || (sourceMember.contactId && link.external_contact_id === sourceMember.contactId));
    const matchedIds = [...new Set(matches.map(link => link.academy_member_id))];
    let member = matchedIds.length === 1 ? memberById.get(matchedIds[0]) : null;
    if (matches.length > 1 || matchedIds.length > 1) reasons.add("ambiguous_app_identity");
    if (matches.some(link => (link.external_member_id && link.external_member_id !== sourceMember.externalId) || (sourceMember.contactId && link.external_contact_id && link.external_contact_id !== sourceMember.contactId))) reasons.add("conflicting_source_identity");
    if (member) { matchedAppIds.add(member.id); linkedSourceIds.add(sourceMember.externalId); }
    const eligible = sourceMember.status === "active";
    const approvedFree = freeCohort.has(sourceMember.externalId);
    const memberGrants = member ? grants.filter(grant => grant.academy_member_id === member.id && isActiveGrant(grant, now)) : [];
    let accountReady = false;
    let accessReady = false;
    if (eligible) {
      if (!validEmail(normalizedEmail)) reasons.add("missing_or_invalid_email");
      if (!member) reasons.add("missing_app_member");
      if (member) {
        if (member.status !== "active") reasons.add("member_status_mismatch");
        if (member.role !== sourceMember.role) reasons.add("member_role_mismatch");
        const memberInvites = invites.filter(invite => invite.academy_member_id === member.id);
        const invite = memberInvites.length === 1 ? memberInvites[0] : null;
        const user = users.find(user => user.id === member.user_id);
        if (memberInvites.length !== 1) reasons.add("missing_or_ambiguous_invite");
        if (!user) reasons.add("missing_auth_user");
        if (authEmailCounts.get(normalizedEmail) > 1) reasons.add("duplicate_auth_email");
        if (linkedUserCounts.get(member.user_id) > 1) reasons.add("shared_auth_identity");
        if (user && email(user.email) !== normalizedEmail) reasons.add("auth_email_mismatch");
        if (user && (!user.email_confirmed_at || user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > now))) reasons.add("auth_sign_in_restricted");
        if (invite && (invite.status === "cancelled" || invite.invited_user_id !== member.user_id || email(invite.email) !== normalizedEmail)) reasons.add("invite_identity_mismatch");
        accountReady = reasons.size === 0;
        const requiredTargets = [null, ...courseIds];
        const includedCoursesPublished = courseIds.every(courseId => courses.find(course => course.id === courseId)?.status === "published");
        accessReady = member.status === "active" && includedCoursesPublished && requiredTargets.every(courseId => memberGrants.some(grant => grant.course_id === courseId));
        if (!includedCoursesPublished) reasons.add("included_course_not_published");
        if (!memberGrants.some(grant => grant.course_id === null)) reasons.add("missing_community_access");
        if (!courseIds.every(courseId => memberGrants.some(grant => grant.course_id === courseId))) reasons.add("missing_current_academy_access");
        if (approvedFree && !requiredTargets.every(courseId => memberGrants.some(grant => grant.course_id === courseId && ["import", "manual"].includes(grant.source_type) && grant.ends_at === null))) reasons.add("free_access_not_durable");
        if (!approvedFree && memberGrants.some(grant => grant.course_id === null && ["import", "manual"].includes(grant.source_type))) reasons.add("free_access_outside_approved_cohort");
        if (approvedFree && subscriptions.some(subscription => subscription.academy_member_id === member.id && ["active", "trialing", "past_due", "pending", "paused"].includes(subscription.status) && plans.find(plan => plan.id === subscription.plan_id)?.offer_kind === "membership")) reasons.add("free_member_membership_billing_review");
      }
    } else if (member?.status === "active") {
      // A source cancellation is a review item, never an instruction to revoke app access.
      reasons.add("restricted_source_member_active_in_app");
    }
    return { sourceMemberId: sourceMember.externalId, appMemberId: member?.id ?? null, email: normalizedEmail, sourceStatus: sourceMember.status, eligible, approvedFree, accountReady, accessReady, technicalReady: eligible && reasons.size === 0, reasons: [...reasons].sort() };
  });
  const importedMissing = members.filter(member => member.status === "active" && links.some(link => link.academy_member_id === member.id) && !matchedAppIds.has(member.id)).map(member => ({ appMemberId: member.id, reason: "active_imported_member_missing_from_roster", reviewOnly: true }));
  const missingApprovedIds = freeIds.filter(id => !linkedSourceIds.has(id));
  const eligibleResults = results.filter(row => row.eligible);
  const reasonCounts = {};
  for (const row of results) for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  if (importedMissing.length) reasonCounts.active_imported_member_missing_from_roster = importedMissing.length;
  if (missingApprovedIds.length) reasonCounts.approved_free_identity_requires_review = missingApprovedIds.length;
  const technicalReady = eligibleResults.length > 0 && eligibleResults.every(row => row.technicalReady) && results.every(row => !row.reasons.length) && !importedMissing.length && !missingApprovedIds.length;
  return {
    schemaVersion: 1, auditedAt: new Date(now).toISOString(), scope, sourceMapping: { ...mapping }, sourceCapturedAt: source.capturedAt, appCapturedAt: app.capturedAt, cohortApprovedAt: policy.approvedAt,
    technicalReady, rolloutAcceptance: "not_assessed", readOnly: true,
    counts: { sourceMembers: sourceMembers.length, eligibleMembers: eligibleResults.length, restrictedSourceMembers: results.length - eligibleResults.length, accountReady: eligibleResults.filter(row => row.accountReady).length, accessReady: eligibleResults.filter(row => row.accessReady).length, technicallyReadyMembers: eligibleResults.filter(row => row.technicalReady).length, membersNeedingReview: results.filter(row => row.reasons.length).length, approvedFreeMembers: freeIds.length, appOnlyMembersPreserved: members.filter(member => !links.some(link => link.academy_member_id === member.id)).length, missingSourceReviewOnly: importedMissing.length },
    reasonCounts, members: results, missingSourceReviewOnly: importedMissing, approvedFreeIdentityReviewOnly: missingApprovedIds,
    unassessed: ["source_billing_agreements", "installed_device_pilot", "community_content_acceptance", "announcement_delivery", "migration_campaign_sign_ins", "cutover_approval"],
  };
}
