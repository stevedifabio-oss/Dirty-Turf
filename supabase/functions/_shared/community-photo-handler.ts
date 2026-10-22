import { COMMUNITY_PHOTO_MAX_COUNT, describeCommunityPhoto, readBoundedPhotoForm } from "./community-photos.ts";
type Result<T> = { data: T | null; error?: unknown };
type Reservation = { status: "uploading" | "busy" | "published"; leaseToken?: string; communityId?: string; memberId?: string; postId?: string | null };
type Dependencies = {
  user: (token: string) => Promise<string | null>;
  rpc: (name: string, args: Record<string,unknown>) => Promise<Result<unknown>>;
  upload: (path: string, file: File, contentType: string) => Promise<Result<unknown>>;
  remove: (paths: string[]) => Promise<Result<unknown>>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown,status=200) => Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
const contentRejectionMessage = "This content cannot be posted under the Community Rules. Please revise it or contact support.";
function isContentRejection(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"
    && "message" in error && error.message === contentRejectionMessage);
}

/** One authenticated request owns one attempt folder. Finalization is atomic/idempotent. */
export function createCommunityPhotoHandler(dependencies: Dependencies) {
  return async (request: Request) => {
    if (request.method !== "POST") return json({error:"Method not allowed"},405);
    const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return json({error:"Sign in before posting photos.",retrySameDraft:false},401);
    let userId: string | null;
    try { userId = await dependencies.user(token); } catch { userId = null; }
    if (!userId || !uuid.test(userId)) return json({error:"Your session could not be verified. Sign in again.",retrySameDraft:false},401);
    let requestId = "", reservation: Reservation | undefined, finalizationStarted = false, contentRejected = false;
    const attemptedPaths: string[] = [];
    try {
      const form = await readBoundedPhotoForm(request);
      if ([...form.keys()].some(key => !["metadata","photos"].includes(key))) throw new Error("Invalid photo upload.");
      const raw = form.getAll("metadata");
      if (raw.length !== 1 || typeof raw[0] !== "string" || raw[0].length > 16_000) throw new Error("Invalid photo details.");
      let metadata: Record<string,unknown>;
      try { metadata = JSON.parse(raw[0]); } catch { throw new Error("Invalid photo details."); }
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
          || Object.keys(metadata).some(key => !["requestId","title","body","category","mentionedMemberIds"].includes(key))
          || typeof metadata.requestId !== "string" || !uuid.test(metadata.requestId)
          || typeof metadata.title !== "string" || !metadata.title.trim() || metadata.title.trim().length > 120
          || typeof metadata.body !== "string" || !metadata.body.trim() || metadata.body.trim().length > 5000
          || typeof metadata.category !== "string" || !metadata.category.trim() || metadata.category.trim().length > 80
          || !Array.isArray(metadata.mentionedMemberIds) || metadata.mentionedMemberIds.length > 20
          || metadata.mentionedMemberIds.some(id => typeof id !== "string" || !uuid.test(id))) throw new Error("Check the title, details and discussion channel.");
      requestId = metadata.requestId;
      const files = form.getAll("photos");
      if (!files.length || files.length > COMMUNITY_PHOTO_MAX_COUNT || files.some(file => !(file instanceof File))) throw new Error("Choose one to four photos.");
      const photos = [];
      for (const file of files as File[]) photos.push(await describeCommunityPhoto(file));
      const payload = {title:metadata.title.trim(),body:metadata.body.trim(),category:metadata.category.trim(),mentionedMemberIds:[...new Set(metadata.mentionedMemberIds)].sort(),photos};
      const result = await dependencies.rpc("reserve_community_photo_post",{p_user_id:userId,p_request_id:requestId,p_payload:payload});
      if (result.error) {
        if (isContentRejection(result.error)) { contentRejected = true; throw new Error(contentRejectionMessage); }
        throw new Error("Photo posting could not start. Retry this draft, or contact Academy support if it continues.");
      }
      reservation = result.data as Reservation;
      if (reservation?.status === "published") {
        if(reservation.postId!==null && (typeof reservation.postId!=="string" || !uuid.test(reservation.postId))) throw new Error("The saved post could not be confirmed. Keep this draft and retry.");
        return json({saved:true,postId:reservation.postId});
      }
      if (reservation?.status === "busy") return json({error:"This photo post is still processing. Keep this draft and retry in a few minutes.",retrySameDraft:true},409);
      if (reservation?.status !== "uploading" || !reservation.leaseToken || !uuid.test(reservation.leaseToken)
          || !reservation.communityId || !uuid.test(reservation.communityId) || !reservation.memberId || !uuid.test(reservation.memberId)) throw new Error("Photo posting could not be confirmed. Keep this draft and retry.");
      for (let index = 0; index < photos.length; index++) {
        const photo = photos[index];
        const path = `${reservation.communityId}/${reservation.memberId}/${requestId}/${reservation.leaseToken}/${index+1}-${photo.sha256}.${photo.extension}`;
        attemptedPaths.push(path);
        const uploaded = await dependencies.upload(path,files[index] as File,photo.mimeType);
        if (uploaded.error) throw new Error("The photos could not finish uploading. Your draft is still here; retry when connected.");
      }
      finalizationStarted = true;
      const finalized = await dependencies.rpc("finalize_community_photo_post",{p_user_id:userId,p_request_id:requestId,p_lease_token:reservation.leaseToken});
      const saved = finalized.data as Reservation;
      if (isContentRejection(finalized.error)) {
        // This exact database rejection proves the finalization transaction
        // rolled back. Unlike a timeout, it is safe to release this attempt and
        // let the member revise the draft with a new publication identity.
        contentRejected = true;
        finalizationStarted = false;
        throw new Error(contentRejectionMessage);
      }
      if (finalized.error || saved?.status !== "published" || (saved.postId !== null && (typeof saved.postId !== "string" || !uuid.test(saved.postId)))) throw new Error("The saved post could not be confirmed. Keep this exact draft and retry; it will not create a second post.");
      return json({saved:true,postId:saved.postId});
    } catch (error) {
      if (reservation?.status === "uploading" && reservation.leaseToken && !finalizationStarted) {
        // Never delete after an ambiguous finalization. A new attempt has a new
        // folder, and only a successful release authorizes this attempt's cleanup.
        try {
          const released = await dependencies.rpc("release_community_photo_upload",{p_user_id:userId,p_request_id:requestId,p_lease_token:reservation.leaseToken});
          if (!released.error && released.data === true && attemptedPaths.length) await dependencies.remove(attemptedPaths);
        } catch { /* Preserve private orphan files for guarded administrator cleanup. */ }
      }
      return json({error:error instanceof Error ? error.message : "Photo posting failed. Keep your draft and retry.",retrySameDraft:contentRejected ? false : Boolean(reservation),...(contentRejected ? {publicationRejected:true} : {})},contentRejected ? 422 : reservation ? 503 : 400);
    }
  };
}
