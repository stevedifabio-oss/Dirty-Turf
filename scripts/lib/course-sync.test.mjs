import {describe,it,expect} from 'vitest';
import {mapCourseSnapshot,courseSnapshotHash,secretMatches} from '../../supabase/functions/_shared/course-sync.mjs';
const config={locationId:'location-1',courseIds:['course-1']};
function fixture(){return {schemaVersion:1,source:'ghl-courses-v3',locationId:'location-1',completeForRequestedEndpoints:true,courses:[{product:{id:'course-1',title:'Course',description:'Description',posterImage:'https://example.com/image.jpg',customJs:'BAD'},categories:[{id:'parent',title:'Parent',sequenceNo:0,visibility:'published'},{id:'child',parentCategory:'parent',title:'Child',sequenceNo:0,visibility:'published'}],lessons:[{id:'lesson',categoryId:'child',title:'Lesson',description:'<h2>Training</h2><img src="https://example.com/media.jpg">',sequenceNo:0,visibility:'published',contentType:'video'}]}]};}
describe('atomic course snapshot mapping',()=>{
  it('maps hierarchy, rich HTML and media URLs without custom code or changing source IDs',()=>{
    const result=mapCourseSnapshot(fixture(),config);expect(result.courses[0].modules[1]).toMatchObject({external_id:'child',group_title:'Parent',sort_order:1});expect(result.courses[0].lessons[0]).toMatchObject({external_id:'lesson',module_external_id:'child',body:{html:expect.stringContaining('<img')}});expect(JSON.stringify(result)).not.toContain('BAD');
  });
  it('hides all descendants of an unpublished source category',()=>{const f=fixture();f.courses[0].categories[0].visibility='draft';expect(mapCourseSnapshot(f,config).courses[0].lessons[0].status).toBe('draft');});
  it('retains identity when moving a lesson and accepts complete source deletions',()=>{const f=fixture();f.courses[0].lessons[0].categoryId='parent';expect(mapCourseSnapshot(f,config).courses[0].lessons[0].external_id).toBe('lesson');f.courses[0].lessons=[];expect(mapCourseSnapshot(f,config).courses[0].lessons).toEqual([]);});
  it.each(['partial','wrong-location','unallowlisted','duplicate','missing-parent','cycle','bad-order','unknown-visibility','unsafe-cover','media','published-quiz'])('fails closed for %s',kind=>{const f=fixture(),c=f.courses[0];if(kind==='partial')f.completeForRequestedEndpoints=false;if(kind==='wrong-location')f.locationId='elsewhere';if(kind==='unallowlisted')c.product.id='other';if(kind==='duplicate')c.lessons.push({...c.lessons[0]});if(kind==='missing-parent')c.categories[1].parentCategory='missing';if(kind==='cycle')c.categories[0].parentCategory='child';if(kind==='bad-order')c.lessons[0].sequenceNo=-1;if(kind==='unknown-visibility')c.lessons[0].visibility='surprise';if(kind==='unsafe-cover')c.product.posterImage='javascript:alert(1)';if(kind==='media')c.lessons[0].contentId='unresolved';if(kind==='published-quiz')c.lessons[0].contentType='quiz';expect(()=>mapCourseSnapshot(f,config)).toThrow();});
  it('hashes canonical order identically despite shuffled API arrays and capture timestamps',async()=>{const a=fixture(),b=fixture();b.courses[0].categories.reverse();b.capturedAt='tomorrow';expect(await courseSnapshotHash(mapCourseSnapshot(a,config))).toBe(await courseSnapshotHash(mapCourseSnapshot(b,config)));b.courses[0].lessons[0].description='Updated';expect(await courseSnapshotHash(mapCourseSnapshot(a,config))).not.toBe(await courseSnapshotHash(mapCourseSnapshot(b,config)));});
  it('accepts only the configured strong scheduler secret',async()=>{const secret='a'.repeat(40);expect(await secretMatches(secret,secret)).toBe(true);expect(await secretMatches('b'.repeat(40),secret)).toBe(false);expect(await secretMatches('short','short')).toBe(false);expect(await secretMatches(null,secret)).toBe(false);});
});

describe('quiz detail adapter',()=>{
  it('maps supported ungraded single-choice quizzes from verified detail collections',()=>{
    const f=fixture(),l=f.courses[0].lessons[0];l.contentType='quiz';l.quizDetails={id:'quiz',lessonId:l.id,title:'Check',requiredPassingGrade:false,questions:[{title:'<p>What?</p>',sequenceNumber:1,questionType:'single',options:[{sequence:2,statement:'<p>B</p>'},{sequence:1,statement:'<p>A</p>'}]}]};
    const q=mapCourseSnapshot(f,config).courses[0].lessons[0];expect(q.lesson_type).toBe('quiz');expect(q.body.quiz.questions[0].options[0].html).toBe('<p>A</p>');
    l.quizDetails.requiredPassingGrade=true;expect(()=>mapCourseSnapshot(f,config)).toThrow(/answer keys/);
  });
});

describe('source inline media',()=>{
  it('tracks HTTPS inline video replacements for the native player and rejects empty published lessons',()=>{const f=fixture();f.courses[0].lessons[0].description='<video src="https://example.com/new.mp4"></video>';const l=mapCourseSnapshot(f,config).courses[0].lessons[0];expect(l.body.sourceVideoUrl).toBe('https://example.com/new.mp4');expect(l.lesson_type).toBe('video');f.courses[0].lessons[0].description='';expect(()=>mapCourseSnapshot(f,config)).toThrow(/Empty/);});
});
