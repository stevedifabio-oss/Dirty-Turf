import { auditMemberMigration } from "./member-migration-readiness.mjs";

const identifier = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const normalizeEmail = value => value.trim().toLocaleLowerCase("en-US");

const requirements = [
  { input: "source_roster", state: "required", requirement: "Fresh complete exact-group roster including restricted and historical members; verified pagination, exact source IDs, emails, statuses and roles. CRM contacts and visible-card inventories are insufficient." },
  { input: "app_snapshot", state: "required", requirement: "Fresh complete SELECT-only account, identity-link, Auth restriction, invitation, course, grant and billing-kind export with independently verified stable-group-ID to database-slug mapping." },
  { input: "approved_free_cohort", state: "required", requirement: "Separately reviewed source member ID list and current Academy course IDs, with actual approval reference and date. Never infer approval from current membership or existing grants." },
];

const executionGates = [
  "Resolve identity, role, access and billing exceptions; reconcile source billing agreements separately.",
  "Obtain separate authorization before any live account provisioning, access changes or messages.",
  "Refresh exact source and app evidence immediately before execution and run a fresh server preview.",
  "The existing provisioning endpoint selects the community-wide queue and has no member-ID filter. Reconcile its full queue to reviewed eligible members; a limit of 50 does not target this plan's candidates.",
  "Preview returns counts only and uses a different candidate predicate from provision. A matching preview count cannot prove the execution queue; independently reconcile the exact provision candidates or first implement and review exact member targeting.",
  "After any authorized account work, capture a new app export and rerun readiness before invitations.",
];

/** Local review material only. This module has no remote client or mutation path. */
export function prepareMemberMigration(source, app, cohort, options = {}) {
  const now = options.now ?? Date.now();
  const maxAgeHours = options.maxAgeHours ?? 24;
  if (!Number.isFinite(now) || !Number.isInteger(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 24) throw new Error("Preparation requires a valid time and a freshness window of 1-24 hours");
  if (!identifier(options.scope?.locationId) || !identifier(options.scope?.groupId)) throw new Error("Preparation requires an explicit exact location and group scope");
  if (!identifier(options.campaignId)) throw new Error("Preparation requires a safe campaign reference");
  const supplied = [source, app, cohort].filter(value => value !== undefined).length;
  if (supplied !== 0 && supplied !== 3) throw new Error("Preparation requires all three evidence inputs or none for blocked templates");
  const base = {
    schemaVersion: 1,
    kind: "member-migration-preparation",
    preparedAt: new Date(now).toISOString(),
    scope: { ...options.scope },
    readOnly: true,
    executable: false,
    liveActionsAuthorized: false,
    rolloutAcceptance: "not_assessed",
    maxSnapshotAgeHours: maxAgeHours,
    maximumSnapshotSeparationHours: 1,
    inputRequirements: structuredClone(requirements),
    launchTracker: {
      state: "template_only",
      campaign: { reference: options.campaignId, startedAt: null, state: "not_started" },
      members: [],
      columnGuide: ["sourceMemberId", "appMemberId", "email", "sourceStatus", "sourceRole", "eligible", "approvedFree", "accountReady", "accessReady", "technicalReady", "reviewReasons", "announcementDelivery", "firstSuccessfulCampaignSignInAt", "problem", "assignedOwner", "resolution"],
    },
    provisioningPlan: {
      state: "template_only",
      executable: false,
      liveActionsAuthorized: false,
      maximumAuthorizedProvisioningBatchSize: 50,
      requiresFreshServerPreview: true,
      reviewCandidates: [],
      reviewBatches: [],
      executionGates: [...executionGates],
    },
    unassessed: ["source_billing_agreements", "installed_device_pilot", "community_content_acceptance", "announcement_delivery", "migration_campaign_sign_ins", "cutover_approval"],
  };
  if (!supplied) {
    return {
      ...base,
      preparationState: "blocked_missing_inputs",
      technicalReadinessAssessed: false,
      technicalReady: false,
      counts: { sourceMembers: null, eligibleMembers: null, trackerRows: 0, provisioningReviewCandidates: 0 },
      blockingReasons: ["fresh_complete_exact_source_roster_required", "fresh_complete_app_snapshot_required", "separately_approved_free_cohort_required"],
      approvalWorksheet: { state: "unapproved_template_only", approvalReference: null, approvedAt: null, freeMemberSourceIds: null, includedCurrentAcademyCourseIds: null },
    };
  }

  // The same strict validator guards both the audit and all populated preparation rows.
  const audit = auditMemberMigration(source, app, cohort, { now, maxAgeHours, scope: options.scope });
  base.inputRequirements.forEach(item => { item.state = "validated_by_snapshot_audit"; });
  const trackerRows = audit.members.map((member, index) => ({
    sourceMemberId: member.sourceMemberId,
    appMemberId: member.appMemberId,
    email: member.email,
    sourceStatus: member.sourceStatus,
    sourceRole: source.members[index].role,
    eligible: member.eligible,
    approvedFree: member.approvedFree,
    accountReady: member.accountReady,
    accessReady: member.accessReady,
    technicalReady: member.technicalReady,
    reviewReasons: [...member.reasons],
    announcementDelivery: { state: "not_assessed", recordedAt: null, evidenceReference: null },
    firstSuccessfulCampaignSignInAt: null,
    campaignSignInEvidenceReference: null,
    problem: member.reasons.length ? member.reasons.join(", ") : null,
    assignedOwner: null,
    resolution: null,
  }));
  const reviewCandidates = audit.members.filter(member => {
    if (!member.eligible || !member.appMemberId || !member.accessReady || member.reasons.length !== 1 || member.reasons[0] !== "missing_auth_user") return false;
    const appMember = app.members.find(row => row.id === member.appMemberId);
    const invites = app.invites.filter(row => row.academy_member_id === member.appMemberId);
    // A dangling/reused identity must be repaired manually, never prepared as a new user.
    return appMember?.user_id === null && invites.length === 1 && invites[0].invited_user_id === null &&
      ["pending", "failed"].includes(invites[0].status) &&
      !app.authUsers.some(user => normalizeEmail(user.email) === member.email);
  }).map(member => ({ sourceMemberId: member.sourceMemberId, appMemberId: member.appMemberId, email: member.email, reviewOnly: true, proposedReview: "review_silent_account_provisioning", approvedForExecution: false }));
  const reviewBatches = [];
  for (let index = 0; index < reviewCandidates.length; index += 50) {
    reviewBatches.push({ reviewBatch: reviewBatches.length + 1, reviewOnly: true, approvedForExecution: false, sourceMemberIds: reviewCandidates.slice(index, index + 50).map(row => row.sourceMemberId) });
  }
  return {
    ...base,
    preparationState: audit.technicalReady ? "snapshot_ready_rollout_unassessed" : "snapshot_exceptions_require_review",
    technicalReadinessAssessed: true,
    technicalReady: audit.technicalReady,
    evidence: {
      sourceCapturedAt: audit.sourceCapturedAt,
      appCapturedAt: audit.appCapturedAt,
      sourceMapping: audit.sourceMapping,
      cohortApprovedAt: audit.cohortApprovedAt,
      cohortApprovalReference: cohort.approvedBy,
    },
    counts: { ...audit.counts, trackerRows: trackerRows.length, provisioningReviewCandidates: reviewCandidates.length },
    reasonCounts: audit.reasonCounts,
    missingSourceReviewOnly: audit.missingSourceReviewOnly,
    approvedFreeIdentityReviewOnly: audit.approvedFreeIdentityReviewOnly,
    launchTracker: { ...base.launchTracker, state: "snapshot_rows_campaign_unassessed", members: trackerRows },
    provisioningPlan: { ...base.provisioningPlan, state: "review_only", reviewCandidates, reviewBatches },
  };
}
