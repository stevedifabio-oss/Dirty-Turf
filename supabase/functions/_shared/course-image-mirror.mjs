// Copy only published source-owned lesson images. Never rewrite lesson bodies,
// replace existing private assets, or change membership/progress records.
const MAX_BYTES = 6 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

function decodeAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()];
    if (named) return named;
    const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function lessonImageUrls(html) {
  if (typeof html !== 'string') return [];
  const urls = new Set();
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    // Match the actual src attribute, never data-src or srcset.
    const match = tag[0].match(/\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (match) urls.add(decodeAttribute(match[1] ?? match[2] ?? match[3]));
  }
  return [...urls];
}

export function allowedCourseImageUrl(value, locationId) {
  if (!ID.test(locationId) || typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (/%(?:2f|5c)/i.test(url.pathname) || decodeURIComponent(url.pathname).split('/').some(part => part === '.' || part === '..')) return false;
    const prefixes = {
      'assetsdrm.clientclub.net': `/images/courses/gcs_revex-membership-production/memberships/${locationId}/courses/`,
      'storage.googleapis.com': `/revex-membership-production/memberships/${locationId}/courses/`,
      'assets.cdn.filesafe.space': `/${locationId}/media/`,
    };
    const prefix = prefixes[url.hostname];
    return Boolean(prefix && url.pathname.startsWith(prefix) && url.pathname.length > prefix.length);
  } catch { return false; }
}

export async function sha256(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function imageFormat(bytes) {
  if (bytes.length < 12) return null;
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if ([137,80,78,71,13,10,26,10].every((byte,i) => bytes[i] === byte)) return { mime: 'image/png', extension: 'png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', extension: 'jpg' };
  if (['GIF87a','GIF89a'].includes(ascii(0,6))) return { mime: 'image/gif', extension: 'gif' };
  if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

export async function fetchCourseImage(url, locationId, { fetchImpl = fetch, maxBytes = MAX_BYTES, timeoutMs = 8000 } = {}) {
  if (!allowedCourseImageUrl(url, locationId)) throw new Error('image_origin_not_allowed');
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !response.body || !['image/png','image/jpeg','image/gif','image/webp'].includes(contentType)) {
    await response.body?.cancel();
    throw new Error('image_response_invalid');
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new Error('image_too_large');
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('image_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const format = imageFormat(bytes);
  if (!format || format.mime !== contentType) throw new Error('image_signature_invalid');
  return { bytes, ...format, hash: await sha256(bytes) };
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw new Error('image_catalog_unavailable');
  return data ?? [];
}

async function pages(makeQuery) {
  const all = [];
  for (let start = 0; ; start += 500) {
    const page = await rows(makeQuery().range(start, start + 499));
    all.push(...page);
    if (page.length < 500) return all;
    if (all.length >= 10000) throw new Error('image_catalog_limit');
  }
}

export async function mirrorCourseImages(admin, config, { fetchImpl = fetch, maxFiles = 8, budgetMs = 20000, now = Date.now } = {}) {
  const result = { status: 'complete', candidates: 0, mirrored: 0, already_mirrored: 0, unsupported: 0, failed: 0, deferred: 0 };
  const courses = await rows(admin.from('courses').select('id').eq('academy_community_id', config.academy_community_id)
    .in('external_id', config.course_ids).eq('source_provider', 'highlevel').eq('sync_owner', 'highlevel').eq('status', 'published'));
  const pending = [];
  for (const course of courses) {
    const lessons = await pages(() => admin.from('course_lessons').select('id,title,body,course_modules!inner(course_id,sync_owner,source_visibility,source_archived_at)')
      .eq('course_modules.course_id', course.id).eq('course_modules.sync_owner', 'highlevel')
      .eq('course_modules.source_visibility', 'published').is('course_modules.source_archived_at', null)
      .eq('sync_owner', 'highlevel').eq('status', 'published').order('id'));
    const assets = await pages(() => admin.from('academy_assets').select('id,lesson_id,original_url,storage_path,storage_bucket,source_provider')
      .eq('academy_community_id', config.academy_community_id).eq('course_id', course.id).order('id'));
    for (const lesson of lessons) {
      for (const url of lessonImageUrls(lesson.body?.html)) {
        const matches = assets.filter(asset => asset.lesson_id === lesson.id && asset.original_url === url);
        if (matches.length === 1 && matches[0].storage_path && matches[0].storage_bucket === 'academy-assets') {
          result.already_mirrored++; continue;
        }
        // Ambiguous/private/local assets are preserved for explicit review.
        if (matches.length > 1 || matches.some(asset => asset.storage_path || asset.source_provider !== 'highlevel')) {
          result.unsupported++; continue;
        }
        if (!allowedCourseImageUrl(url, config.location_id)) { result.unsupported++; continue; }
        pending.push({ course, lesson, url, existing: matches[0] });
      }
    }
  }
  result.candidates = pending.length;
  // Rotate each scheduled window so an unavailable image cannot starve later ones.
  const start = pending.length ? Math.floor(now() / 300000) % pending.length : 0;
  const queue = [...pending.slice(start), ...pending.slice(0, start)], deadline = now() + budgetMs;
  let attempted = 0;
  for (const item of queue) {
    if (attempted >= maxFiles || deadline - now() < 1000) break;
    attempted++;
    try {
      const image = await fetchCourseImage(item.url, config.location_id, { fetchImpl, timeoutMs: Math.min(8000, deadline - now()) });
      const path = `${config.academy_community_id}/${item.course.id}/lesson-images/${item.lesson.id}/${image.hash}.${image.extension}`;
      const { error: uploadError } = await admin.storage.from('academy-assets').upload(path, image.bytes, { contentType: image.mime, upsert: true });
      if (uploadError) throw new Error('image_upload_failed');
      // Content-addressed uploads are repeatable. Existing mappings are only
      // filled while still empty, even when two post-apply runs overlap.
      const storage = { storage_bucket: 'academy-assets', storage_path: path, mime_type: image.mime, byte_size: image.bytes.length, content_hash: image.hash };
      let saved;
      if (item.existing) {
        saved = await admin.from('academy_assets').update(storage).eq('id', item.existing.id)
          .eq('academy_community_id', config.academy_community_id).eq('course_id', item.course.id)
          .eq('lesson_id', item.lesson.id).eq('original_url', item.url).eq('source_provider', 'highlevel').is('storage_path', null);
      } else {
        const sourceHash = await sha256(new TextEncoder().encode(item.url));
        saved = await admin.from('academy_assets').insert({ ...storage, academy_community_id: config.academy_community_id,
          course_id: item.course.id, lesson_id: item.lesson.id, title: `${item.lesson.title} image`, asset_type: 'image',
          original_url: item.url, source_provider: 'highlevel', external_id: `auto-image:${item.lesson.id}:${sourceHash}`,
          metadata: { source: 'highlevel-lesson-image-sync' } });
      }
      if (saved.error) {
        if (saved.error.code !== '23505') throw new Error('image_catalog_write_failed');
        const concurrent = await rows(admin.from('academy_assets').select('storage_path,storage_bucket')
          .eq('academy_community_id', config.academy_community_id).eq('course_id', item.course.id)
          .eq('lesson_id', item.lesson.id).eq('original_url', item.url));
        if (concurrent.length !== 1 || !concurrent[0].storage_path || concurrent[0].storage_bucket !== 'academy-assets') throw new Error('image_catalog_conflict');
      }
      result.mirrored++;
    } catch { result.failed++; }
  }
  result.deferred = pending.length - attempted;
  if (result.failed || result.unsupported || result.deferred) result.status = 'partial';
  return result;
}
