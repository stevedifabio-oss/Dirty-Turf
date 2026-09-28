import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
// @ts-types="../_shared/ghl-course-reader.d.ts"
import { captureGhlCourses } from "../_shared/ghl-course-reader.mjs";
// @ts-types="../_shared/course-sync.d.ts"
import { mapCourseSnapshot, courseSnapshotHash, secretMatches } from "../_shared/course-sync.mjs";

const reply = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
Deno.serve(async request => {
  if(request.method !== 'POST') return reply({error:'Method not allowed'},405);
  if(!await secretMatches(request.headers.get('x-course-sync-secret'),Deno.env.get('GHL_COURSE_SYNC_SECRET'))) return reply({error:'Unauthorized'},401);
  if(Deno.env.get('GHL_COURSE_SYNC_ENABLED') !== 'true') return reply({status:'disabled'});
  const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const token=Deno.env.get('GHL_PRIVATE_INTEGRATION_TOKEN'), locationId=Deno.env.get('GHL_LOCATION_ID');
  if(!url || !key || !token || !locationId) return reply({error:'Sync not configured'},503);
  const admin=createClient(url,key,{auth:{persistSession:false}});
  // No caller-provided scope, URLs, credentials or snapshot accepted.
  const {data:configs,error}=await admin.from('academy_course_sync_configs').select('id').eq('enabled',true).eq('location_id',locationId).limit(10);
  if(error) return reply({error:'Unable to read sync configuration'},503);
  const results:Record<string,unknown>[]=[];
  for(const config of configs ?? []) {
    const {data:run,error:leaseError}=await admin.rpc('begin_academy_course_sync',{p_config_id:config.id});
    if(leaseError) {results.push({config_id:config.id,status:'failed',error_code:'lease_failed'});continue;}
    if(run.skipped){results.push({config_id:config.id,status:run.skipped});continue;}
    let phase='capture_failed';
    try {
      const snapshot=await captureGhlCourses({token,locationId,includeQuizDetails:true,manifest:{courses:run.course_ids.map((externalId:string)=>({externalId}))}});
      phase='validation_failed';
      const mapped=mapCourseSnapshot(snapshot,{locationId,courseIds:run.course_ids});
      const hash=await courseSnapshotHash(mapped);
      // GHL has no transactional snapshot token. Require two matching complete
      // reads before any update/retirement, rather than apply a moving hierarchy.
      const confirmation=await captureGhlCourses({token,locationId,includeQuizDetails:true,manifest:{courses:run.course_ids.map((externalId:string)=>({externalId}))}});
      if(await courseSnapshotHash(mapCourseSnapshot(confirmation,{locationId,courseIds:run.course_ids})) !== hash) throw new Error('Source changed during capture');
      phase='apply_failed';
      const {data,error:applyError}=await admin.rpc('apply_academy_course_sync',{p_run_id:run.run_id,p_snapshot:mapped,p_hash:hash});
      if(applyError) throw new Error('Apply failed');
      results.push({config_id:config.id,...data});
    } catch (error) {
      const reason=error instanceof Error?error.message:'';
      if(phase==='validation_failed') {
        if(reason.includes('Source media requires')) phase='media_details_unavailable';
        else if(reason.includes('answer keys or multiple-choice')) phase='quiz_format_requires_review';
        else if(reason.includes('Source changed during capture')) phase='source_changed_during_capture';
        else if(reason.includes('Empty published')) phase='empty_published_lesson';
      }
      // Raw provider responses/content/tokens never enter logs or a public error.
      await admin.rpc('fail_academy_course_sync',{p_run_id:run.run_id,p_error_code:phase});
      results.push({config_id:config.id,status:'failed',error_code:phase});
    }
  }
  return reply({results},results.some(r=>r.status==='failed')?503:200);
});
