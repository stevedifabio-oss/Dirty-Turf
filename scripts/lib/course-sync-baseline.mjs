import {createHash} from 'node:crypto';
const fields={courses:['id','academy_community_id','external_id','source_provider','title','description','cover_url','instructor_name','status'],course_modules:['id','course_id','external_id','title','sort_order','group_title','drip_after_days'],course_lessons:['id','module_id','external_id','title','sort_order','status','body','video_url','resources','lesson_type']};
const select=(row,keys)=>Object.fromEntries(keys.map(k=>[k,row[k]??null]));
const stable=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);
const quote=s=>"'"+s.replaceAll("'","''")+"'";

// Pure review preparation; never connects to or mutates a hosted database.
export function prepareCourseSyncBaseline(database,snapshot,originalImport){
  if(!database?.community_id || !Array.isArray(database.courses) || !Array.isArray(database.modules) || !Array.isArray(database.lessons)) throw new Error('Complete protected database export required');
  const rows=[],conflicts=[];
  const originalByTable={courses:new Map(),course_modules:new Map(),course_lessons:new Map()};
  for(const c of originalImport?.courses ?? []){
    originalByTable.courses.set(c.externalId,{title:c.title,description:c.description??'',cover_url:c.coverUrl??null,instructor_name:c.instructorName??'Dirty Turf Academy',status:c.status??'published'});
    for(const m of c.modules??[]){
      originalByTable.course_modules.set(m.externalId,{title:m.title,group_title:m.groupTitle??null,drip_after_days:m.dripAfterDays??null,...(m.sortOrder!==undefined?{sort_order:m.sortOrder}:{})});
      for(const l of m.lessons??[])originalByTable.course_lessons.set(l.externalId,{title:l.title,body:l.body??{},video_url:l.videoUrl??null,resources:l.resources??[],lesson_type:l.type??'video',status:l.status??'published',...(l.sortOrder!==undefined?{sort_order:l.sortOrder}:{})});
    }
  }
  function record(table,row,wanted){
    const difference=Object.keys(wanted).filter(k=>stable(row[k]??null)!==stable(wanted[k]??null));
    const original=originalByTable[table].get(row.external_id);
    const localChanges=original?Object.keys(original).filter(k=>stable(row[k]??null)!==stable(original[k]??null)):[];
    const item={original_import_verified:Boolean(original)&&!localChanges.length,local_change_fields:localChanges,table,id:row.id,external_id:row.external_id,current:select(row,fields[table]),source:wanted,different_fields:difference};
    rows.push(item);if(difference.length&&!item.original_import_verified)conflicts.push(item);
  }
  for(const source of snapshot.courses){
    const matches=database.courses.filter(c=>c.academy_community_id===database.community_id && c.external_id===source.external_id && c.source_provider==='highlevel');
    if(matches.length!==1) throw new Error('Each allowlisted course needs one existing imported course');
    const course=matches[0];record('courses',course,select(source,['title','description','cover_url','instructor_name']));
    const modules=database.modules.filter(m=>m.course_id===course.id);
    for(const sourceModule of source.modules){const matches=modules.filter(m=>m.external_id===sourceModule.external_id);if(matches.length>1)throw new Error('Duplicate imported module');if(!matches.length)continue;const row=matches[0];if(!row.source_import_batch_id)continue;record('course_modules',row,select(sourceModule,['title','sort_order','group_title','drip_after_days']));}
    for(const row of modules.filter(m=>m.source_import_batch_id && !source.modules.some(sm=>sm.external_id===m.external_id))) record('course_modules',row,{retirement:'Absent source category; archive after stable-ID lesson moves'});
    for(const sourceLesson of source.lessons){const matches=database.lessons.filter(l=>modules.some(m=>m.id===l.module_id)&&l.external_id===sourceLesson.external_id);if(matches.length>1)throw new Error('Duplicate imported lesson');if(!matches.length)continue;const row=matches[0];if(!row.source_import_batch_id)continue;const targetModule=modules.find(m=>m.external_id===sourceLesson.module_external_id);record('course_lessons',row,{...select(sourceLesson,['title','sort_order','status']),module_id:targetModule?.id??null,body:{...row.body,...sourceLesson.body}});}
  }
  const report={version:1,community_id:database.community_id,location_id:snapshot.location_id,course_ids:snapshot.course_ids,rows,source_difference_count:rows.filter(r=>r.different_fields.length).length,local_override_count:rows.filter(r=>r.local_change_fields.length).length,conflict_count:conflicts.filter(r=>!r.local_change_fields.length).length};
  const review_hash=createHash('sha256').update(stable(report)).digest('hex');
  return {...report,review_hash};
}
export function baselineEnrollmentSql(report,approvedDifferencesHash){
  if(report.conflict_count && approvedDifferencesHash!==report.review_hash) throw new Error(`Baseline differences require review of report ${report.review_hash}`);
  const statements=[];
  for(const r of report.rows){
    if(r.local_change_fields.length)continue;
    if(!fields[r.table])throw new Error('Unknown baseline table');
    const checks=fields[r.table].map(f=>`${quote(f)},${f}`).join(',');
    statements.push(`update public.${r.table} set sync_owner='highlevel' where id=${quote(r.id)}::uuid and jsonb_build_object(${checks})=${quote(JSON.stringify(r.current))}::jsonb;\nget diagnostics changed=row_count; if changed<>1 then raise exception 'Baseline changed since review'; end if;`);
  }
  return `-- Review hash ${report.review_hash}. Generated locally; not applied.\n-- Keep config disabled until combined release approval.\nbegin;\ndo $baseline$ declare changed integer; active_lease timestamptz; begin\nselect lock_until into active_lease from public.academy_course_sync_configs where academy_community_id=${quote(report.community_id)}::uuid for update;\nif active_lease>clock_timestamp() then raise exception 'Sync run active; baseline enrollment refused'; end if;\n${statements.join('\n')}\nend $baseline$;\ninsert into public.academy_course_sync_configs(academy_community_id,location_id,course_ids,enabled) values(${quote(report.community_id)}::uuid,${quote(report.location_id)},array[${report.course_ids.map(quote).join(',')}],false) on conflict(academy_community_id) do update set last_snapshot_hash=null,last_success_at=null,enabled=false,location_id=excluded.location_id,course_ids=excluded.course_ids,lock_run_id=null,lock_until=null;\ncommit;\n`;
}
