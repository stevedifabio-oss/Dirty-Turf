export const COMMUNITY_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const COMMUNITY_PHOTO_MAX_COUNT = 4;
export const COMMUNITY_PHOTO_REQUEST_MAX_BYTES = 17 * 1024 * 1024;
export const COMMUNITY_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type CommunityPhotoDescriptor = { sha256: string; mimeType: string; extension: string; size: number; width: number; height: number };
const invalid = () => new Error("Choose a valid JPG, PNG or WebP photo, up to 4 MB and 24 megapixels.");

/** Inspect bytes rather than trusting a browser-supplied MIME type or filename. */
export function inspectCommunityPhoto(bytes: Uint8Array, declaredType: string) {
  if (!bytes.length || bytes.length > COMMUNITY_PHOTO_MAX_BYTES) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mimeType = "", extension = "", width = 0, height = 0;
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)
      && view.getUint32(8) === 13 && String.fromCharCode(...bytes.slice(12,16)) === "IHDR") {
    mimeType = "image/png"; extension = "png"; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    mimeType = "image/jpeg"; extension = "jpg";
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) throw invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) throw invalid();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8,12)) === "WEBP" && view.getUint32(4,true) + 8 === bytes.length) {
    mimeType = "image/webp"; extension = "webp";
    const kind = String.fromCharCode(...bytes.slice(12,16));
    if (kind === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0xf) << 10);
    } else if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26,true) & 0x3fff; height = view.getUint16(28,true) & 0x3fff;
    }
  }
  if (!mimeType || declaredType.trim().toLowerCase() !== mimeType || !width || !height
      || width > 10000 || height > 10000 || width * height > 24_000_000) throw invalid();
  return { mimeType, extension, width, height, size: bytes.length };
}

export async function describeCommunityPhoto(file: File): Promise<CommunityPhotoDescriptor> {
  if (!file || file.size <= 0 || file.size > COMMUNITY_PHOTO_MAX_BYTES) throw invalid();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const details = inspectCommunityPhoto(bytes, file.type);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return { ...details, sha256: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2,"0")).join("") };
}

export async function readBoundedPhotoForm(request: Request): Promise<FormData> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > COMMUNITY_PHOTO_REQUEST_MAX_BYTES)) throw new Error("Photo upload is too large.");
  const reader = request.body?.getReader(); if (!reader) throw new Error("Choose photos to upload.");
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > COMMUNITY_PHOTO_REQUEST_MAX_BYTES) { await reader.cancel(); throw new Error("Photo upload is too large."); }
    parts.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const part of parts) { body.set(part,offset); offset += part.length; }
  return new Request(request.url,{ method:"POST", headers:{"content-type":request.headers.get("content-type") || ""}, body }).formData();
}
