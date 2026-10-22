import type { CommunityPost } from "../domain";
import { COMMUNITY_PHOTO_MAX_COUNT, describeCommunityPhoto } from "../../supabase/functions/_shared/community-photos";
import { COMMUNITY_CONTENT_REJECTED_MESSAGE } from "./communitySafety";

export type CommunityPhotoPostResult = { postId: string | null; post?: CommunityPost };
export class CommunityPhotoPostError extends Error {
  constructor(message: string, readonly retrySameDraft = true, readonly publicationRejected = false) { super(message); }
}
export async function validateCommunityPhotoSelection(files: File[]) {
  if (!files.length || files.length > COMMUNITY_PHOTO_MAX_COUNT) throw new Error("Choose up to four photos.");
  for (const file of files) await describeCommunityPhoto(file);
}

/** Keep one request ID for retries, including a lost response after publication. */
export async function createCommunityPhotoPost(post: CommunityPost, photos: File[], requestId: string): Promise<CommunityPhotoPostResult> {
  const {loadCommunityThread,supabase}=await import("./backend");
  if (!supabase) throw new CommunityPhotoPostError("Sign in before posting photos.",false);
  if (navigator.onLine === false) throw new CommunityPhotoPostError("Reconnect before posting. Your photo draft is still here.",false);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new CommunityPhotoPostError("This photo draft could not be verified.",false);
  const initial=await supabase.auth.getSession();
  const initialUserId=initial.data.session?.user.id;
  if(initial.error || !initialUserId) throw new CommunityPhotoPostError("Sign in before posting photos.",false);
  await validateCommunityPhotoSelection(photos);
  const current=await supabase.auth.getSession();
  const currentSession=current.data.session;
  if(current.error || !currentSession?.access_token || currentSession.user.id!==initialUserId) throw new CommunityPhotoPostError("The account changed. This photo draft was not submitted.",false);
  const body = new FormData();
  body.append("metadata",JSON.stringify({requestId,title:post.name,body:post.body,category:post.category || "General",mentionedMemberIds:post.mentionedMemberIds || []}));
  for (const photo of photos) body.append("photos",photo,"photo");
  let data: unknown, error: unknown;
  // An account switch after this check must never send this draft as that new
  // account. The server independently verifies this explicitly bound JWT.
  try { ({data,error}=await supabase.functions.invoke("create-community-photo-post",{body,timeout:120_000,headers:{Authorization:`Bearer ${currentSession.access_token}`}})); }
  catch { throw new CommunityPhotoPostError("The saved post could not be confirmed. Keep this exact draft and retry."); }
  if (error) {
    let result: {error?: unknown;retrySameDraft?: unknown;publicationRejected?: unknown} | undefined;
    let publicationRejected = false;
    try {
      const response = (error as {context?: Response}).context;
      if (response instanceof Response) {
        result = await response.clone().json();
        publicationRejected = response.status === 422 && result?.publicationRejected === true
          && result.retrySameDraft === false && result.error === COMMUNITY_CONTENT_REJECTED_MESSAGE;
      }
    } catch { /* Unknown outcomes retain the original retry identity. */ }
    throw new CommunityPhotoPostError(typeof result?.error === "string" ? result.error : "Photo posting could not be confirmed. Keep this exact draft and retry.",result?.retrySameDraft !== false,publicationRejected);
  }
  const result = data as {saved?: unknown;postId?: unknown} | null;
  if (result?.saved!==true || (result.postId !== null && (typeof result.postId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.postId)))) throw new CommunityPhotoPostError("The saved post could not be confirmed. Keep this exact draft and retry.");
  const postId = result.postId as string | null;
  // Publication has succeeded. A failed optional read must not ask for another post.
  let timer:ReturnType<typeof setTimeout> | undefined;
  try {
    const thread=postId?await Promise.race([loadCommunityThread(postId),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),5_000);})]):null;
    return {postId,post:thread?.post};
  }catch{return {postId};}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
