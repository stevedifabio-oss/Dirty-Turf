import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {mapCourseSnapshot} from '../supabase/functions/_shared/course-sync.mjs';
import {prepareCourseSyncBaseline,baselineEnrollmentSql} from './lib/course-sync-baseline.mjs';
const options={};for(let i=2;i<process.argv.length;i+=2){if(!['--snapshot','--database','--output','--approve-differences','--original-import'].includes(process.argv[i])||!process.argv[i+1])throw new Error('Expected --snapshot <private.json> --database <private.json> --output output/private/<name> [--approve-differences <review-hash>]');options[process.argv[i]]=process.argv[i+1];}
const capture=JSON.parse(await readFile(options['--snapshot'],'utf8'));
const database=JSON.parse(await readFile(options['--database'],'utf8'));
const mapped=mapCourseSnapshot(capture,{locationId:capture.locationId,courseIds:capture.courses.map(c=>c.product.id)});
const original=options['--original-import']?JSON.parse(await readFile(options['--original-import'],'utf8')):undefined;
const report=prepareCourseSyncBaseline(database,mapped,original);
const root=path.resolve('output/private');const output=path.resolve(options['--output']);if(path.dirname(output)!==root)throw new Error('Output must be in output/private');await mkdir(root,{recursive:true,mode:0o700});
await writeFile(output+'.json',JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
if(!report.conflict_count||options['--approve-differences'])await writeFile(output+'.sql',baselineEnrollmentSql(report,options['--approve-differences']),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({review_hash:report.review_hash,rows:report.rows.length,source_differences:report.source_difference_count,local_overrides:report.local_override_count,unreviewed_differences:report.conflict_count,sql_prepared:!report.conflict_count||Boolean(options['--approve-differences']),applied:false}));
