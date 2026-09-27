export function validImportSortOrder(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}

export function importSortOrder(source: unknown, existing: unknown, fallback: number): number {
  if (source !== undefined) {
    if (!validImportSortOrder(source)) throw new Error("Invalid import sortOrder");
    return source;
  }
  // Older transport batches lack source positions. Keep their stored order
  // rather than replacing it with the position in a partial batch.
  if (validImportSortOrder(existing)) return existing;
  if (!validImportSortOrder(fallback)) throw new Error("Invalid import sortOrder fallback");
  return fallback;
}
