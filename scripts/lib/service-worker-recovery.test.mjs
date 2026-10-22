import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {describe,expect,it,vi} from 'vitest';
const source=await readFile(new URL('../../public/sw.js',import.meta.url),'utf8');
function worker({failPath,quotaPath,wrongType,htmlMismatch=false}={}){
 const listeners=new Map(), cached=new Map([['/','old complete shell']]),puts=[],deletes=[];
 const manifest={'index.html':{file:'assets/new-app.js',css:['assets/new-app.css']},lazy:{file:'assets/lazy.js'}};
 const fetcher=vi.fn(async input=>{
  const path=typeof input === 'string' ? input : new URL(input.url).pathname;if(path===failPath)return new Response('unavailable',{status:503});
  if(path==='/vite-manifest.json')return Response.json(manifest);
  const type=wrongType===path?'text/html':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webmanifest')?'application/manifest+json':path.endsWith('.png')?'image/png':'text/html';
  return new Response(path==='/'?`<html><script src="/assets/${htmlMismatch?'other':'new-app'}.js"></script></html>`:`asset:${path}`,{status:200,headers:{'content-type':type}});
 });
 const skipWaiting=vi.fn();
 const context=vm.createContext({console,Error,Object,Promise,Response,Set,URL,
  caches:{open:async()=>({put:async(key,response)=>{const path=typeof key==='string'?key:new URL(key.url).pathname;if(path===quotaPath)throw new Error('Quota exceeded');puts.push(path);cached.set(path,await response.text());}}),keys:async()=>['unrelated-cache','dirty-turf-shell-old','dirty-turf-shell-v2'],delete:async key=>{deletes.push(key);return true;},match:async key=>{const path=typeof key==='string'?key:new URL(key.url).pathname;return cached.has(path)?new Response(cached.get(path)):undefined;}},
  fetch:fetcher,self:{addEventListener:(name,listener)=>listeners.set(name,listener),clients:{claim:async()=>{}},location:{origin:'https://app.dirtyturf.com'},skipWaiting}});
 vm.runInContext(source,context);
 const run=(kind='install')=>{const waits=[];listeners.get(kind)({data:{type:'PRECACHE_APP'},waitUntil:promise=>waits.push(promise)});return Promise.all(waits);};
 const runFetch=async path=>{const waits=[];let response;listeners.get('fetch')({request:{url:'https://app.dirtyturf.com'+path,method:'GET',mode:'cors'},waitUntil:promise=>waits.push(promise),respondWith:promise=>{response=promise;}});const result=await response;await Promise.allSettled(waits);return result;};
 return{run,runFetch,cached,puts,deletes,skipWaiting,fetcher};
}
describe('offline app update recovery',()=>{
 it('keeps the previous complete app shell if one startup download fails',async()=>{
  const app=worker({failPath:'/assets/new-app.js'});await expect(app.run()).rejects.toThrow();
  expect(app.cached.get('/')).toBe('old complete shell');expect(app.skipWaiting).not.toHaveBeenCalled();
 });
 it('rejects an HTML fallback masquerading as a JS chunk',async()=>{
  const app=worker({wrongType:'/assets/lazy.js'});await expect(app.run()).rejects.toThrow();expect(app.cached.get('/')).toBe('old complete shell');
 });
 it('does not publish a shell from a different deployment than its manifest',async()=>{
  const app=worker({htmlMismatch:true});await expect(app.run()).rejects.toThrow();expect(app.cached.get('/')).toBe('old complete shell');
 });
 it('commits the app HTML after every dependency is written',async()=>{
  const app=worker();await app.run();expect(app.puts.at(-1)).toBe('/');expect(app.cached.get('/')).toContain('new-app.js');expect(app.skipWaiting).toHaveBeenCalledOnce();
 });
 it('preserves old startup HTML if cache storage fills while writing a new release',async()=>{
  const app=worker({quotaPath:'/assets/lazy.js'});await expect(app.run()).rejects.toThrow();expect(app.cached.get('/')).toBe('old complete shell');
 });
 it('coalesces simultaneous refresh requests',async()=>{
  const app=worker();await Promise.all([app.run('message'),app.run('message')]);expect(app.fetcher.mock.calls.filter(([path])=>path==='/vite-manifest.json')).toHaveLength(1);
 });
 it('only removes obsolete Dirty Turf shell caches',async()=>{
  const app=worker();await app.run('activate');expect(app.deletes).toEqual(['dirty-turf-shell-old']);
 });
 it('preserves an old cached chunk when the retired network URL returns the SPA HTML fallback',async()=>{
  const app=worker({wrongType:'/assets/old.js'});app.cached.set('/assets/old.js','old valid javascript');
  expect(await (await app.runFetch('/assets/old.js')).text()).toBe('old valid javascript');
  expect(app.cached.get('/assets/old.js')).toBe('old valid javascript');
 });
 it('does not cache same-origin private API responses',async()=>{
  const app=worker();await app.runFetch('/api/private-account');expect(app.puts).toHaveLength(0);
 });

});
