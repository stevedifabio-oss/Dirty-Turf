import { describe,expect,it,vi } from "vitest";
import { COMMUNITY_PHOTO_MAX_BYTES, inspectCommunityPhoto, readBoundedPhotoForm } from "./community-photos";

export function png(width=1,height=1) {
  const bytes=new Uint8Array(57); bytes.set([137,80,78,71,13,10,26,10]); const view=new DataView(bytes.buffer);
  view.setUint32(8,13); bytes.set([73,72,68,82],12); view.setUint32(16,width);view.setUint32(20,height);
  return bytes;
}
describe("bounded community photos",()=>{
  it("checks actual PNG dimensions and MIME rather than trusting its filename",()=>{
    expect(inspectCommunityPhoto(png(4032,3024),"image/png")).toMatchObject({mimeType:"image/png",extension:"png",width:4032,height:3024,size:57});
    expect(()=>inspectCommunityPhoto(png(),"image/jpeg")).toThrow("valid JPG");
    expect(()=>inspectCommunityPhoto(new TextEncoder().encode('<svg onload="alert(1)"></svg>'),"image/png")).toThrow();
  });
  it("rejects empty, oversized, zero-dimension and decompression-heavy images",()=>{
    for(const bytes of [new Uint8Array(),new Uint8Array(COMMUNITY_PHOTO_MAX_BYTES+1),png(0,4),png(10001,1),png(6000,6000)]) expect(()=>inspectCommunityPhoto(bytes,"image/png")).toThrow();
  });
  it("supports JPEG and common WebP headers without accepting truncated dimension blocks",()=>{
    const jpeg=new Uint8Array([255,216,255,192,0,8,8,0,30,0,40,1,255,217]);
    expect(inspectCommunityPhoto(jpeg,"image/jpeg")).toMatchObject({width:40,height:30});
    const webp=new Uint8Array(30);const view=new DataView(webp.buffer);webp.set(new TextEncoder().encode("RIFF"));view.setUint32(4,22,true);webp.set(new TextEncoder().encode("WEBPVP8X"),8);webp[24]=39;webp[27]=29;
    expect(inspectCommunityPhoto(webp,"image/webp")).toMatchObject({width:40,height:30});
    expect(()=>inspectCommunityPhoto(jpeg.slice(0,10),"image/jpeg")).toThrow();
    expect(()=>inspectCommunityPhoto(webp.slice(0,25),"image/webp")).toThrow();
  });
  it("enforces the body limit even when Content-Length is missing or misleading",async()=>{
    const cancel=vi.fn();let reads=0;
    const request={url:"https://example.test",headers:new Headers({"content-type":"multipart/form-data; boundary=x"}),body:{getReader:()=>({read:async()=>++reads===1?{done:false,value:new Uint8Array(18*1024*1024)}:{done:true},cancel})}} as unknown as Request;
    await expect(readBoundedPhotoForm(request)).rejects.toThrow("too large");expect(cancel).toHaveBeenCalledOnce();
    await expect(readBoundedPhotoForm(new Request("https://example.test",{method:"POST",headers:{"content-length":"999999999"},body:"x"}))).rejects.toThrow("too large");
  });
});
