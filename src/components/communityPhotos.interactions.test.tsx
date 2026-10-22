import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityComment, CommunityPost, Member } from "../domain";
import { CommunityView } from "./Community";
import { CommunityPhotoPostError } from "../lib/communityPhotos";
import { COMMUNITY_CONTENT_REJECTED_MESSAGE } from "../lib/communitySafety";

type HookState = { slots: any[]; cursor: number; pending: (() => void)[]; effects: Set<number> };
const hooks = vi.hoisted(() => ({ active: null as HookState | null }));
const validation = vi.hoisted(() => ({ work: [] as Promise<void>[] }));
vi.mock("../lib/communityPhotos", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/communityPhotos")>();
  return { ...actual, validateCommunityPhotoSelection: (files: File[]) => {
    const pending = actual.validateCommunityPhotoSelection(files);
    validation.work.push(pending);
    return pending;
  } };
});
const mountedViews = new Set<{ unmount: () => void }>();
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  const next = () => {
    if (!hooks.active) throw new Error("Render through the component harness");
    return { state: hooks.active, index: hooks.active.cursor++ };
  };
  return {
    ...actual,
    useState: (initial: any) => {
      const { state, index } = next();
      if (!(index in state.slots)) state.slots[index] = typeof initial === "function" ? initial() : initial;
      return [state.slots[index], (value: any) => { state.slots[index] = typeof value === "function" ? value(state.slots[index]) : value; }];
    },
    useRef: (initial: any) => { const { state, index } = next(); return state.slots[index] ??= { current: initial }; },
    useMemo: (factory: () => any) => factory(),
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const { state, index } = next();
      const previous = state.slots[index];
      if (previous && previous.deps.length === deps.length && deps.every((value, offset) => Object.is(value, previous.deps[offset]))) return;
      state.pending.push(() => {
        previous?.cleanup?.();
        state.slots[index] = { deps, cleanup: effect() };
        state.effects.add(index);
      });
    },
  };
});

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (!node || typeof node === "boolean") return "";
  if (typeof node === "object") return "props" in node ? text((node as Element).props.children) : "";
  return String(node);
}
function find(node: ReactNode, predicate: (element: Element) => boolean) {
  const element = elements(node).find(predicate);
  if (!element) throw new Error("Expected control not found");
  return element;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const oldId = "00000000-0000-4000-8000-000000000051";
const otherId = "00000000-0000-4000-8000-000000000052";
function post(id: number, cloudId = id === 51 ? oldId : `post-${id}`): CommunityPost {
  return { id, cloudId, name: `Discussion ${id}`, author: "Operator", body: "Details", replies: 1, age: "Today", likes: 0, liked: false };
}
function comment(id: number, postId = 51): CommunityComment {
  return { id, cloudId: `comment-${id}`, postId, author: "Operator", body: `Reply ${id}`, age: "Today", likes: 0 };
}
function view(overrides: Partial<ComponentProps<typeof CommunityView>> = {}) {
  const state: HookState = { slots: [], cursor: 0, pending: [], effects: new Set() };
  const rows = { posts: [post(1)], comments: [comment(10, 1)], members: [] as Member[] };
  const props: ComponentProps<typeof CommunityView> = {
    ...rows, events: [], accessScopeKey: "account-a",
    onPostsChange: next => { rows.posts = typeof next === "function" ? next(rows.posts) : next; },
    onCommentsChange: next => { rows.comments = typeof next === "function" ? next(rows.comments) : next; },
    onMembersChange: next => { rows.members = typeof next === "function" ? next(rows.members) : next; },
    onRequestedPostOpened: vi.fn(() => { props.requestedPostCloudId = undefined; }),
    onRequestedCommentOpened: vi.fn(() => { props.requestedCommentCloudId = undefined; }),
    onToggleFollow: vi.fn(), onLoadMorePosts: vi.fn(), hasMorePosts: true, loadingMorePosts: false,
    onCreatePost: vi.fn(), onCreateComment: vi.fn(), onToggleLike: vi.fn().mockResolvedValue(true),
    onToggleCommentLike: vi.fn(), onToggleBookmark: vi.fn(), onReport: vi.fn(), onBlockMember: vi.fn(),
    onLoadBlockedMembers: vi.fn().mockResolvedValue([]), onRefreshCommunity: vi.fn(), onNavigate: vi.fn(), onToast: vi.fn(),
    ...overrides,
  };
  const render = (commitEffects = true) => {
    state.cursor = 0; hooks.active = state;
    let tree: ReactNode;
    try { tree = CommunityView({ ...props, ...rows }); } finally { hooks.active = null; }
    if (commitEffects) for (const effect of state.pending.splice(0)) effect();
    return tree;
  };
  const fixture = { rows, props, render, unmount: () => {
    if (!mountedViews.delete(fixture)) return;
    for (const index of state.effects) state.slots[index].cleanup?.();
  } };
  mountedViews.add(fixture);
  return fixture;
}
// Await the real byte/hash validation, not a timer guess. Its component await
// continuation runs before this observer, including rejected selections.
const finishValidation = () => Promise.allSettled(validation.work);
function imageFile(){const bytes=new Uint8Array(57);bytes.set([137,80,78,71,13,10,26,10]);const v=new DataView(bytes.buffer);v.setUint32(8,13);bytes.set([73,72,68,82],12);v.setUint32(16,1);v.setUint32(20,1);return new File([bytes],"photo.png",{type:"image/png"});}
const button=(tree:ReactNode,label:string)=>find(tree,e=>e.type==="button"&&text(e.props.children)===label);
function compose(community:ReturnType<typeof view>){community.render();find(community.render(),e=>e.props.className==="composer-prompt").props.onClick();find(community.render(),e=>e.props["aria-label"]==="Post title").props.onChange({target:{value:"Photo update"}});find(community.render(),e=>e.props["aria-label"]==="Post body").props.onChange({target:{value:"A finished job"}});}
async function choose(community:ReturnType<typeof view>,files=[imageFile()]){const target={files,value:"selected"};find(community.render(),e=>e.props["aria-label"]==="Choose discussion photos").props.onChange({target});await finishValidation();return target;}
beforeEach(()=>{
  vi.stubGlobal("window",{location:{href:"https://example.invalid/?view=community"},history:{state:null,replaceState:vi.fn()},scrollTo:vi.fn()});
  vi.stubGlobal("document",{querySelector:()=>null,getElementById:vi.fn()});
  let count=0;vi.spyOn(URL,"createObjectURL").mockImplementation(()=>`blob:photo-${++count}`);vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>undefined);
});
afterEach(async()=>{
  // A failed assertion must still invalidate pending work before the next
  // test installs a fresh URL spy or account fixture.
  for (const fixture of [...mountedViews]) fixture.unmount();
  await finishValidation();
  validation.work.length = 0;
  vi.restoreAllMocks();vi.unstubAllGlobals();
});

describe("native Community photo drafts",()=>{
  it("retains an unknown-outcome draft and retries the same request/files without duplicate publication",async()=>{
    const first=deferred<{postId:string;post?:CommunityPost}>();const onCreatePhotoPost=vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({postId:oldId,post:post(51)});
    const community=view({onCreatePhotoPost});compose(community);const selection=await choose(community);expect(selection.value).toBe("");expect(text(community.render())).toContain("1/4");
    const form=find(community.render(),e=>e.props.className==="full-composer");const pending=form.props.onSubmit({preventDefault:vi.fn()});void form.props.onSubmit({preventDefault:vi.fn()});expect(onCreatePhotoPost).toHaveBeenCalledOnce();
    expect(find(community.render(),e=>e.props["aria-label"]==="Post body").props.disabled).toBe(true);
    first.reject(new Error("Response lost"));await pending;let tree=community.render();expect(text(tree)).toContain("Keep this exact draft");expect(find(tree,e=>e.props["aria-label"]==="Post body").props.value).toBe("A finished job");
    find(tree,e=>e.props["aria-label"]==="Post body").props.onChange({target:{value:"Changed request"}});expect(find(community.render(),e=>e.props["aria-label"]==="Post body").props.value).toBe("A finished job");
    await find(community.render(),e=>e.props.className==="full-composer").props.onSubmit({preventDefault:vi.fn()});
    expect(onCreatePhotoPost.mock.calls[1]).toEqual(onCreatePhotoPost.mock.calls[0]);expect(community.props.onCreatePost).not.toHaveBeenCalled();expect(community.rows.posts[0].cloudId).toBe(oldId);expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");expect(community.props.onRefreshCommunity).toHaveBeenCalledOnce();community.unmount();
  });
  it("never forgets a prior unknown publication after a later definitive retry error",async()=>{
    const onCreatePhotoPost=vi.fn().mockRejectedValueOnce(new CommunityPhotoPostError("Response lost",true)).mockRejectedValueOnce(new CommunityPhotoPostError("Sign in again",false)).mockResolvedValue({postId:oldId});
    const community=view({onCreatePhotoPost});compose(community);await choose(community);
    const submit=find(community.render(),e=>e.props.className==="full-composer").props.onSubmit;
    await submit({preventDefault:vi.fn()});
    // Reuse the pre-rerender handler: uncertain publication identity is synchronous.
    await submit({preventDefault:vi.fn()});
    const field=find(community.render(),e=>e.props["aria-label"]==="Post body");expect(field.props.disabled).toBe(true);expect(text(community.render())).toContain("Keep this exact draft");
    await find(community.render(),e=>e.props.className==="full-composer").props.onSubmit({preventDefault:vi.fn()});
    expect(onCreatePhotoPost.mock.calls[1]).toEqual(onCreatePhotoPost.mock.calls[0]);expect(onCreatePhotoPost.mock.calls[2]).toEqual(onCreatePhotoPost.mock.calls[0]);community.unmount();
  });
  it("settles an unknown publication only after confirmed moderation rejection and preserves the revisable photo draft",async()=>{
    const onCreatePhotoPost=vi.fn().mockRejectedValueOnce(new CommunityPhotoPostError("Response lost",true)).mockRejectedValueOnce(new CommunityPhotoPostError(COMMUNITY_CONTENT_REJECTED_MESSAGE,false,true)).mockResolvedValue({postId:oldId});
    const community=view({onCreatePhotoPost});compose(community);await choose(community);
    const submit=find(community.render(),e=>e.props.className==="full-composer").props.onSubmit;
    await submit({preventDefault:vi.fn()});
    expect(find(community.render(),e=>e.props["aria-label"]==="Post body").props.disabled).toBe(true);
    await submit({preventDefault:vi.fn()});
    const field=find(community.render(),e=>e.props["aria-label"]==="Post body");
    expect(field.props).toMatchObject({disabled:false,value:"A finished job"});
    expect(find(community.render(),e=>e.props["aria-label"]==="Post title").props.value).toBe("Photo update");
    expect(text(community.render())).toContain("1/4");expect(text(community.render())).not.toContain("Keep this exact draft");
    expect(community.props.onToast).toHaveBeenLastCalledWith(COMMUNITY_CONTENT_REJECTED_MESSAGE);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();expect(community.props.onRefreshCommunity).not.toHaveBeenCalled();
    field.props.onChange({target:{value:"Revised allowed details"}});
    await find(community.render(),e=>e.props.className==="full-composer").props.onSubmit({preventDefault:vi.fn()});
    expect(onCreatePhotoPost.mock.calls[1]).toEqual(onCreatePhotoPost.mock.calls[0]);
    expect(onCreatePhotoPost.mock.calls[2][2]).not.toBe(onCreatePhotoPost.mock.calls[0][2]);
    expect(onCreatePhotoPost.mock.calls[2][0].body).toBe("Revised allowed details");
    expect(onCreatePhotoPost.mock.calls[2][1]).toEqual(onCreatePhotoPost.mock.calls[0][1]);
    expect(community.props.onToast).toHaveBeenLastCalledWith("Your post was saved. Refresh discussions to see it.");community.unmount();
  });
  it("unlocks a definitively rejected draft without discarding its selected photos",async()=>{
    const onCreatePhotoPost=vi.fn().mockRejectedValueOnce(new CommunityPhotoPostError("Choose a permitted channel",false)).mockResolvedValue({postId:oldId});
    const community=view({onCreatePhotoPost});compose(community);await choose(community);await find(community.render(),e=>e.props.className==="full-composer").props.onSubmit({preventDefault:vi.fn()});
    const field=find(community.render(),e=>e.props["aria-label"]==="Post body");expect(field.props.disabled).toBe(false);field.props.onChange({target:{value:"Edited details"}});
    await find(community.render(),e=>e.props.className==="full-composer").props.onSubmit({preventDefault:vi.fn()});expect(onCreatePhotoPost.mock.calls[1][2]).not.toBe(onCreatePhotoPost.mock.calls[0][2]);expect(onCreatePhotoPost.mock.calls[1][0].body).toBe("Edited details");expect(community.props.onToast).toHaveBeenLastCalledWith("Your post was saved. Refresh discussions to see it.");community.unmount();
  });
  it("allows local photo removal, rejects disguised files and releases remaining URLs on unmount",async()=>{
    const community=view({onCreatePhotoPost:vi.fn()});compose(community);await choose(community,[imageFile(),imageFile()]);find(community.render(),e=>e.props["aria-label"]==="Remove photo 1").props.onClick();expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
    await choose(community,[new File(["<svg/>"],"photo.png",{type:"image/png"})]);expect(community.props.onToast).toHaveBeenCalledWith(expect.stringContaining("valid JPG"));expect(URL.createObjectURL).toHaveBeenCalledTimes(2);community.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:photo-2");
  });
  it("cancels late validation and clears photo drafts when the account scope changes",async()=>{
    const community=view({onCreatePhotoPost:vi.fn()});compose(community);const pending=deferred<ArrayBuffer>();const file=imageFile();const bytes=await file.arrayBuffer();vi.spyOn(file,"arrayBuffer").mockReturnValue(pending.promise);
    find(community.render(),e=>e.props["aria-label"]==="Choose discussion photos").props.onChange({target:{files:[file],value:"selected"}});community.props.accessScopeKey="account-b";community.render();pending.resolve(bytes);await finishValidation();expect(URL.createObjectURL).not.toHaveBeenCalled();expect(elements(community.render()).some(e=>e.props.className==="community-photo-previews")).toBe(false);community.unmount();
  });
  it("blocks forced offline upload submission and preserves the local draft",async()=>{
    const onCreatePhotoPost=vi.fn();const community=view({onCreatePhotoPost});compose(community);await choose(community);community.props.readOnly=true;
    const tree=community.render();expect(button(tree,"Publish").props.disabled).toBe(true);await find(tree,e=>e.props.className==="full-composer").props.onSubmit({preventDefault:vi.fn()});expect(onCreatePhotoPost).not.toHaveBeenCalled();expect(text(community.render())).toContain("1/4");community.unmount();
  });
  it("keeps older text-only consumers compatible without showing unsupported photo actions",()=>{
    const community=view();compose(community);expect(elements(community.render()).some(e=>e.props["aria-label"]==="Choose discussion photos")).toBe(false);community.unmount();
  });
});
