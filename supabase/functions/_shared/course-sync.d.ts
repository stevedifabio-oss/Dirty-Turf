export function mapCourseSnapshot(snapshot: unknown, config: {locationId: string;courseIds: string[]}): Record<string,unknown>;
export function courseSnapshotHash(snapshot: unknown): Promise<string>;
export function secretMatches(actual: string|null|undefined, expected: string|undefined): Promise<boolean>;
