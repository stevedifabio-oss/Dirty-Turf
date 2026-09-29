const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function id(value) { if (typeof value !== 'string' || !idPattern.test(value)) throw new Error('Invalid source ID'); return value; }
function title(value) { if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new Error('Invalid source title'); return value; }
function order(value) { if (!Number.isInteger(value) || value < 0 || value > 100000) throw new Error('Invalid source ordering'); return value; }
function visibility(value) { if (!['published','draft','archived','locked','drip'].includes(value)) throw new Error('Unknown source visibility'); return value === 'published' ? 'published' : 'draft'; }
function html(value) { if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('Invalid source lesson content'); return value; }
function plain(value) { return html(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }
function url(value) { if (!value) return null; const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Unsafe source media URL'); return u.href; }

// No custom JS/CSS, arbitrary HTML execution, or guessed media endpoint. HTML is
// rendered by the application's existing sanitized lesson renderer.
export function mapCourseSnapshot(snapshot, { locationId, courseIds }) {
  if (snapshot?.schemaVersion !== 1 || snapshot.source !== 'ghl-courses-v3' || snapshot.completeForRequestedEndpoints !== true || snapshot.locationId !== locationId) throw new Error('Incomplete or mismatched course snapshot');
  if (!Array.isArray(courseIds) || !courseIds.length || new Set(courseIds).size !== courseIds.length || courseIds.some(x => !idPattern.test(x))) throw new Error('Explicit course allowlist required');
  if (!Array.isArray(snapshot.courses) || snapshot.courses.length !== courseIds.length || new Set(snapshot.courses.map(c => c.product?.id)).size !== courseIds.length) throw new Error('Snapshot allowlist mismatch');
  const courses = snapshot.courses.map(({product, categories, lessons}) => {
    if (!courseIds.includes(product?.id) || !Array.isArray(categories) || !Array.isArray(lessons)) throw new Error('Snapshot allowlist mismatch');
    if (categories.length > 1000 || lessons.length > 5000) throw new Error('Course snapshot exceeds size limit');
    const categoryMap = new Map(categories.map(c => [id(c.id),c]));
    if (categoryMap.size !== categories.length || new Set(lessons.map(l => id(l.id))).size !== lessons.length) throw new Error('Duplicate source IDs');
    const paths = new Map();
    function path(c, parents = new Set()) {
      if (parents.has(c.id)) throw new Error('Cyclic source categories');
      const next = new Set([...parents,c.id]);
      if (!c.parentCategory) return [c];
      const parent = categoryMap.get(c.parentCategory);
      if (!parent) throw new Error('Missing source parent category');
      return [...path(parent,next),c];
    }
    for (const c of categories) paths.set(c.id,path(c));
    const sorted = [...categories].sort((a,b) => {
      const left = paths.get(a.id), right = paths.get(b.id);
      for(let i=0;i<Math.min(left.length,right.length);i++) { const diff = order(left[i].sequenceNo)-order(right[i].sequenceNo) || left[i].id.localeCompare(right[i].id); if(diff) return diff; }
      return left.length-right.length;
    });
    const modules = sorted.map((c, index) => ({ external_id:id(c.id),title:title(c.title),sort_order:index,
      group_title:paths.get(c.id).slice(0,-1).map(p=>title(p.title)).join(' / ') || null,
      status:paths.get(c.id).every(p=>visibility(p.visibility)==='published') ? 'published':'draft',
      drip_after_days:order(c.dripDays ?? 0),
    }));
    const moduleMap = new Map(modules.map(m=>[m.external_id,m]));
    return {external_id:id(product.id),title:title(product.title),description:plain(product.description ?? ''),cover_url:url(product.posterImage),
      instructor_name:title(product.customizations?.instructorName || 'Dirty Turf Academy'),modules,
      lessons:lessons.map(l=>{
        const module = moduleMap.get(id(l.categoryId)); if(!module) throw new Error('Missing source lesson category');
        const status = visibility(l.visibility)==='published' && module.status==='published' ? 'published':'draft';
        // v3 collection does not include video/quiz details. Do not publish an
        // incomplete new media object or silently replace a known playable asset.
        if (l.contentId || l.metaData?.embedMediaId) throw new Error('Source media requires a supported detail adapter before syncing');
        if (!['video','quiz','text','audio'].includes(l.contentType)) throw new Error('Unsupported source lesson type');
        let quiz;
        if (l.contentType==='quiz' && l.quizDetails) {
          const q=l.quizDetails;
          if(q.lessonId!==l.id || typeof q.requiredPassingGrade!=='boolean' || !Array.isArray(q.questions)) throw new Error('Invalid quiz detail');
          if(status==='published' && (q.requiredPassingGrade || q.questions.some(x=>x.questionType!=='single'))) throw new Error('Published quiz requires answer keys or multiple-choice support not exposed by this adapter');
          quiz={name:title(q.title),requiresPassing:false,questions:[...q.questions].sort((a,b)=>order(a.sequenceNumber)-order(b.sequenceNumber)).map(question=>{
            if(!Array.isArray(question.options) || question.options.length<2) throw new Error('Invalid quiz options');
            return {prompt:{html:html(question.title)},options:[...question.options].sort((a,b)=>order(a.sequence)-order(b.sequence)).map(o=>({html:html(o.statement)})),explanation:{html:html(question.explanation ?? '')}};
          })};
          if(status==='published' && !quiz.questions.length) throw new Error('Empty published quiz');
        } else if(l.contentType==='quiz' && status==='published') throw new Error('Published quiz details are unavailable');
        const content=html(l.description ?? '');
        const mediaTag=content.match(/<(?:iframe|video|audio|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
        const sourceVideoUrl=mediaTag?url(mediaTag[1].replace(/&amp;/g,'&')):null;
        if(status==='published' && !quiz && !content.trim()) throw new Error('Empty published lesson requires review');
        return {external_id:id(l.id),module_external_id:module.external_id,title:title(l.title),sort_order:order(l.sequenceNo),
          status,lesson_type:l.contentType==='quiz'?'quiz':sourceVideoUrl?'video':'guide',body:{html:content,...(sourceVideoUrl?{sourceVideoUrl}:{}),...(quiz?{quiz}:{})}};
      }).sort((a,b)=>a.external_id.localeCompare(b.external_id)),
    };
  }).sort((a,b)=>a.external_id.localeCompare(b.external_id));
  return {version:1,location_id:locationId,course_ids:[...courseIds].sort(),complete:true,courses};
}

export async function courseSnapshotHash(snapshot) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot)));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function secretMatches(actual, expected) {
  if (!actual || !expected || expected.length < 32) return false;
  const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [a,b] = await Promise.all([hash(actual),hash(expected)]); let diff=0; for(let i=0;i<a.length;i++) diff |= a[i]^b[i]; return diff===0;
}
