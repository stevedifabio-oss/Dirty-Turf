import {beforeEach,describe,expect,it,vi} from "vitest";
import {createCommunityPhotoHandler} from "./community-photo-handler";
const png=()=>{const bytes=new Uint8Array(57);bytes.set([137,80,78,71,13,10,26,10]);const view=new DataView(bytes.buffer);view.setUint32(8,13);bytes.set([73,72,68,82],12);view.setUint32(16,1);view.setUint32(20,1);return bytes;};
const user="00000000-0000-4000-8000-000000000001",community="00000000-0000-4000-8000-000000000002",member="00000000-0000-4000-8000-000000000003",requestId="00000000-0000-4000-8000-000000000004",lease="00000000-0000-4000-8000-000000000005",post="00000000-0000-4000-8000-000000000006";
const reservation={status:"uploading",leaseToken:lease,communityId:community,memberId:member};
const deps={user:vi.fn(),rpc:vi.fn(),upload:vi.fn(),remove:vi.fn()};
beforeEach(()=>{deps.user.mockReset().mockResolvedValue(user);deps.rpc.mockReset().mockImplementation(async(name:string)=>({data:name==="reserve_community_photo_post"?reservation:name==="finalize_community_photo_post"?{status:"published",postId:post}:true,error:null}));deps.upload.mockReset().mockResolvedValue({data:{},error:null});deps.remove.mockReset().mockResolvedValue({data:{},error:null});});
function input(overrides:Record<string,unknown>={},file=new File([png()],"untrusted.png",{type:"image/png"})){const body=new FormData();body.append("metadata",JSON.stringify({requestId,title:"Job update",body:"We finished this job",category:"General",mentionedMemberIds:[],...overrides}));body.append("photos",file);return new Request("https://example.test/photos",{method:"POST",headers:{authorization:"Bearer verified-token"},body});}
describe("private photo post endpoint",()=>{
  it("allows a screened draft to be revised without uploading or reserving an attempt",async()=>{
    const message="This content cannot be posted under the Community Rules. Please revise it or contact support.";
    deps.rpc.mockResolvedValue({data:null,error:{code:"23514",message}});
    const response=await createCommunityPhotoHandler(deps)(input());
    expect(response.status).toBe(422);expect(await response.json()).toEqual({error:message,retrySameDraft:false,publicationRejected:true});
    expect(deps.upload).not.toHaveBeenCalled();expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.rpc.mock.calls.map(call=>call[0])).toEqual(["reserve_community_photo_post"]);
  });
  it("releases only the rejected attempt when a rule changes before finalization",async()=>{
    const message="This content cannot be posted under the Community Rules. Please revise it or contact support.";
    deps.rpc.mockImplementation(async(name:string)=>name==="reserve_community_photo_post"?{data:reservation}:name==="finalize_community_photo_post"?{data:null,error:{code:"23514",message}}:{data:true});
    const response=await createCommunityPhotoHandler(deps)(input());
    expect(response.status).toBe(422);expect(await response.json()).toEqual({error:message,retrySameDraft:false,publicationRejected:true});
    expect(deps.rpc.mock.calls.map(call=>call[0])).toEqual(["reserve_community_photo_post","finalize_community_photo_post","release_community_photo_upload"]);
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith([deps.upload.mock.calls[0][0]]);
  });
  it("does not mistake another SQL constraint failure for a proven moderation rejection",async()=>{
    deps.rpc.mockImplementation(async(name:string)=>name==="reserve_community_photo_post"?{data:reservation}:{data:null,error:{code:"23514",message:"Another constraint failed"}});
    const response=await createCommunityPhotoHandler(deps)(input());
    expect(response.status).toBe(503);const body=await response.json();expect(body.retrySameDraft).toBe(true);expect(body).not.toHaveProperty("publicationRejected");
    expect(deps.remove).not.toHaveBeenCalled();expect(deps.rpc.mock.calls.map(call=>call[0])).toEqual(["reserve_community_photo_post","finalize_community_photo_post"]);
  });
  it("requires verified Auth identity before reading an upload body",async()=>{
    deps.user.mockResolvedValue(null);const response=await createCommunityPhotoHandler(deps)(input());expect(response.status).toBe(401);expect(deps.rpc).not.toHaveBeenCalled();expect(deps.upload).not.toHaveBeenCalled();
  });
  it("derives identity/folder server-side, validates bytes, then atomically publishes",async()=>{
    const response=await createCommunityPhotoHandler(deps)(input());expect(response.status).toBe(200);expect(await response.json()).toEqual({saved:true,postId:post});
    expect(deps.rpc.mock.calls[0][1]).toMatchObject({p_user_id:user,p_request_id:requestId,p_payload:{title:"Job update",photos:[{mimeType:"image/png",size:57,width:1,height:1}]}});
    expect(deps.upload.mock.calls[0][0]).toMatch(new RegExp(`^${community}/${member}/${requestId}/${lease}/1-[a-f0-9]{64}\\.png$`));
    expect(deps.rpc.mock.calls[1]).toEqual(["finalize_community_photo_post",{p_user_id:user,p_request_id:requestId,p_lease_token:lease}]);expect(deps.remove).not.toHaveBeenCalled();
  });
  it("returns an already-published receipt without uploading or finalizing again",async()=>{
    deps.rpc.mockResolvedValue({data:{status:"published",postId:post}});const response=await createCommunityPhotoHandler(deps)(input());expect(await response.json()).toEqual({saved:true,postId:post});expect(deps.upload).not.toHaveBeenCalled();expect(deps.rpc).toHaveBeenCalledOnce();
  });
  it("holds a concurrent in-progress request without reusing another attempt's files",async()=>{
    deps.rpc.mockResolvedValue({data:{status:"busy"}});const response=await createCommunityPhotoHandler(deps)(input());expect(response.status).toBe(409);expect((await response.json()).retrySameDraft).toBe(true);expect(deps.upload).not.toHaveBeenCalled();expect(deps.remove).not.toHaveBeenCalled();
  });
  it("rejects hostile metadata, corrupt/disguised types and excess photo counts before reservation",async()=>{
    const handler=createCommunityPhotoHandler(deps);
    for(const request of [input({userId:user}),input({mentionedMemberIds:[null]}),input({},new File(["<svg/>"],"photo.png",{type:"image/png"}))]) expect((await handler(request)).status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("cleans only its released attempt folder after an upload failure",async()=>{
    deps.upload.mockResolvedValue({data:null,error:new Error("Connection interrupted")});const response=await createCommunityPhotoHandler(deps)(input());expect(response.status).toBe(503);
    expect(deps.rpc.mock.calls.map(call=>call[0])).toEqual(["reserve_community_photo_post","release_community_photo_upload"]);expect(deps.remove).toHaveBeenCalledWith([deps.upload.mock.calls[0][0]]);
  });
  it("retains files if its failed upload lease can no longer be released",async()=>{
    deps.upload.mockRejectedValue(new Error("Timeout"));deps.rpc.mockImplementation(async(name:string)=>({data:name==="reserve_community_photo_post"?reservation:false}));await createCommunityPhotoHandler(deps)(input());expect(deps.remove).not.toHaveBeenCalled();
  });
  it.each(["throw","error"])("never cleans after an ambiguous finalizer %s",async(mode)=>{
    deps.rpc.mockImplementation(async(name:string)=>{if(name==="reserve_community_photo_post")return {data:reservation};if(mode==="throw")throw new Error("Response lost");return {data:null,error:new Error("Unknown commit outcome")};});
    const response=await createCommunityPhotoHandler(deps)(input());expect(response.status).toBe(503);expect((await response.json()).retrySameDraft).toBe(true);expect(deps.remove).not.toHaveBeenCalled();expect(deps.rpc.mock.calls.some(call=>call[0]==="release_community_photo_upload")).toBe(false);
  });
});
