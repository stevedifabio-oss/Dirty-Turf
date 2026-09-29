import type { AdminMember } from "./adminBackend";

type MemberAccess = Pick<AdminMember, "status" | "userId" | "inviteEmail" | "inviteStatus">;

export function memberAccessPresentation(member: MemberAccess) {
  if (member.status === "cancelled") return { needsReview: false, label: "Membership cancelled" };
  if (member.status === "suspended") return { needsReview: false, label: "Access suspended" };
  if (!member.userId) return {
    needsReview: true,
    label: member.inviteEmail ? "Account setup pending" : "Sign-in email needed",
  };
  if (member.inviteStatus === "failed") return { needsReview: true, label: "Invitation needs attention" };
  if (member.inviteStatus === "sent") return { needsReview: false, label: "Sign-in email sent" };
  return { needsReview: false, label: member.inviteStatus === "accepted" ? "Account connected" : "Ready to sign in" };
}
