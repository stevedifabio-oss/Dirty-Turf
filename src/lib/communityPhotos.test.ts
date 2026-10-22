import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {CommunityPost} from "../domain";
import {CommunityPhotoPostError,createCommunityPhotoPost} from "./communityPhotos";
import {COMMUNITY_CONTENT_REJECTED_MESSAGE} from "./communitySafety";
const state=vi.hoisted(()=>({invoke:vi.fn(),thread:vi.fn(),session:vi.fn(),configured:true}));
vi.mock("./backend",()=>({get supabase(){return state.configured?{auth:{getSession:state.session},functions:{invoke:state.invoke}}:null;},loadCommunityThread:state.thread}));
const requestId="00000000-0000-4000-8000-000000000004",postId="00000000-0000-4000-8000-000000000006";
const draft:CommunityPost={id:1,name:"Photo update",author:"You",body:"Job details",replies:0,age:"Just now",category:"General"};
const file=()=>{const b=new Uint8Array(57);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(8,13);b.set([73,72,68,82],12);v.setUint32(16,1);v.setUint32(20,1);return new File([b],"private-customer-name.png",{type:"image/png"});};
beforeEach(()=>{state.configured=true;state.session.mockReset().mockResolvedValue({data:{session:{user:{id:"account-a"},access_token:"fixture-account-a-token"}},error:null});state.invoke.mockReset().mockResolvedValue({data:{saved:true,postId},error:null});state.thread.mockReset().mockResolvedValue({post:{...draft,cloudId:postId},comments:[]});vi.stubGlobal("navigator",{onLine:true});});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("Community photo client",()=>{
  it("accepts only the explicit moderation rejection protocol as a settled publication",async()=>{
    state.invoke.mockResolvedValueOnce({error:{context:Response.json({error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false,publicationRejected:true},{status:422})}});
    await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({message:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false,publicationRejected:true});
    expect(new CommunityPhotoPostError("Validation failed",false).publicationRejected).toBe(false);
    expect(state.thread).not.toHaveBeenCalled();
  });
  it.each([
    {status:400,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false,publicationRejected:true},
    {status:503,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false,publicationRejected:true},
    {status:422,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false},
    {status:422,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false,publicationRejected:false},
    {status:422,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false,publicationRejected:"true"},
    {status:422,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:true,publicationRejected:true},
    {status:422,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,publicationRejected:true},
    {status:422,error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:"false",publicationRejected:true},
    {status:422,error:"Another validation failed",retrySameDraft:false,publicationRejected:true},
    {status:422,error:`${COMMUNITY_CONTENT_REJECTED_MESSAGE} `,retrySameDraft:false,publicationRejected:true},
  ])("keeps an invalid moderation settlement unproven: %j",async({status,...body})=>{
    state.invoke.mockResolvedValueOnce({error:{context:Response.json(body,{status})}});
    await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({publicationRejected:false});
    expect(state.thread).not.toHaveBeenCalled();
  });
  it("does not accept settlement markers from non-Response or unreadable error contexts",async()=>{
    const body={error:COMMUNITY_CONTENT_REJECTED_MESSAGE,retrySameDraft:false,publicationRejected:true};
    state.invoke.mockResolvedValueOnce({error:{context:{status:422,clone:()=>({json:async()=>body})},...body}});
    await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({publicationRejected:false,retrySameDraft:true});
    state.invoke.mockResolvedValueOnce({error:{context:new Response("invalid JSON",{status:422})}});
    await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({publicationRejected:false,retrySameDraft:true});
    state.invoke.mockRejectedValueOnce(Object.assign(new Error(COMMUNITY_CONTENT_REJECTED_MESSAGE),{publicationRejected:true,retrySameDraft:false}));
    await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({publicationRejected:false,retrySameDraft:true});
  });
  it("submits one stable request without exposing original filenames in metadata",async()=>{
    const result=await createCommunityPhotoPost(draft,[file()],requestId);expect(result.post?.cloudId).toBe(postId);
    const [endpoint,options]=state.invoke.mock.calls[0];expect(endpoint).toBe("create-community-photo-post");expect(options.timeout).toBe(120000);
    expect(options.headers).toEqual({Authorization:"Bearer fixture-account-a-token"});
    expect(JSON.parse(options.body.get("metadata"))).toEqual({requestId,title:draft.name,body:draft.body,category:"General",mentionedMemberIds:[]});expect(options.body.get("photos").name).toBe("photo");
  });
  it("does not post while offline, unconfigured or given unsupported photo bytes",async()=>{
    vi.stubGlobal("navigator",{onLine:false});await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({retrySameDraft:false});
    vi.stubGlobal("navigator",{onLine:true});state.configured=false;await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({retrySameDraft:false});state.configured=true;
    await expect(createCommunityPhotoPost(draft,[new File(["<svg/>"],"photo.png",{type:"image/png"})],requestId)).rejects.toThrow("valid JPG");expect(state.invoke).not.toHaveBeenCalled();
  });
  it("rejects account switching during asynchronous file validation before a request can be sent",async()=>{
    state.session.mockResolvedValueOnce({data:{session:{user:{id:"account-a"},access_token:"fixture-a-token"}},error:null}).mockResolvedValueOnce({data:{session:{user:{id:"account-b"},access_token:"fixture-b-token"}},error:null});
    await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({message:"The account changed. This photo draft was not submitted.",retrySameDraft:false});expect(state.invoke).not.toHaveBeenCalled();
  });
  it("distinguishes definite validation failures from uncertain network outcomes",async()=>{
    state.invoke.mockResolvedValueOnce({error:{context:Response.json({error:"This channel is restricted",retrySameDraft:false},{status:400})}});
    await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({message:"This channel is restricted",retrySameDraft:false});
    state.invoke.mockRejectedValueOnce(new Error("Response lost"));await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toBeInstanceOf(CommunityPhotoPostError);
    state.invoke.mockResolvedValueOnce({error:{message:"Network unavailable"}});await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({retrySameDraft:true});
  });
  it("returns a confirmed saved receipt even when the optional private-media read fails",async()=>{
    state.thread.mockRejectedValue(new Error("Read unavailable"));expect(await createCommunityPhotoPost(draft,[file()],requestId)).toEqual({postId});expect(state.invoke).toHaveBeenCalledOnce();
  });
  it("does not turn an archived/deleted saved post into another submission",async()=>{
    state.invoke.mockResolvedValue({data:{saved:true,postId:null},error:null});expect(await createCommunityPhotoPost(draft,[file()],requestId)).toEqual({postId:null,post:undefined});expect(state.thread).not.toHaveBeenCalled();
  });
  it.each([{saved:"yes",postId},{saved:true,postId:"------------------------------------"},{saved:false,postId}])("holds malformed success receipts %j",async data=>{
    state.invoke.mockResolvedValue({data,error:null});await expect(createCommunityPhotoPost(draft,[file()],requestId)).rejects.toMatchObject({retrySameDraft:true});expect(state.thread).not.toHaveBeenCalled();
  });
});
