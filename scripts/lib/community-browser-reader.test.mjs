import { describe, expect, it } from "vitest";
import { assembleCommunityCapture, captureCommunityBrowser, captureCommunityFeed, captureCommunityThreads, extractCommunityDom, normalizeCommunityThread } from "./community-browser-reader.mjs";

const authors = [{ externalId: "author-1", handles: ["steve-source"] }, { externalId: "author-2", handles: ["max-source"] }];
const sourceUrl = "https://academy.example.com/communities/groups/turf/home/posts/post-1";
const options = { expectedPostId: "post-1", authors, sourceUrl, channelExternalId: "channel-1", pinned: false };
const observation = () => ({
  thread: { externalId: "post-1", title: "Source discussion", body: "Full body", bodyComplete: true,
    authorExternalId: "author-1", displayedCommentCount: 2, mediaComplete: true, media: [],
    sourceCreatedAtLabel: "Thursday / 24 Sep 2026 / 09:03 AM" },
  comments: [
    { externalId: "comment-1", postExternalId: "post-1", parentExternalId: null, authorExternalId: "undefined", authorHandle: "@max-source",
      body: "Root", bodyComplete: true, mediaComplete: true, media: [] },
    { externalId: "comment-2", postExternalId: "post-1", parentExternalId: "comment-1", authorHandle: "@steve-source",
      body: "Reply", bodyComplete: true, mediaComplete: true, media: [] },
  ], controls: [], loading: false, observedGroupIds: ["group-1"],
});
const assembly = threads => ({ scope: { locationId: "location-1", groupId: "group-1" }, captureId: "capture-1",
  observedStartedAt: "2026-10-03T12:00:00Z", observedCompletedAt: "2026-10-03T12:01:00Z",
  feed: { cards: [{ externalId: "post-1" }], feedReachedEnd: true }, threads, expectedPostCount: 1, expectedPostIds: ["post-1"] });

// A small DOM contract fixture: only the standard Element methods the read-only
// evaluator uses. Its structure reproduces observed author siblings, nested
// comment containers, collage thumbnails and duplicate visible modal wrappers.
class ElementFixture {
  constructor(tag, attrs = {}, ownText = "", children = []) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.id = attrs.id ?? ""; this.ownText = ownText;
    this.children = children; for (const child of children) child.parentElement = this;
  }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join("\n"); }
  get innerText() { return this.textContent; }
  get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  getBoundingClientRect() { return this.attrs.hidden ? { width: 0, height: 0 } : this.attrs.rect ?? { left: 0, top: 0, right: 600, bottom: 700, width: 600, height: 700 }; }
  matches(selector) {
    return selector.split(",").some(part => {
      const tokens = part.trim().split(/\s+/), last = tokens.pop();
      const simple = (node, token) => {
        const tag = token.match(/^[a-zA-Z]+/)?.[0];
        if (tag && node.tagName !== tag.toUpperCase()) return false;
        for (const className of token.matchAll(/\.([a-zA-Z0-9_-]+)/g)) if (!(node.attrs.class ?? "").split(" ").includes(className[1])) return false;
        for (const attr of token.matchAll(/\[([a-zA-Z0-9_-]+)(?:(\^=|\$=|=)"([^"]*)")?\]/g)) {
          const value = node.getAttribute(attr[1]);
          if (value === null || attr[2] === "=" && value !== attr[3] || attr[2] === "^=" && !value.startsWith(attr[3]) || attr[2] === "$=" && !value.endsWith(attr[3])) return false;
        }
        return true;
      };
      if (!simple(this, last)) return false;
      let ancestor = this.parentElement;
      while (tokens.length) {
        const token = tokens.pop();
        while (ancestor && !simple(ancestor, token)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    });
  }
  closest(selector) { for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element; return null; }
  querySelectorAll(selector) {
    const result = [];
    const walk = element => { for (const child of element.children) { if (child.matches(selector)) result.push(child); walk(child); } };
    walk(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
const element = (tag, attrs, text, children) => new ElementFixture(tag, attrs, text, children);
function domFixture() {
  const author = (id, handle) => [element("div", { id: `popover-avatar-trigger-${id}` }),
    element("p", { id: "comment-unused-author-name-clickable" }, "Display name"), element("p", {}, handle)];
  const comment = (id, handle, children = []) => {
    const nodes = author("undefined", handle); nodes[1].id = nodes[1].attrs.id = `comment-${id}-author-name-clickable`;
    return element("div", { id: `comment-${id}-content-div` }, "", [...nodes,
      element("div", { id: `comment-content-${id}` }, `Body ${id}`), ...children]);
  };
  const reply = comment("comment-2", "@steve-source", [element("video", { src: "blob:https://academy.example.com/private-source" })]);
  const rootComment = comment("comment-1", "@max-source", [element("div", { class: "comments-list" }, "", [reply])]);
  const image = element("img", { id: "thumbnail-image-main", src: "https://cdn.example.com/source.webp" });
  const postContent = element("div", { id: "post-view-content" }, "", [element("h1", { id: "post-view-content-title" }, "Full title"),
    element("div", { class: "post-text-content" }, "", [element("div", { class: "editor-rendered-content" }, "Full body")]),
    element("div", { id: "media-collage-container" }, "", [element("div", { id: "media-collage-item-0", "aria-label": "View media 1 of 1" }, "", [
      element("img", { id: "thumbnail-image-background", src: "https://cdn.example.com/blur.webp" }), image])])]);
  const modal = element("div", { id: "post-view-modal-" }, "", [
    element("div", { id: "popover-avatar-trigger-author-1" }, "", [element("img", { src: "https://cdn.example.com/avatar.webp" })]),
    postContent, element("p", { id: "post-card-web-comments-div" }, "2 Comments"),
    element("div", { id: "post-card-post-1-comment-button" }), rootComment,
    element("button", { id: "comments-view-more-replies-button" }, "View more replies"),
    element("button", { "data-analytics": JSON.stringify({ groupId: "group-1" }) }),
  ]);
  const staleModal = element("div", { id: "post-view-modal-" }, "", [element("div", { id: "post-card-old-post-comment-button" })]);
  const main = element("main", { id: "communities-layout-main", rect: { left: 0, top: -2000, right: 625, bottom: 5000, width: 625, height: 7000 } }, "You've reached the end of the posts");
  const body = element("body", {}, "", [main, staleModal, modal]);
  const documentFixture = element("document", {}, "", [body]);
  documentFixture.body = body; documentFixture.documentElement = { clientWidth: 625, clientHeight: 813 };
  return { documentFixture, modal, rootComment, reply, image };
}

describe("read-only observed DOM extraction", () => {
  it("selects the current modal and reads handles, parent IDs and actual images", () => {
    const { documentFixture } = domFixture();
    const result = extractCommunityDom({}, documentFixture);
    expect(result.thread).toMatchObject({ externalId: "post-1", title: "Full title", body: "Full body", authorExternalId: "author-1", displayedCommentCount: 2 });
    expect(result.thread.media).toEqual([{ type: "image", url: "https://cdn.example.com/source.webp" }]);
    expect(result.comments[0]).toMatchObject({ externalId: "comment-1", authorHandle: "@max-source", parentExternalId: null, media: [] });
    expect(result.comments[1]).toMatchObject({ externalId: "comment-2", authorHandle: "@steve-source", parentExternalId: "comment-1", mediaComplete: false });
    expect(result.comments[1].unsupported).toContainEqual({ code: "non_durable_media_url", tag: "VIDEO" });
    expect(result.observedGroupIds).toEqual(["group-1"]);
    expect(result.controls).toEqual([{ id: "comments-view-more-replies-button", label: "View more replies", enabled: true }]);
  });

  it("excludes reply media from its parent and avatar/background images from posts", () => {
    const result = extractCommunityDom({}, domFixture().documentFixture);
    expect(result.comments[0].mediaComplete).toBe(true);
    expect(result.comments[0].unsupported).toEqual([]);
    expect(result.thread.media).toHaveLength(1);
    expect(JSON.stringify(result.thread.media)).not.toMatch(/avatar|blur/);
  });

  it("reads the observed standalone detail card with the same exact identity and reply ownership guards", () => {
    const { documentFixture, modal } = domFixture();
    documentFixture.body.children = documentFixture.body.children.filter(node => node === modal || node.id === "communities-layout-main");
    modal.id = modal.attrs.id = "post-view-content-card";
    const channel = element("button", { id: "post-card-channel-clickable" }, "", [
      element("p", { id: "post-card-channel-clickable-label" }, "Announcements"),
    ]);
    channel.parentElement = modal; modal.children.push(channel);
    const result = extractCommunityDom({}, documentFixture);
    expect(result.thread).toMatchObject({ externalId: "post-1", bodyComplete: true, authorExternalId: "author-1",
      displayedCommentCount: 2, categoryControlText: "Announcements", categoryControlKind: "standalone_button" });
    expect(result.comments[0]).toMatchObject({ externalId: "comment-1", parentExternalId: null, media: [] });
    expect(result.comments[1]).toMatchObject({ externalId: "comment-2", parentExternalId: "comment-1", mediaComplete: false });
    expect(result.comments[1].unsupported).toContainEqual({ code: "non_durable_media_url", tag: "VIDEO" });
    modal.children = modal.children.filter(node => node.id !== "post-card-post-1-comment-button");
    expect(normalizeCommunityThread(extractCommunityDom({}, documentFixture), options).complete).toBe(false);
  });

  it("keeps modal identity authoritative over a stale standalone detail card", () => {
    const { documentFixture } = domFixture();
    const stale = element("div", { id: "post-view-content-card" }, "", [element("div", { id: "post-card-stale-comment-button" })]);
    stale.parentElement = documentFixture.body; documentFixture.body.children.push(stale);
    expect(extractCommunityDom({}, documentFixture).thread.externalId).toBe("post-1");
  });

  it("keeps the outer modal category root when it contains a standalone detail card", () => {
    const { documentFixture, modal } = domFixture();
    const card = element("div", { id: "post-view-content-card" }, "", [...modal.children,
      element("button", { id: "post-card-actions-trigger" })]);
    const header = element("div", { id: "post-view-modal--title" }, "", [element("p", { class: "cursor-pointer" }, "#Equipment")]);
    card.parentElement = modal; header.parentElement = modal; modal.children = [header, card];
    const result = extractCommunityDom({}, documentFixture);
    expect(result).toMatchObject({ detailRootId: "post-view-modal-", ownerPinTriggerObserved: true });
    expect(result.thread).toMatchObject({ externalId: "post-1", categoryControlText: "#Equipment" });
    expect(result.thread).not.toHaveProperty("categoryControlKind");
    expect(result.comments[1]).toMatchObject({ externalId: "comment-2", parentExternalId: "comment-1", mediaComplete: false });
  });

  it("accepts only one exact visible owner-menu pin action for the current rendered post", () => {
    const { documentFixture } = domFixture();
    const option = element("div", { id: "hr-dropdown-option-pinToHome", role: "menuitem" }, "Pin to All Posts");
    option.parentElement = documentFixture.body; documentFixture.body.children.push(option);
    expect(extractCommunityDom({}, documentFixture).homePinMenu).toEqual({ postExternalId: "post-1", actionId: "hr-dropdown-option-pinToHome", pinned: false });
    option.id = option.attrs.id = "hr-dropdown-option-unpinFromHome"; option.ownText = "Unpin from All Posts";
    expect(extractCommunityDom({}, documentFixture).homePinMenu.pinned).toBe(true);
    option.ownText = "Pin to Channel";
    expect(extractCommunityDom({}, documentFixture).homePinMenu).toBeNull();
    option.ownText = "Unpin from All Posts"; option.attrs.role = "button";
    expect(extractCommunityDom({}, documentFixture).homePinMenu).toBeNull();
    option.attrs.role = "menuitem";
    const contradictory = element("div", { id: "hr-dropdown-option-pinToHome", role: "menuitem" }, "Pin to All Posts");
    contradictory.parentElement = documentFixture.body; documentFixture.body.children.push(contradictory);
    expect(extractCommunityDom({}, documentFixture).homePinMenu).toBeNull();
    option.attrs.hidden = true; contradictory.attrs.hidden = true;
    expect(extractCommunityDom({}, documentFixture).homePinMenu).toBeNull();
  });

  it("derives a scroll point inside the visible viewport intersection", () => {
    const result = extractCommunityDom({}, domFixture().documentFixture);
    expect(result.feedScrollPoint).toEqual([313, 569]);
    expect(result.feedReachedEnd).toBe(true);
  });

  it("records a truncated collage instead of certifying unseen attachments", () => {
    const { documentFixture, image } = domFixture();
    image.parentElement.attrs["aria-label"] = "View media 1 of 6";
    expect(extractCommunityDom({}, documentFixture).thread).toMatchObject({ mediaComplete: false, unsupported: [{ code: "incomplete_media_collage" }] });
  });

  it("observes zero only from the exact loaded empty discussion marker", () => {
    const { documentFixture, modal } = domFixture();
    modal.children = modal.children.filter(child => !["post-card-web-comments-div", "comment-comment-1-content-div", "comments-view-more-replies-button"].includes(child.id));
    const empty = element("div", { id: "comments-container" }, "No comments yet\nBe the first to comment!");
    empty.parentElement = modal; modal.children.push(empty);
    const result = extractCommunityDom({}, documentFixture);
    expect(result.zeroCommentsObserved).toBe(true);
    expect(result.thread.displayedCommentCount).toBe(0);
    empty.ownText = "Loading";
    expect(extractCommunityDom({}, documentFixture).thread.displayedCommentCount).toBeNull();
  });

  it("reports only the visible modal header category as a routing control", () => {
    const { documentFixture, modal } = domFixture();
    const header = element("div", { id: "post-view-modal--title" }, "", [element("p", { class: "cursor-pointer hover:underline" }, "#Equipment")]);
    header.parentElement = modal; modal.children.push(header);
    const result = extractCommunityDom({}, documentFixture);
    expect(result.thread).toMatchObject({ categoryName: "#Equipment", categoryControlText: "#Equipment" });
    header.children[0].attrs.class = "plain";
    expect(extractCommunityDom({}, documentFixture).thread).not.toHaveProperty("categoryControlText");
  });

  it("does not certify a video wrapper before its video node and URL mount", () => {
    const { documentFixture, reply } = domFixture();
    reply.children = reply.children.filter(child => child.tagName !== "VIDEO");
    const wrapper = element("div", { id: "video-player-license-source-license" });
    wrapper.parentElement = reply; reply.children.push(wrapper);
    const comment = extractCommunityDom({}, documentFixture).comments[1];
    expect(comment).toMatchObject({ mediaComplete: false, attachmentPending: true, pendingVideoDomIds: ["video-player-license-source-license"] });
    expect(comment.unsupported).toContainEqual({ code: "video_content_not_observed", tag: "VIDEO", sourceAssetDomId: "video-player-license-source-license" });
  });

  it("treats an empty hydrated placeholder as unknown and excludes nested reply media", () => {
    const { documentFixture, rootComment, reply } = domFixture();
    rootComment.querySelector('[id="comment-content-comment-1"]').ownText = "";
    reply.querySelector('[id="comment-content-comment-2"]').ownText = "";
    const comments = extractCommunityDom({}, documentFixture).comments;
    expect(comments[0]).toMatchObject({ body: "", bodyComplete: false, mediaComplete: false, media: [] });
    expect(comments[1]).toMatchObject({ body: "", bodyComplete: false, mediaComplete: false });
    reply.children.find(child => child.tagName === "VIDEO").attrs.src = "https://cdn.example.com/proven-video.mp4";
    expect(extractCommunityDom({}, documentFixture).comments[1]).toMatchObject({ body: "", bodyComplete: true, mediaComplete: true });
  });

  it("parses the observed adjacent featured count and records both feed contexts", () => {
    const { documentFixture } = domFixture();
    const featured = element("section", { class: "featured-content" }, "", [
      element("div", { class: "featured-post-card" }, "", [element("article", { id: "post-card-post-1-card" })]),
    ]);
    const regular = element("div", { class: "post-item" }, "", [element("article", { id: "post-card-post-1-card" })]);
    for (const node of [element("button", { id: "featured-posts-toggle" }, "Featured Posts1"), featured, regular]) {
      node.parentElement = documentFixture.body; documentFixture.body.children.push(node);
    }
    const result = extractCommunityDom({}, documentFixture);
    expect(result).toMatchObject({ expectedFeaturedCount: 1, observedFeaturedCount: 1, featuredCaptureComplete: true });
    expect(result.cards.map(card => ({ pinned: card.pinned, complete: card.pinnedComplete }))).toEqual([
      { pinned: true, complete: true }, { pinned: false, complete: true },
    ]);
  });
});

describe("observed Community thread normalization", () => {
  it("preserves real nested identities and independently mapped handles without fabricated dates", () => {
    const result = normalizeCommunityThread(observation(), options);
    expect(result.complete).toBe(true);
    expect(result.comments[0].authorExternalId).toBe("author-2");
    expect(result.comments[1]).toMatchObject({ authorExternalId: "author-1", parentExternalId: "comment-1" });
    expect(result.post).toMatchObject({ categoryExternalId: "channel-1", pinned: false, media: [] });
    expect(result.evidence).toMatchObject({ capturedCommentCount: 2, displayedCommentCount: 2, timestampTimezoneVerified: false });
    expect(result.post).not.toHaveProperty("sourceCreatedAt");
    expect(result.post).not.toHaveProperty("sourceUpdatedAt");
    expect(result.comments.every(row => !Object.hasOwn(row, "authorHandle"))).toBe(true);
    expect(result.evidence.authorHandles).toEqual([
      { externalId: "comment-1", authorHandle: "@max-source" }, { externalId: "comment-2", authorHandle: "@steve-source" },
    ]);
  });

  it("retains exact encoded channel slugs and keeps display aliases in private evidence", () => {
    const source = observation(); source.thread.categoryName = "#Chemistry & Cleaners";
    const result = normalizeCommunityThread(source, { ...options, channelExternalId: "Chemistry-%26-Cleaners-0fMEH" });
    expect(result.post).toMatchObject({ categoryComplete: true, categoryExternalId: "Chemistry-%26-Cleaners-0fMEH" });
    expect(result.post).not.toHaveProperty("categoryName");
    expect(result.evidence.categoryName).toBe("#Chemistry & Cleaners");
    expect(normalizeCommunityThread(source, { ...options, channelExternalId: "Chemistry-%2-Cleaners" }).post.categoryComplete).toBe(false);
  });

  it("deduplicates identical comment IDs from repeated visible modal content", () => {
    const source = observation(); source.comments.push({ ...source.comments[1] });
    expect(normalizeCommunityThread(source, options).comments).toHaveLength(2);
    expect(normalizeCommunityThread(source, options).complete).toBe(true);
  });

  it("rejects contradictory copies of the same source comment", () => {
    const source = observation(); source.comments.push({ ...source.comments[1], body: "Conflicting copy" });
    const result = normalizeCommunityThread(source, options);
    expect(result.complete).toBe(false);
    expect(result.issues).toContainEqual({ code: "contradictory_duplicate", externalId: "comment-2" });
  });

  it.each([
    [source => { source.thread.externalId = "other"; }, "wrong_or_missing_post"],
    [source => { source.thread.displayedCommentCount = 3; }, "comment_count_mismatch"],
    [source => { source.thread.displayedCommentCount = null; }, "comment_count_mismatch"],
    [source => { source.controls.push({ id: "comments-view-more-replies-button" }); }, "thread_pagination_remaining"],
    [source => { source.loading = true; }, "thread_pagination_remaining"],
    [source => { source.comments[1].parentExternalId = "unloaded"; }, "unresolved_thread_parent"],
    [source => { source.comments[0].parentExternalId = "comment-2"; }, "comment_parent_cycle"],
    [source => { source.comments[1].postExternalId = "other"; }, "unresolved_thread_parent"],
    [source => { source.comments[1].authorExternalId = "author-2"; }, "conflicting_author"],
  ])("fails closed on incomplete or contradictory source observations", (change, expected) => {
    const source = observation(); change(source);
    const result = normalizeCommunityThread(source, options);
    expect(result.complete).toBe(false);
    expect(result.issues.map(row => row.code)).toContain(expected);
  });

  it("holds missing author identities without name guesses and rejects ambiguous verified handles", () => {
    const source = observation(); source.comments[0].authorHandle = null; source.comments[0].authorName = "Max Source";
    const result = normalizeCommunityThread(source, options);
    expect(result.complete).toBe(true);
    expect(result.comments[0]).toMatchObject({ authorComplete: false, bodyComplete: true });
    expect(result.comments[0]).not.toHaveProperty("authorExternalId");
    expect(result.evidence.heldAuthors).toEqual([{ entity: "comment", externalId: "comment-1", code: "unresolved_author" }]);
    const ambiguous = [...authors, { externalId: "author-3", handles: ["max-source"] }];
    expect(normalizeCommunityThread(observation(), { ...options, authors: ambiguous }).issues[0].code).toBe("ambiguous_author_handle");
  });

  it("holds an unregistered actual source avatar instead of guessing its target member", () => {
    const source = observation(); source.thread.authorExternalId = "new-source-author";
    const result = normalizeCommunityThread(source, options);
    expect(result.complete).toBe(true);
    expect(result.post).toMatchObject({ authorComplete: false, commentsComplete: true });
    expect(result.post).not.toHaveProperty("authorExternalId");
    expect(result.comments.every(row => row.authorComplete)).toBe(true);
    expect(result.evidence.heldAuthors).toEqual([{ entity: "post", externalId: "post-1", code: "unresolved_author", sourceAuthorExternalId: "new-source-author" }]);
    source.comments[0].authorExternalId = "different-source-author";
    const conflicting = normalizeCommunityThread(source, options);
    expect(conflicting.complete).toBe(false);
    expect(conflicting.issues).toContainEqual({ code: "conflicting_author", externalId: "comment-1" });
    expect(conflicting.comments[0]).toMatchObject({ authorComplete: false });
    expect(conflicting.comments[0]).not.toHaveProperty("authorExternalId");
  });

  it("holds unobserved source bodies without publishing placeholder empty text", () => {
    const source = observation(); source.thread.body = ""; source.thread.bodyComplete = false;
    source.comments[0].body = ""; source.comments[0].bodyComplete = false;
    const result = normalizeCommunityThread(source, options);
    expect(result.complete).toBe(true);
    expect(result.post).toMatchObject({ bodyComplete: false, commentsComplete: true });
    expect(result.post).not.toHaveProperty("body");
    expect(result.comments[0]).toMatchObject({ bodyComplete: false });
    expect(result.comments[0]).not.toHaveProperty("body");
    expect(result.evidence.heldBodies).toEqual([
      { entity: "comment", externalId: "comment-1", code: "body_content_not_observed" },
      { entity: "post", externalId: "post-1", code: "body_content_not_observed" },
    ]);
  });

  it("keeps unknown category, pins and blob video separate from verified empty fields", () => {
    const source = observation();
    source.thread.mediaComplete = false;
    source.thread.unsupported = [{ code: "non_durable_media_url", tag: "VIDEO" }];
    const result = normalizeCommunityThread(source, { ...options, pinned: undefined, channelExternalId: undefined });
    expect(result.post).toMatchObject({ categoryComplete: false, pinnedComplete: false, mediaComplete: false });
    expect(result.post).not.toHaveProperty("media");
    expect(result.post).not.toHaveProperty("pinned");
    expect(result.post).not.toHaveProperty("categoryExternalId");
    expect(result.evidence.unsupportedMedia).toEqual([{ entity: "post", externalId: "post-1", ...source.thread.unsupported[0] }]);
  });

  it("rejects unsafe media instead of storing blob or local URLs", () => {
    const source = observation(); source.thread.media = [{ type: "video", url: "blob:https://academy.example.com/video" }];
    const result = normalizeCommunityThread(source, options);
    expect(result.complete).toBe(false);
    expect(result.post.mediaComplete).toBe(false);
    expect(result.post).not.toHaveProperty("media");
  });
});

describe("full source coverage", () => {
  it("requires independent count and feed end, with one complete detail per post", () => {
    const result = assembleCommunityCapture(assembly([normalizeCommunityThread(observation(), options)]));
    expect(result.capture.coverage).toEqual({ posts: "complete", comments: "complete" });
    expect(result.capture.posts).toHaveLength(1);
    expect(result.capture.comments).toHaveLength(2);
  });

  it.each([
    [args => { args.expectedPostCount = 2; }, "post_count_mismatch"],
    [args => { args.expectedPostCount = undefined; }, "post_count_mismatch"],
    [args => { args.expectedPostIds = ["other"]; }, "post_identity_coverage_mismatch"],
    [args => { args.feed.feedReachedEnd = false; }, "feed_end_not_observed"],
    [args => { args.threads = []; }, "post_details_missing"],
    [args => { args.threads.push(args.threads[0]); }, "unexpected_or_duplicate_thread"],
  ])("keeps incomplete captures partial", (change, expected) => {
    const args = assembly([normalizeCommunityThread(observation(), options)]); change(args);
    const result = assembleCommunityCapture(args);
    expect(result.capture.coverage.comments).toBe("partial");
    expect(result.evidence.issues.map(row => row.code)).toContain(expected);
  });

  it("deduplicates identical feed cards without miscounting featured posts", () => {
    const args = assembly([normalizeCommunityThread(observation(), options)]); args.feed.cards.push({ externalId: "post-1" });
    expect(assembleCommunityCapture(args).capture.coverage.posts).toBe("complete");
  });
});

describe("CUA only orchestration", () => {
  it("observes each scroll/navigation/comment expansion and applies no database writes", async () => {
    const events = [], source = observation();
    const feed = { cards: [{ externalId: "post-1", sourceUrl: "/communities/groups/turf/home/posts/post-1" }],
      feedReachedEnd: true, observedGroupIds: ["group-1"] };
    const reads = [feed, { ...source, comments: [source.comments[0]], controls: [{ id: "comments-view-more-replies-button", enabled: true }] }, source];
    const locator = { last: () => locator, first: () => locator, locator: () => locator,
      click: async () => { events.push("click"); }, waitFor: async () => { events.push("wait"); } };
    const tab = {
      url: async () => "https://academy.example.com/communities/groups/turf/home",
      reload: async () => { events.push("reload"); },
      goto: async () => { events.push("goto"); }, scroll: async () => { events.push("scroll"); },
      getAXState: async () => { events.push("observe"); },
      playwright: { evaluate: async fn => { expect(fn).toBe(extractCommunityDom); events.push("read"); return reads.shift(); }, locator: () => locator },
    };
    const result = await captureCommunityBrowser({ tab, scope: { locationId: "location-1", groupId: "group-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", expectedPostCount: 1,
      authors, channelByPost: { "post-1": "channel-1" }, pinnedByPost: { "post-1": false } });
    expect(events).toEqual(["reload", "observe", "read", "goto", "observe", "wait", "wait", "wait", "wait", "observe", "read", "click", "observe", "wait", "observe", "read"]);
    expect(result.capture.coverage).toEqual({ posts: "complete", comments: "complete" });
  });

  it("rejects a permalink outside the allowlisted group before navigation", async () => {
    let navigations = 0;
    const tab = { url: async () => "https://academy.example.com/communities/groups/turf/home", getAXState: async () => {}, reload: async () => {},
      goto: async () => { navigations++; }, scroll: async () => {}, playwright: { evaluate: async () => ({
        cards: [{ externalId: "post-1", sourceUrl: "https://other.example.com/steal" }], feedReachedEnd: true, observedGroupIds: [],
      }) } };
    await expect(captureCommunityBrowser({ tab, scope: { locationId: "location-1", groupId: "group-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", expectedPostCount: 1 })).rejects.toThrow("outside the verified group");
    expect(navigations).toBe(0);
  });

  it("does not navigate to a source from another scoped group", async () => {
    const tab = { url: async () => "https://academy.example.com/communities/groups/turf/home", getAXState: async () => {}, reload: async () => {},
      goto: async () => {}, scroll: async () => {}, playwright: { evaluate: async () => ({ cards: [], feedReachedEnd: true, observedGroupIds: ["other-group"] }) } };
    await expect(captureCommunityBrowser({ tab, scope: { locationId: "location-1", groupId: "group-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", expectedPostCount: 0 })).rejects.toThrow("scope mismatch");
  });

  it("checks the source Mongo identity separately from the server's enrolled group slug", async () => {
    const tab = { url: async () => "https://academy.example.com/communities/groups/turf/home", getAXState: async () => {}, reload: async () => {},
      goto: async () => {}, scroll: async () => {}, playwright: { evaluate: async () => ({ cards: [], feedReachedEnd: true, observedGroupIds: ["mongo-group-1"] }) } };
    const result = await captureCommunityBrowser({ tab, scope: { locationId: "location-1", groupId: "turf" }, sourceGroupId: "mongo-group-1",
      feedUrl: "https://academy.example.com/communities/groups/turf/home", expectedPostCount: 0 });
    expect(result.capture.scope.groupId).toBe("turf");
    await expect(captureCommunityBrowser({ tab, scope: { locationId: "location-1", groupId: "different-slug" }, sourceGroupId: "mongo-group-1",
      feedUrl: "https://academy.example.com/communities/groups/turf/home", expectedPostCount: 0 })).rejects.toThrow("slug");
  });

  it("waits for asynchronously arriving comments before comparing source counts", async () => {
    const final = observation(), pending = { ...final, comments: [], controls: [], loading: true };
    const reads = [pending, final], waits = [];
    const locator = { last: () => locator, first: () => locator, locator: selector => { waits.push(selector); return locator; }, waitFor: async () => {} };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => {},
      playwright: { evaluate: async () => reads.shift(), locator: () => locator } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors });
    expect(waits).toContain('[id^="comment-"][id$="-content-div"]');
    expect(result[0].complete).toBe(true);
    expect(result[0].comments).toHaveLength(2);
  });

  it("waits for explicit empty state when no source count is rendered", async () => {
    const final = observation(); final.thread.displayedCommentCount = 0; final.comments = []; final.zeroCommentsObserved = true;
    const pending = { ...final, thread: { ...final.thread, displayedCommentCount: null }, zeroCommentsObserved: false, loading: true };
    const reads = [pending, final], emptyQueries = [];
    const locator = { last: () => locator, first: () => locator, locator: () => locator, or: () => locator,
      getByText: (label, args) => { emptyQueries.push([label, args]); return locator; }, waitFor: async () => {} };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => {},
      playwright: { evaluate: async () => reads.shift(), locator: () => locator } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors });
    expect(emptyQueries).toEqual([["No comments yet", { exact: true }]]);
    expect(result[0].complete).toBe(true);
  });

  it("waits for nested reply pagination after roots render before declaring a short thread", async () => {
    const final = observation(), rootOnly = { ...final, comments: [final.comments[0]] };
    const reads = [rootOnly, { ...rootOnly, controls: [{ id: "comments-view-more-replies-button", enabled: true }] }, final];
    const queries = [], events = [];
    const locator = { last: () => locator, first: () => locator,
      locator: selector => { queries.push(selector); return locator; }, nth: index => { events.push(["nth", index]); return locator; },
      or: () => { events.push("or"); return locator; }, waitFor: async () => { events.push("wait"); },
      click: async () => { events.push("click"); } };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => { events.push("observe"); },
      playwright: { evaluate: async () => { events.push("read"); return reads.shift(); }, locator: () => locator } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors });
    expect(queries).toContain('[id="comments-view-more-comments-button"], [id="comments-view-more-replies-button"]');
    expect(events).toContainEqual(["nth", 1]);
    expect(events.slice(events.indexOf("or"), events.indexOf("or") + 5)).toEqual(["or", "wait", "observe", "read", "click"]);
    expect(result[0].complete).toBe(true);
    expect(result[0].comments).toHaveLength(2);
  });

  it("waits for asynchronously hydrated own comment bodies and preserves unsupported video", async () => {
    const final = observation(); final.comments[0].mediaComplete = false;
    final.comments[0].unsupported = [{ code: "non_durable_media_url", tag: "VIDEO", sourceAssetDomId: "video-player-license-source-license" }];
    const pending = { ...final, comments: [{ ...final.comments[0], body: "", bodyComplete: false, mediaComplete: true, unsupported: [] }, final.comments[1]] };
    const reads = [pending, final], events = [];
    const locator = { last: () => locator, first: () => locator, locator: selector => { events.push(["selector", selector]); return locator; },
      filter: args => { expect(args.hasText).toEqual(/\S/); events.push("body-text"); return locator; }, or: () => locator,
      waitFor: async () => { events.push("wait"); } };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => { events.push("observe"); },
      playwright: { evaluate: async () => { events.push("read"); return reads.shift(); }, locator: () => locator } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors });
    expect(events).toContainEqual(["selector", '[id="comment-content-comment-1"]']);
    expect(events.slice(events.indexOf("body-text") + 2)).toEqual(["wait", "observe", "read"]);
    expect(result[0].complete).toBe(true);
    expect(result[0].comments[0]).toMatchObject({ body: "Root", bodyComplete: true, mediaComplete: false });
    expect(result[0].comments[0]).not.toHaveProperty("media");
    expect(result[0].evidence.unsupportedMedia[0]).toMatchObject({ entity: "comment", sourceAssetDomId: "video-player-license-source-license" });
  });

  it("holds a body that never hydrates while preserving structural thread coverage", async () => {
    const source = observation(); source.comments[0].body = ""; source.comments[0].bodyComplete = false; source.comments[0].mediaComplete = false;
    let settling = false;
    const locator = { last: () => locator, first: () => locator, locator: () => locator, or: () => locator,
      filter: () => { settling = true; return locator; }, waitFor: async () => { if (settling) throw new Error("Timeout waiting for source content"); } };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => {}, playwright: { evaluate: async () => source, locator: () => locator } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors });
    expect(result[0].complete).toBe(true);
    expect(result[0].comments[0]).toMatchObject({ bodyComplete: false, mediaComplete: false });
    expect(result[0].comments[0]).not.toHaveProperty("body");
    expect(result[0].comments[0]).not.toHaveProperty("media");
    expect(result[0].evidence.fieldSettlingIssue).toBe("source_body_or_attachment_timeout");
  });

  it("settles asynchronous media after full body hydration before declaring empty attachments", async () => {
    const initial = observation(), final = observation();
    final.comments[0].mediaComplete = false;
    final.comments[0].unsupported = [{ code: "non_durable_media_url", tag: "VIDEO", sourceAssetDomId: "video-player-license-late-source" }];
    const reads = [initial, final], events = [];
    const locator = { last: () => locator, first: () => locator, locator: () => locator, waitFor: async () => {} };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => { events.push("observe"); },
      playwright: { evaluate: async () => { events.push("read"); return reads.shift(); }, locator: () => locator,
        waitForLoadState: async args => { events.push(["load", args]); } } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors });
    expect(events.slice(-3)).toEqual([["load", { state: "networkidle", timeoutMs: 10000 }], "observe", "read"]);
    expect(result[0].comments[0]).toMatchObject({ body: "Root", mediaComplete: false });
    expect(result[0].comments[0]).not.toHaveProperty("media");
    expect(result[0].evidence).toMatchObject({ mediaLoadState: "networkidle", unsupportedMedia: [{ entity: "comment", externalId: "comment-1", ...final.comments[0].unsupported[0] }] });
  });

  it("treats a networkidle timeout as unknown media rather than verified empty media", async () => {
    const source = observation();
    const locator = { last: () => locator, first: () => locator, locator: () => locator, waitFor: async () => {} };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => {},
      playwright: { evaluate: async () => source, locator: () => locator, waitForLoadState: async () => { throw new Error("Timeout waiting for networkidle"); } } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors });
    expect(result[0].complete).toBe(true);
    expect(result[0].post.mediaComplete).toBe(false);
    expect(result[0].comments.every(row => row.mediaComplete === false && !Object.hasOwn(row, "media"))).toBe(true);
    expect(result[0].evidence.mediaLoadState).toBe("timeout");
  });

  it("preserves previously observed missing media by exact record and DOM identity", async () => {
    const source = observation(), domId = "video-player-license-previous-source";
    let currentSelector;
    const locator = { last: () => locator, first: () => locator, locator: selector => { currentSelector = selector; return locator; },
      waitFor: async () => { if (currentSelector?.startsWith(`[id="${domId}"]`)) {
        expect(currentSelector).toContain(':not([id^="comment-"][id$="-content-div"]:not([id="comment-comment-1-content-div"]) *)');
        throw new Error("Timeout waiting for known media");
      } } };
    const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => {},
      playwright: { evaluate: async () => source, locator: () => locator, waitForLoadState: async () => {} } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors,
      expectedMediaByRecord: { "comment:comment-1": [{ sourceAssetDomId: domId }] } });
    expect(result[0].complete).toBe(true);
    expect(result[0].comments[0].mediaComplete).toBe(false);
    expect(result[0].comments[0]).not.toHaveProperty("media");
    expect(result[0].comments[1]).toMatchObject({ mediaComplete: true, media: [] });
    expect(result[0].evidence.unsupportedMedia).toContainEqual({ entity: "comment", externalId: "comment-1", code: "previously_observed_media_not_available", tag: "VIDEO", sourceAssetDomId: domId });
  });

  it("retains positive featured evidence when the regular feed repeats the same post", async () => {
    const tab = { url: async () => "https://academy.example.com/communities/groups/turf/home", reload: async () => {}, scroll: async () => {}, getAXState: async () => {},
      playwright: { evaluate: async () => ({ cards: [
        { externalId: "post-1", pinned: true, pinnedComplete: true }, { externalId: "post-1", pinned: false, pinnedComplete: true },
      ], feedReachedEnd: true, observedGroupIds: [] }) } };
    const feed = await captureCommunityFeed({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home" });
    expect(feed.cards).toEqual([{ externalId: "post-1", pinned: true, pinnedComplete: true }]);
  });

  it("waits for regular source data after a transient empty feed placeholder", async () => {
    const pending = { cards: [], feedReachedEnd: false, regularPostCount: 0, observedGroupIds: [] };
    const final = { cards: [{ externalId: "post-1" }], feedReachedEnd: true, regularPostCount: 1, observedGroupIds: [] };
    const reads = [pending, final], events = [];
    const locator = { first: () => locator, locator: () => locator, getByText: () => locator, or: () => locator,
      waitFor: async args => { events.push(["wait", args.state]); } };
    const tab = { url: async () => "https://academy.example.com/communities/groups/turf/home", reload: async () => {}, scroll: async () => {},
      getAXState: async () => { events.push("observe"); }, playwright: { evaluate: async () => { events.push("read"); return reads.shift(); }, locator: () => locator } };
    const result = await captureCommunityFeed({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home" });
    expect(events).toEqual(["observe", "read", ["wait", "visible"], "observe", "read"]);
    expect(result.cards).toEqual(final.cards);
  });

  it("rejects non-feed group pages and unobserved channel routes before navigation", async () => {
    let navigations = 0;
    const tab = { url: async () => "unused", goto: async () => { navigations++; }, scroll: async () => {}, getAXState: async () => {}, playwright: { evaluate: async () => {} } };
    const args = { tab, scope: { groupId: "group-1", locationId: "location-1" }, feedUrl: "https://academy.example.com/communities/groups/turf/home" };
    for (const path of ["about", "members", "home/posts/post-1", "channels/Unknown-1"]) {
      await expect(captureCommunityFeed({ ...args, readUrl: `https://academy.example.com/communities/groups/turf/${path}` })).rejects.toThrow("observed channels");
    }
    expect(navigations).toBe(0);
  });

  it("derives a channel identity from the observed route even when display names are duplicated", async () => {
    const source = observation(); source.thread.categoryControlText = "#Announcements";
    const categoryUrl = "https://academy.example.com/communities/groups/turf/channels/Announcements-5xMN0C", events = [];
    const locator = { last: () => locator, first: () => locator, locator: selector => { events.push(["selector", selector]); return locator; },
      waitFor: async () => {}, getByText: (label, args) => { events.push(["text", label, args.exact]); return locator; }, click: async () => { events.push("click"); } };
    const tab = { goto: async () => {}, scroll: async () => {}, url: async () => categoryUrl, getAXState: async () => { events.push("observe"); },
      playwright: { evaluate: async () => source, locator: () => locator } };
    const result = await captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors,
      resolveCategory: true, sourceObservedChannels: [categoryUrl, "https://academy.example.com/communities/groups/turf/channels/Announcements-3uKFck"] });
    expect(result[0].post).toMatchObject({ categoryComplete: true, categoryExternalId: "Announcements-5xMN0C" });
    expect(events).toContainEqual(["text", "#Announcements", true]);
    expect(events.slice(-2)).toEqual(["click", "observe"]);
    expect(result[0].evidence).toMatchObject({ categorySourceUrl: categoryUrl, categoryIdentityFromObservedRoute: true });
  });

  it("rejects a category click that routes outside the independently observed channel URLs", async () => {
    const source = observation(); source.thread.categoryControlText = "#Equipment";
    const locator = { last: () => locator, first: () => locator, locator: () => locator, waitFor: async () => {}, getByText: () => locator, click: async () => {} };
    const tab = { goto: async () => {}, scroll: async () => {}, url: async () => "https://other.example.com/channels/Equipment-1", getAXState: async () => {},
      playwright: { evaluate: async () => source, locator: () => locator } };
    await expect(captureCommunityThreads({ tab, scope: { groupId: "group-1", locationId: "location-1" },
      feedUrl: "https://academy.example.com/communities/groups/turf/home", cards: [{ externalId: "post-1", sourceUrl }], authors,
      resolveCategory: true, sourceObservedChannels: ["https://academy.example.com/communities/groups/turf/channels/Equipment-0kVK8Z"] })).rejects.toThrow("independently observed");
  });

  it("routes the standalone channel button through the same exact observed URL allowlist", async () => {
    const source = observation(); Object.assign(source.thread, { categoryControlText: "Announcements", categoryControlKind: "standalone_button" });
    const channelUrl = "https://academy.example.com/communities/groups/turf/channels/Announcements-5xMN0C", selectors = [];
    let routedUrl = channelUrl;
    const locator = { last: () => locator, first: () => locator, locator: selector => { selectors.push(selector); return locator; },
      waitFor: async () => {}, getByText: () => locator, click: async () => {} };
    const tab = { goto: async () => {}, scroll: async () => {}, url: async () => routedUrl, getAXState: async () => {},
      playwright: { evaluate: async () => source, locator: selector => { selectors.push(selector); return locator; } } };
    const args = { tab, scope: { groupId: "group-1", locationId: "location-1" }, feedUrl: "https://academy.example.com/communities/groups/turf/home",
      cards: [{ externalId: "post-1", sourceUrl }], authors, resolveCategory: true, sourceObservedChannels: [channelUrl] };
    const result = await captureCommunityThreads(args);
    expect(selectors).toContain('[id="post-card-channel-clickable"]');
    expect(result[0].post).toMatchObject({ categoryComplete: true, categoryExternalId: "Announcements-5xMN0C" });
    routedUrl = "https://academy.example.com/communities/groups/other/channels/Announcements-5xMN0C";
    await expect(captureCommunityThreads(args)).rejects.toThrow("independently observed");
  });

  it("retargets nested detail guards and category navigation to the exact observed modal root", async () => {
    const source = observation(); source.detailRootId = "post-view-modal-"; source.thread.categoryControlText = "#Announcements";
    const channelUrl = "https://academy.example.com/communities/groups/turf/channels/Announcements-5xMN0C", clicked = [];
    const locator = path => ({ last: () => locator(path), first: () => locator(path), locator: child => locator(path + " >> " + child),
      waitFor: async () => {}, getByText: () => locator(path), click: async () => { clicked.push(path); } });
    const tab = { goto: async () => {}, scroll: async () => {}, url: async () => channelUrl, getAXState: async () => {},
      playwright: { evaluate: async () => source, locator } };
    const args = { tab, scope: { groupId: "group-1", locationId: "location-1" }, feedUrl: "https://academy.example.com/communities/groups/turf/home",
      cards: [{ externalId: "post-1", sourceUrl }], authors, resolveCategory: true, sourceObservedChannels: [channelUrl] };
    const [result] = await captureCommunityThreads(args);
    expect(result.post).toMatchObject({ categoryComplete: true, categoryExternalId: "Announcements-5xMN0C" });
    expect(clicked).toEqual(['[id="post-view-modal-"] >> [id="post-view-modal--title"]']);
    source.detailRootId = "unexpected-wrapper";
    await expect(captureCommunityThreads(args)).rejects.toThrow("detail root identity mismatch");
  });

  it("reads and closes the pin menu before thread work, holds unavailable state and rejects a wrong post", async () => {
    for (const mode of ["valid", "missing", "ambiguous", "wrong-post", "foreign-preexisting", "nested-modal"]) {
      let menuOpen = mode === "foreign-preexisting", triggerClicks = 0, currentMenu = false; const events = [];
      const locator = selector => ({ last: () => locator(selector), first: () => locator(selector), locator: child => locator(child),
        waitFor: async ({ state }) => {
          if (selector.includes("hr-dropdown-option-") && state === "visible" && (mode === "missing" || !menuOpen)) throw Error("timed out");
        },
        click: async () => {
          if (selector === '[id="post-view-content-title"]') { events.push("close-menu"); menuOpen = false; }
          else {
            expect(selector).toBe('[id="post-card-actions-trigger"]'); events.push("open-menu"); triggerClicks++;
            if (mode !== "foreign-preexisting" || triggerClicks > 1) { menuOpen = true; currentMenu = true; }
          }
        },
      });
      const tab = { goto: async () => {}, scroll: async () => {}, getAXState: async () => {},
        playwright: { locator, evaluate: async () => {
          events.push(menuOpen ? "read-menu" : "read-thread");
          const source = observation(); source.thread.categoryControlKind = "standalone_button";
          if (mode === "nested-modal") {
            delete source.thread.categoryControlKind; source.detailRootId = "post-view-modal-"; source.ownerPinTriggerObserved = true;
          }
          source.homePinMenuVisible = menuOpen && mode !== "missing";
          if (menuOpen && ["valid", "foreign-preexisting", "nested-modal"].includes(mode)) source.homePinMenu = { postExternalId: "post-1",
            actionId: currentMenu ? "hr-dropdown-option-pinToHome" : "hr-dropdown-option-unpinFromHome", pinned: !currentMenu };
          if (menuOpen && mode === "wrong-post") source.thread.externalId = "post-other";
          return source;
        } } };
      const args = { tab, scope: { groupId: "group-1", locationId: "location-1" }, feedUrl: "https://academy.example.com/communities/groups/turf/home",
        cards: [{ externalId: "post-1", sourceUrl }], authors, resolvePinned: true };
      if (mode === "wrong-post") await expect(captureCommunityThreads(args)).rejects.toThrow("pin menu post identity");
      else {
        const [result] = await captureCommunityThreads(args);
        expect(result.post.pinnedComplete).toBe(["valid", "foreign-preexisting", "nested-modal"].includes(mode));
        if (["valid", "foreign-preexisting", "nested-modal"].includes(mode)) expect(result.evidence.homePinMenuProof).toMatchObject({ postExternalId: "post-1", pinned: false,
          menuAbsentBeforeTrigger: true, currentTriggerOpenedMenu: true });
        else expect(result.evidence.pinnedResolutionIssue).toBe("explicit_home_pin_state_not_observed");
      }
      expect(menuOpen).toBe(false);
      expect(events).toContain("close-menu");
      expect(events.lastIndexOf("close-menu")).toBeGreaterThan(events.indexOf("read-menu"));
      if (mode === "foreign-preexisting") {
        expect(events.indexOf("close-menu")).toBeLessThan(events.indexOf("open-menu"));
        expect(triggerClicks).toBe(2);
      }
    }
  });
});
