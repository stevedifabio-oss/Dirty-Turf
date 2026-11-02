import type { TurfInspection } from "../domain";

export const inspectionChoices = {
  condition: { label: "Overall condition", options: ["poor", "fair", "good", "excellent"] },
  seams: { label: "Visible seams", options: ["none", "visible", "separating"] },
  debris: { label: "Debris", options: ["none", "light", "moderate", "heavy"] },
  infill: { label: "Infill level", options: ["low", "adequate", "high", "unsure"] },
} as const;
export const MAX_PROPERTY_PHOTOS = 6;
export const MAX_PROPERTY_PHOTO_BYTES = 20 * 1024 * 1024;
export const propertyPhotoTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
export const inspectionLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Validate at the save boundary as well as in the form. Unanswered is never “none”. */
export function normalizeInspection(value: unknown): TurfInspection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid turf inspection.");
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(inspectionChoices, key) && key !== "notes") throw new Error("Unknown inspection field.");
  }
  for (const [key, field] of Object.entries(inspectionChoices)) {
    const entry = input[key];
    if (entry === undefined || entry === "" || entry === null) continue;
    if (typeof entry !== "string" || !(field.options as readonly string[]).includes(entry)) throw new Error(`Choose a valid ${field.label.toLowerCase()}.`);
    result[key] = entry;
  }
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== "string" || input.notes.length > 2000) throw new Error("Inspection notes must be 2,000 characters or fewer.");
    if (input.notes.trim()) result.notes = input.notes.trim();
  }
  return result as TurfInspection;
}

export function validatePropertyPhotos(files: File[], existing = 0): void {
  if (existing + files.length > MAX_PROPERTY_PHOTOS) throw new Error("Add up to six property photos.");
  for (const file of files) {
    if (!propertyPhotoTypes.includes(file.type)) throw new Error("Choose JPEG, PNG, WebP, or HEIC photos.");
    if (!file.size || file.size > MAX_PROPERTY_PHOTO_BYTES) throw new Error("Each property photo must be between 1 byte and 20 MB.");
  }
}
