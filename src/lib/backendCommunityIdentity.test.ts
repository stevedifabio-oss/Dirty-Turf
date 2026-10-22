import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import type {CommunityComment,CommunityPost} from "../domain";
const state=vi.hoisted(()=>{
  const current={user:"account-a" as string|null,token:"fixture-token-a",membership:undefined as undefined|Promise<{data:unknown;error:null}>,switchOnRpc:false};
  const sent:string[]=[];
  const rpc=vi.fn(()=>{
    if(current.switchOnRpc){current.user="account-b";current.token="fixture-token-b";}
    let authorization:string|undefined;
    const builder={setHeader:vi.fn((name:string,value:string)=>{if(name.toLowerCase()==="authorization")authorization=value;return builder;}),then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>{sent.push(authorization??`Bearer ${current.token}`);return Promise.resolve({data:"00000000-0000-4000-8000-000000000051",error:null}).then(resolve,reject);}};
    return builder;
  });
  const getSession=vi.fn(async()=>({data:{session:current.user?{user:{id:current.user},access_token:current.token}:null},error:null}));
  const client={auth:{getSession},rpc,from:vi.fn(()=>{const builder={select:()=>builder,eq:()=>builder,limit:()=>builder,maybeSingle:async()=>current.membership??{data:{id:"member-a",academy_community_id:"community-a"},error:null}};return builder;})};
  return{current,sent,client,rpc,getSession};
});
vi.mock("@supabase/supabase-js",()=>({createClient:()=>state.client}));
vi.mock("@capacitor/core",()=>({Capacitor:{isNativePlatform:()=>false}}));
let savePost:typeof import("./backend").savePost,saveComment:typeof import("./backend").saveComment;
let backend:typeof import("./backend");
const post:CommunityPost={id:1,name:"Private draft",author:"You",body:"Account A private draft",replies:0,age:"Now"};
const comment:CommunityComment={id:2,postId:1,author:"You",body:"Account A reply",age:"Now",likes:0};
beforeAll(async()=>{vi.stubGlobal("window",{});vi.stubEnv("VITE_SUPABASE_URL","https://example.supabase.co");vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY","fixture-publishable-key");backend=await import("./backend");({savePost,saveComment}=backend);});
beforeEach(()=>{vi.clearAllMocks();state.current.user="account-a";state.current.token="fixture-token-a";state.current.membership=undefined;state.current.switchOnRpc=false;state.sent.length=0;vi.stubGlobal("localStorage",{getItem:vi.fn(()=>null),setItem:vi.fn()});});
afterEach(()=>{vi.unstubAllGlobals();});
describe("Community draft author identity",()=>{
  it.each(["post","comment"])("does not submit a %s as a different account after membership lookup waits",async kind=>{
    let resolve!:(value:{data:unknown;error:null})=>void;state.current.membership=new Promise(yes=>{resolve=yes;});
    const pending=kind==="post"?savePost(post):saveComment(comment,"00000000-0000-4000-8000-000000000051");
    for(let i=0;i<5;i++)await Promise.resolve();state.current.user="account-b";state.current.token="fixture-token-b";resolve({data:{id:"member-a",academy_community_id:"community-a"},error:null});
    await expect(pending).rejects.toThrow("account changed");expect(state.rpc).not.toHaveBeenCalled();expect(state.sent).toEqual([]);
  });
  it.each(["post","comment"])("pins a %s RPC to the rechecked account token even if the SDK's session changes before fetch",async kind=>{
    state.current.switchOnRpc=true;if(kind==="post")await savePost(post);else await saveComment(comment,"00000000-0000-4000-8000-000000000051");
    expect(state.sent).toEqual(["Bearer fixture-token-a"]);
  });
  it.each(["post","comment"])("never persists a configured, signed-out cloud %s into device preview storage",async kind=>{
    state.current.user=null;await expect(kind==="post"?savePost(post):saveComment(comment)).rejects.toThrow("membership");expect(localStorage.setItem).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();
  });
});

const scopedMutations = [
  ["post reaction",()=>backend.togglePostReaction("post-id")],
  ["comment reaction",()=>backend.toggleCommentReaction("comment-id")],
  ["bookmark",()=>backend.togglePostBookmark("post-id")],
  ["report",()=>backend.reportAcademyContent("post","post-id","Spam")],
  ["member block",()=>backend.toggleAcademyMemberBlock("other-member")],
  ["Academy RSVP",()=>backend.toggleAcademyEventRsvp("event-id")],
  ["Academy progress",()=>backend.saveLessonCompletion("lesson-id",true)],
  ["quiz answers",()=>backend.recordAcademyQuizAttempt("lesson-id",100,[1,0])],
  ["certificate request",()=>backend.requestAcademyCertificate("course-id")],
] as const;
describe("Community and learning mutation actor identity",()=>{
  it.each(scopedMutations)("rejects changed identity after deferred membership lookup for %s",async(_label,mutate)=>{
    let resolve!:(value:{data:unknown;error:null})=>void;state.current.membership=new Promise(yes=>{resolve=yes;});
    const pending=mutate();for(let i=0;i<5;i++)await Promise.resolve();state.current.user="account-b";state.current.token="fixture-token-b";resolve({data:{id:"member-a",academy_community_id:"community-a"},error:null});
    await expect(pending).rejects.toThrow("account changed");expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each(scopedMutations)("pins the verified actor when SDK switches before %s fetch",async(_label,mutate)=>{
    state.current.switchOnRpc=true;await mutate();expect(state.sent).toEqual(["Bearer fixture-token-a"]);
  });
  it.each([
    ["legacy RSVP",()=>backend.toggleEventRsvp("event-id")],
    ["legacy progress",()=>backend.setLessonCompletion("lesson-id",true)],
  ] as const)("pins the initial session for %s",async(_label,mutate)=>{
    state.current.switchOnRpc=true;await mutate();expect(state.sent).toEqual(["Bearer fixture-token-a"]);
  });
});
