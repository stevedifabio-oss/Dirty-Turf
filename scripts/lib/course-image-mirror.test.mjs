import { describe, it, expect, vi } from 'vitest';
import { allowedCourseImageUrl, lessonImageUrls, fetchCourseImage, mirrorCourseImages } from '../../supabase/functions/_shared/course-image-mirror.mjs';

const location = 'location-1';
const imageUrl = `https://assetsdrm.clientclub.net/images/courses/gcs_revex-membership-production/memberships/${location}/courses/photo.png?fmt=webp&rsz=fill`;
const webp = new Uint8Array([82,73,70,70,12,0,0,0,87,69,66,80,86,80,56,32]);
const response = () => new Response(webp, { headers: { 'content-type': 'image/webp' } });
const config = { academy_community_id: 'community', location_id: location, course_ids: ['source-course'] };

function database({ assets = [], courses, lessons, uploadFails = false, writeFails = false } = {}) {
  const state = {
    courses: courses ?? [{ id: 'course', academy_community_id: 'community', external_id: 'source-course', source_provider: 'highlevel', sync_owner: 'highlevel', status: 'published' }],
    course_lessons: lessons ?? [{ id: 'lesson', title: 'Setup', body: { html: `<img src="${imageUrl.replaceAll('&','&amp;')}"><img src="${imageUrl}">` }, sync_owner: 'highlevel', status: 'published', course_modules: { course_id: 'course', sync_owner: 'highlevel', source_visibility: 'published', source_archived_at: null } }],
    academy_assets: structuredClone(assets),
  };
  const valueAt = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
  const writes = [], uploads = new Map();
  function from(table) {
    const filters = []; let operation = 'select', values, range;
    const query = {
      select() { return query; }, order() { return query; },
      eq(key, value) { filters.push(row => valueAt(row, key) === value); return query; },
      is(key, value) { filters.push(row => (valueAt(row,key) ?? null) === value); return query; },
      in(key, values) { filters.push(row => values.includes(valueAt(row,key))); return query; },
      range(start,end) { range = [start,end]; return query; },
      update(value) { operation = 'update'; values = value; return query; },
      insert(value) { operation = 'insert'; values = value; return query; },
      async then(resolve, reject) {
        try {
          let selected = state[table].filter(row => filters.every(test => test(row)));
          if (range) selected = selected.slice(range[0], range[1]+1);
          if (operation !== 'select') {
            if (writeFails) return resolve({ data: null, error: { code: 'write_failed' } });
            writes.push({ table, operation, values: structuredClone(values) });
            if (operation === 'update') selected.forEach(row => Object.assign(row, values));
            else {
              if (state[table].some(row => row.external_id === values.external_id)) return resolve({ data: null, error: { code: '23505' } });
              state[table].push({ id: `asset-${state[table].length}`, ...structuredClone(values) });
            }
          }
          return resolve({ data: structuredClone(selected), error: null });
        } catch (error) { return reject(error); }
      },
    };
    return query;
  }
  return { state, writes, uploads, from, storage: { from(bucket) {
    expect(bucket).toBe('academy-assets');
    return { async upload(path, bytes, options) {
      if (uploadFails) return { error: { message: 'upload failed' } };
      uploads.set(path, { bytes: [...bytes], options }); return { error: null };
    } };
  } } };
}

describe('safe course image retrieval', () => {
  it('extracts actual image src once, with browser-decoded query entities', () => {
    expect(lessonImageUrls(`<img data-src="wrong" src='${imageUrl.replaceAll('&','&#38;')}' srcset="other"><img src="${imageUrl}"><a href="no">`)).toEqual([imageUrl]);
    expect(lessonImageUrls('<img data-src="wrong">')).toEqual([]);
  });
  it.each([
    'http://assetsdrm.clientclub.net/image.png', 'https://127.0.0.1/image.png', 'https://assetsdrm.clientclub.net.evil.test/image.png',
    imageUrl.replace(location, 'another-location'), imageUrl.replace('https://','https://secret@'), imageUrl.replace('.net/','.net:8443/'),
    imageUrl.replace('photo.png','..%2fother/photo.png'), imageUrl.replace('courses/photo','courses/../other/photo'),
  ])('does not fetch an unapproved URL %s', async url => {
    const fetchImpl = vi.fn(); expect(allowedCourseImageUrl(url, location)).toBe(false);
    await expect(fetchCourseImage(url, location, { fetchImpl })).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('fetches without credentials, refuses redirects, and verifies image bytes', async () => {
    const fetchImpl = vi.fn(response);
    const data = await fetchCourseImage(imageUrl, location, { fetchImpl });
    expect(data).toMatchObject({ mime: 'image/webp', extension: 'webp', hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fetchImpl.mock.calls[0][1]).toEqual({ redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it('rejects HTTP failures, disguised HTML, wrong image signatures, and SVG', async () => {
    for (const res of [new Response('bad',{status:403}), new Response('<html>bad</html>',{headers:{'content-type':'image/png'}}),new Response(webp,{headers:{'content-type':'image/png'}}),new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})]) {
      await expect(fetchCourseImage(imageUrl, location, { fetchImpl: async()=>res })).rejects.toThrow();
    }
  });
  it('enforces streaming size limits even without a content-length header', async () => {
    await expect(fetchCourseImage(imageUrl, location, { fetchImpl: response, maxBytes: 8 })).rejects.toThrow('image_too_large');
  });
  it('propagates aborted downloads and blocks declared oversized bodies', async () => {
    await expect(fetchCourseImage(imageUrl, location, { fetchImpl: async()=>{throw new DOMException('Timeout','TimeoutError');} })).rejects.toThrow();
    await expect(fetchCourseImage(imageUrl, location, { fetchImpl: async()=>new Response(webp,{headers:{'content-type':'image/webp','content-length':'9999999'}}) })).rejects.toThrow('image_too_large');
  });
});

describe('published lesson image copying', () => {
  it('reuses an uncopied catalog row, preserving source metadata and lesson content; second run does no work', async () => {
    const db = database({ assets: [{id:'existing',academy_community_id:'community',course_id:'course',lesson_id:'lesson',original_url:imageUrl,source_provider:'highlevel',storage_path:null,metadata:{original:true}}] });
    const before = JSON.stringify(db.state.course_lessons), fetchImpl = vi.fn(response);
    expect(await mirrorCourseImages(db,config,{fetchImpl})).toMatchObject({status:'complete',mirrored:1});
    expect(db.state.academy_assets).toHaveLength(1);
    expect(db.state.academy_assets[0]).toMatchObject({id:'existing',metadata:{original:true},original_url:imageUrl,storage_path:expect.stringMatching(/^community\/course\/lesson-images\/lesson\//)});
    expect(await mirrorCourseImages(db,config,{fetchImpl})).toMatchObject({mirrored:0,already_mirrored:1});
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(JSON.stringify(db.state.course_lessons)).toBe(before);
    expect(db.writes.every(write=>write.table==='academy_assets')).toBe(true);
  });
  it('creates a missing image row and tolerates overlapping workers without duplicates', async () => {
    const db = database();
    const results = await Promise.all([mirrorCourseImages(db,config,{fetchImpl:response}),mirrorCourseImages(db,config,{fetchImpl:response})]);
    expect(results.every(result=>result.failed===0)).toBe(true);
    expect(db.state.academy_assets).toHaveLength(1); expect(db.uploads.size).toBe(1);
  });
  it('does not touch other communities, unallowlisted courses, drafts, local overrides, or hidden modules', async () => {
    const initial = database(); const course = initial.state.courses[0], lesson = initial.state.course_lessons[0];
    const courses = [{...course,academy_community_id:'other'},{...course,external_id:'unallowlisted'},{...course,sync_owner:'local'},{...course,status:'draft'}];
    const fetchImpl = vi.fn(response);
    await mirrorCourseImages(database({courses}),config,{fetchImpl});
    const lessons = [{...lesson,status:'draft'},{...lesson,sync_owner:'local'},...[
      {source_visibility:'draft'},{source_archived_at:'2026-09-01'},{sync_owner:'local'},{course_id:'other'},
    ].map(change=>({...lesson,course_modules:{...lesson.course_modules,...change}}))];
    const db = database({lessons}); await mirrorCourseImages(db,config,{fetchImpl});
    expect(fetchImpl).not.toHaveBeenCalled(); expect(db.writes).toEqual([]);
  });
  it('preserves ambiguous and locally managed asset records', async () => {
    const asset = {id:'a',academy_community_id:'community',course_id:'course',lesson_id:'lesson',original_url:imageUrl,source_provider:'local'};
    const fetchImpl = vi.fn(response);
    for (const assets of [[asset],[{...asset,source_provider:'highlevel'},{...asset,id:'b',source_provider:'highlevel'}]]) {
      const db = database({assets}); expect(await mirrorCourseImages(db,config,{fetchImpl})).toMatchObject({unsupported:1,mirrored:0}); expect(db.writes).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('leaves failures safely retryable and never counts failed catalog writes as success', async () => {
    for (const failure of [{uploadFails:true},{writeFails:true}]) {
      const db = database(failure), before=JSON.stringify(db.state.course_lessons);
      expect(await mirrorCourseImages(db,config,{fetchImpl:response})).toMatchObject({status:'partial',mirrored:0,failed:1});
      expect(db.state.academy_assets).toEqual([]); expect(JSON.stringify(db.state.course_lessons)).toBe(before);
    }
  });
  it('bounds each run while retaining per-lesson ownership for repeated image URLs', async () => {
    const lesson = database().state.course_lessons[0];
    const db = database({lessons:[lesson,{...lesson,id:'second'}]});
    expect(await mirrorCourseImages(db,config,{fetchImpl:response,maxFiles:1,now:()=>0})).toMatchObject({mirrored:1,deferred:1});
    expect(await mirrorCourseImages(db,config,{fetchImpl:response,maxFiles:1,now:()=>0})).toMatchObject({mirrored:1,already_mirrored:1});
    expect(new Set(db.state.academy_assets.map(asset=>asset.lesson_id)).size).toBe(2);
    expect(db.uploads.size).toBe(2);
  });
  it('eventually retries every pending image when timeouts exhaust the budget', async () => {
    const lesson = database().state.course_lessons[0], attempted = new Set();
    const lessons = Array.from({length:8},(_,index)=>({...lesson,id:`lesson-${index}`,body:{html:`<img src="${imageUrl.replace('photo.png',`${index}.png`)}">`}}));
    const db = database({lessons}); let clock = 0;
    for (let window = 0; window < 8; window++) {
      clock = window * 300000;
      const report = await mirrorCourseImages(db,config,{now:()=>clock,fetchImpl:async url=>{attempted.add(url);clock+=8000;throw new Error('timeout');}});
      expect(report.failed).toBe(3); expect(report.deferred).toBe(5);
    }
    expect(attempted.size).toBe(8); expect(db.writes).toEqual([]);
  });
});
