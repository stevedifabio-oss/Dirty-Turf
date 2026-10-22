export const REMOVED_COMMUNITY_COMMENT_BODY = "[Removed by Academy moderator]";
export const COMMUNITY_CONTENT_REJECTED_MESSAGE = "This content cannot be posted under the Community Rules. Please revise it or contact support.";

export function isRemovedCommunityComment(body: string): boolean {
  return body.trim() === REMOVED_COMMUNITY_COMMENT_BODY;
}

export function communityWriteFailureMessage(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error && error.message === COMMUNITY_CONTENT_REJECTED_MESSAGE
    ? COMMUNITY_CONTENT_REJECTED_MESSAGE
    : fallback;
}

export function validReportReason(reason: string): boolean {
  const length = reason.trim().length;
  return length >= 3 && length <= 500;
}

export function nextBlockedMemberIds(ids: string[], memberId: string, blocked: boolean): string[] {
  return blocked ? [...new Set([...ids, memberId])] : ids.filter((id) => id !== memberId);
}

export function withoutMemberContent<T extends { authorCloudId?: string }>(items: T[], memberId: string): T[] {
  return items.filter((item) => item.authorCloudId !== memberId);
}
