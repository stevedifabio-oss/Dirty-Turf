export class RequestBodyTooLarge extends Error {}
export async function readLimitedJson(request: Request, maximumBytes: number): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > maximumBytes) throw new RequestBodyTooLarge();
  if (!request.body) throw new Error("Missing request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) { await reader.cancel(); throw new RequestBodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined));
}
