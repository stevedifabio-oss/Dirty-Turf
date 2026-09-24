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
