import { randomUUID } from "node:crypto";

const sourceId = value => typeof value === "string" && value.length <= 200
  && /^[A-Za-z0-9](?:[A-Za-z0-9._:-]|%[0-9A-Fa-f]{2})*$/.test(value) && value !== "undefined";
const cleanHandle = value => typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Read-only, DOM-backed function. Pass directly to CUA's playwright.evaluate.
 * It deliberately has no external closures, network calls, storage or framework state.
 * Selectors below were observed in the owner's GHL Community on October 3, 2026.
 */
export function extractCommunityDom(options = {}, suppliedDocument) {
  const dom = suppliedDocument ?? document;
  const visible = element => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const all = (root, selector) => [...root.querySelectorAll(selector)];
  const text = element => element?.innerText ?? element?.textContent ?? "";
  const idFrom = (id, expression) => String(id ?? "").match(expression)?.[1] ?? null;
  const countFrom = value => String(value).match(/^\s*(\d+)\s+Comments?\s*$/i)?.[1];
  const directAvatar = root => all(root, '[id^="popover-avatar-trigger-"]')
    .find(element => !element.closest('[id^="comment-"][id$="-content-div"]'));
  const sourceTimestampLabel = root => all(root, '[title]').map(element => element.getAttribute("title"))
    .find(value => /^\w+\s*\/\s*\d{2}\s+\w+\s+\d{4}\s*\//.test(value ?? "")) ?? null;
  const media = (root, ownerComment = null) => {
    const rows = [], unsupported = [], pendingVideoDomIds = [];
    const belongs = element => {
      if (element.closest('[id="comment-editor-layout-root"]')) return false;
      const comment = element.closest('[id^="comment-"][id$="-content-div"]');
      return ownerComment ? comment === ownerComment : !comment;
    };
    const add = (type, url, element) => {
      if (!url) { unsupported.push({ code: "missing_media_url", tag: element.tagName }); return; }
      if (!/^https:\/\//.test(url)) {
        const sourceAssetDomId = element.closest('[id^="video-player-"]')?.id;
        unsupported.push({ code: "non_durable_media_url", tag: element.tagName, ...(sourceAssetDomId ? { sourceAssetDomId } : {}) }); return;
      }
      if (!rows.some(item => item.type === type && item.url === url)) rows.push({ type, url });
    };
    // Content only: avatar, editor controls and background/blur thumbnails are excluded.
    for (const element of all(root, '[id="thumbnail-image-main"], .editor-rendered-content img, [id^="comment-content-"] img')) {
      if (!belongs(element)) continue;
      add("image", element.getAttribute("src") ?? element.getAttribute("data-image-src"), element);
    }
    for (const element of all(root, 'video, audio')) {
      if (!belongs(element)) continue;
      const url = element.getAttribute("src") ?? element.querySelector("source[src]")?.getAttribute("src");
      add(element.tagName === "VIDEO" ? "video" : "source-asset", url, element);
    }
    for (const wrapper of all(root, '[id^="video-player-license-"], [id^="video-player-source-"]')) {
      if (!belongs(wrapper)) continue;
      const video = wrapper.querySelector('video'), url = video?.getAttribute("src") ?? video?.querySelector('source[src]')?.getAttribute("src");
      if (!url) {
        pendingVideoDomIds.push(wrapper.id);
        unsupported.push({ code: "video_content_not_observed", tag: "VIDEO", sourceAssetDomId: wrapper.id });
      }
    }
    for (const element of all(root, 'a[download][href]')) if (belongs(element)) add("file", element.getAttribute("href"), element);
    for (const element of all(root, '.editor-rendered-content a[href], .post-text-content a[href], [id^="comment-content-"] a[href]')) {
      if (belongs(element) && /^https:\/\//.test(element.getAttribute("href") ?? "")) add("source-asset", element.getAttribute("href"), element);
    }
    for (const element of all(root, 'iframe')) if (belongs(element)) unsupported.push({ code: "embedded_media_requires_mapping", tag: element.tagName });
    const collageItems = all(root, '[id^="media-collage-item-"]').filter(belongs);
    const collageContainers = all(root, '[id="media-collage-container"]').filter(belongs);
    const declaredTotals = collageItems.map(element => Number(element.getAttribute("aria-label")?.match(/of\s+(\d+)/)?.[1])).filter(Number.isFinite);
    const collagePending = collageContainers.length > 0 && collageItems.length === 0;
    if (collagePending || declaredTotals.some(total => total !== collageItems.length)) unsupported.push({ code: "incomplete_media_collage" });
    return { media: rows, mediaComplete: unsupported.length === 0, unsupported, pendingVideoDomIds,
      attachmentPending: pendingVideoDomIds.length > 0 || unsupported.some(item => ["missing_media_url", "incomplete_media_collage"].includes(item.code)) };
  };
  const featuredToggle = dom.querySelector('[id="featured-posts-toggle"]');
  const featuredCountLabel = text(featuredToggle).match(/(\d+)\s*$/)?.[1];
  const expectedFeaturedCount = featuredCountLabel === undefined ? null : Number(featuredCountLabel);
  const featuredIds = new Set(all(dom, '[id^="post-card-"][id$="-card"]').filter(element => visible(element)
    && element.closest('.featured-post-card, [id="posts-featured-section"]')).map(element => element.id));
  const featuredCaptureComplete = Number.isInteger(expectedFeaturedCount) && featuredIds.size === expectedFeaturedCount;
  const post = (root, detail) => {
    const externalId = detail
      ? idFrom(root.querySelector('[id^="post-card-"][id$="-comment-button"]')?.id, /^post-card-(.+)-comment-button$/)
      : idFrom(root.id, /^post-card-(.+)-card$/);
    const titleNode = root.querySelector(detail ? '[id="post-view-content-title"]' : "h3");
    const bodyNode = root.querySelector(detail ? '.post-text-content .editor-rendered-content, .post-text-content' : '.editor-rendered-content');
    const countNode = root.querySelector('[id="post-card-web-comments-div"], [id="post-card-mobile-comments-div"]');
    const avatar = directAvatar(root);
    const attachmentRoot = detail ? root.querySelector('[id="post-view-content"]') ?? root : root;
    const attachmentState = media(attachmentRoot);
    const sourceUrl = root.querySelector('a.post-card-link-overlay[href]')?.getAttribute("href") ?? null;
    const featured = root.closest('.featured-post-card, [id="posts-featured-section"]');
    const regular = root.closest('.post-item, [id="posts-regular-feed-section"]');
    const categoryTitle = detail ? root.querySelector('[id="post-view-modal--title"]') : null;
    const categoryControl = categoryTitle ? all(categoryTitle, 'p.cursor-pointer')
      .find(element => /^\s*#[^\n]+$/.test(text(element))) : null;
    const bodyComplete = Boolean(detail && bodyNode && (text(bodyNode).trim() || attachmentState.mediaComplete && attachmentState.media.length));
    return {
      externalId, title: text(titleNode), body: text(bodyNode), bodyComplete,
      authorExternalId: idFrom(avatar?.id, /^popover-avatar-trigger-(.+)$/),
      categoryName: categoryControl ? text(categoryControl).trim() : all(root, "p").map(text).find(value => /^\s*#[^\n]+$/.test(value))?.trim(),
      ...(categoryControl ? { categoryControlText: text(categoryControl).trim() } : {}),
      sourceUrl, displayedCommentCount: countFrom(text(countNode)) === undefined ? null : Number(countFrom(text(countNode))),
      sourceCreatedAtLabel: sourceTimestampLabel(root), ...attachmentState, ...(detail && !bodyComplete ? { mediaComplete: false } : {}),
      ...(!detail ? { pinnedComplete: Boolean(featured || regular && featuredCaptureComplete),
        ...(featured || regular && featuredCaptureComplete ? { pinned: Boolean(featured) } : {}) } : {}),
    };
  };
  const cards = all(dom, '[id^="post-card-"][id$="-card"]').filter(element => visible(element) && /^post-card-[A-Za-z0-9._:-]+-card$/.test(element.id));
  const modals = all(dom, '[id="post-view-modal-"]').filter(visible);
  const modal = modals.at(-1);
  const thread = modal ? post(modal, true) : null;
  const comments = modal ? all(modal, '[id^="comment-"][id$="-content-div"]').map(element => {
    const externalId = idFrom(element.id, /^comment-(.+)-content-div$/);
    const ownBody = element.querySelector(`[id="comment-content-${externalId}"]`);
    const authorNode = element.querySelector(`[id="comment-${externalId}-author-name-clickable"]`);
    const ownAvatar = all(element, '[id^="popover-avatar-trigger-"]')
      .find(avatar => avatar.closest('[id^="comment-"][id$="-content-div"]') === element);
    const ancestor = element.parentElement?.closest('[id^="comment-"][id$="-content-div"]');
    // Nested replies live inside the parent DOM element; do not attribute reply media to the parent.
    const attachmentState = media(element, element);
    const bodyComplete = Boolean(ownBody && (text(ownBody).trim() || attachmentState.mediaComplete && attachmentState.media.length));
    return {
      externalId, postExternalId: thread.externalId,
      parentExternalId: ancestor ? idFrom(ancestor.id, /^comment-(.+)-content-div$/) : null,
      authorExternalId: idFrom(ownAvatar?.id, /^popover-avatar-trigger-(.+)$/),
      authorHandle: /^\s*@\S+\s*$/.test(text(authorNode?.nextElementSibling)) ? text(authorNode.nextElementSibling).trim() : null,
      body: text(ownBody), bodyComplete, ...attachmentState, ...(!bodyComplete ? { mediaComplete: false } : {}),
    };
  }) : [];
  const controls = modal ? all(modal, '[id="comments-view-more-comments-button"], [id="comments-view-more-replies-button"]')
    .filter(visible).map(element => ({ id: element.id, label: text(element).trim(), enabled: !element.hasAttribute("disabled") })) : [];
  const zeroCommentsObserved = Boolean(modal && comments.length === 0 && !controls.some(control => control.enabled)
    && /^\s*No comments yet\s+Be the first to comment!\s*$/.test(text(modal.querySelector('[id="comments-container"]'))));
  if (thread && thread.displayedCommentCount === null && zeroCommentsObserved) thread.displayedCommentCount = 0;
  const groups = all(dom, '[data-analytics]').flatMap(element => {
    try { const groupId = JSON.parse(element.getAttribute("data-analytics")).groupId; return typeof groupId === "string" ? [groupId] : []; } catch { return []; }
  });
  const main = dom.querySelector('[id="communities-layout-main"]');
  const rect = main?.getBoundingClientRect();
  const width = dom.documentElement?.clientWidth, height = dom.documentElement?.clientHeight;
  const visibleRect = rect && width > 0 && height > 0 ? {
    left: Math.max(0, rect.left), top: Math.max(0, rect.top),
    right: Math.min(width, rect.right), bottom: Math.min(height, rect.bottom),
  } : rect;
  const scrollPoint = visibleRect && visibleRect.right > visibleRect.left && visibleRect.bottom > visibleRect.top
    ? [Math.round((visibleRect.left + visibleRect.right) / 2), Math.round(visibleRect.top + (visibleRect.bottom - visibleRect.top) * .7)] : null;
  const announcement = all(dom, '[id="feature-announcement-modal-announcements"]').filter(visible).at(-1);
  return {
    cards: cards.map(element => post(element, false)), thread, comments, controls,
    regularPostCount: cards.filter(element => element.closest('.post-item, [id="posts-regular-feed-section"]')).length,
    observedGroupIds: [...new Set(groups)],
    feedReachedEnd: /You've reached the end of the posts/.test(text(main ?? dom.body)),
    feedScrollPoint: scrollPoint,
    announcementOpen: Boolean(announcement),
    announcementClosable: Boolean(announcement?.querySelector('[id="hr-modal__close-button"]')),
    loading: Boolean(modal?.querySelector('.hr-skeleton, [aria-busy="true"]')),
    zeroCommentsObserved,
    expectedFeaturedCount, observedFeaturedCount: featuredIds.size, featuredCaptureComplete, featuredToggleVisible: visible(featuredToggle),
  };
}

function uniqueRecords(rows, key, issues) {
  const records = new Map();
  for (const row of rows) {
    if (!sourceId(row?.[key])) { issues.push({ code: "missing_source_identity" }); continue; }
    const previous = records.get(row[key]);
    if (previous && !same(previous, row)) issues.push({ code: "contradictory_duplicate", externalId: row[key] });
    else records.set(row[key], row);
  }
  return [...records.values()];
}

/** Normalize the observed detail; only a verified handle map may resolve missing avatars. */
export function normalizeCommunityThread(observation, options = {}) {
  const issues = [], rawPost = observation?.thread;
  if (!rawPost || !sourceId(rawPost.externalId) || rawPost.externalId !== options.expectedPostId) {
    return { complete: false, issues: [{ code: "wrong_or_missing_post" }], post: null, comments: [] };
  }
  const authors = new Map(), authorIds = new Set((options.authors ?? []).map(entry => entry.externalId).filter(sourceId)), heldAuthors = [], heldBodies = [];
  for (const entry of options.authors ?? []) for (const handle of entry.handles ?? []) {
    const key = cleanHandle(handle), ids = authors.get(key) ?? new Set();
    ids.add(entry.externalId); authors.set(key, ids);
  }
  const resolveAuthor = row => {
    const mapped = authors.get(cleanHandle(row.authorHandle));
    if (sourceId(row.authorExternalId)) {
      if (mapped && (mapped.size !== 1 || !mapped.has(row.authorExternalId))) issues.push({ code: "conflicting_author", externalId: row.externalId });
      if (authorIds.has(row.authorExternalId)) return { authorComplete: true, authorExternalId: row.authorExternalId };
    }
    else if (mapped?.size === 1 && sourceId([...mapped][0])) return { authorComplete: true, authorExternalId: [...mapped][0] };
    if (mapped?.size > 1) issues.push({ code: "ambiguous_author_handle", externalId: row.externalId });
    heldAuthors.push({ entity: row === rawPost ? "post" : "comment", externalId: row.externalId, code: "unresolved_author",
      ...(row.authorHandle ? { authorHandle: row.authorHandle } : {}),
      ...(sourceId(row.authorExternalId) ? { sourceAuthorExternalId: row.authorExternalId } : {}) });
    return { authorComplete: false };
  };
  const mediaFields = row => {
    const media = row.media ?? [];
    if (media.some(item => !safeUrl(item.url) || !["image", "video", "file", "source-asset"].includes(item.type))) {
      issues.push({ code: "invalid_media", externalId: row.externalId });
      return { mediaComplete: false };
    }
    return { mediaComplete: row.mediaComplete === true, ...(row.mediaComplete === true ? { media } : {}) };
  };
  const bodyFields = row => {
    if (row.bodyComplete === true) return { body: row.body, bodyComplete: true };
    heldBodies.push({ entity: row === rawPost ? "post" : "comment", externalId: row.externalId, code: "body_content_not_observed" });
    return { bodyComplete: false };
  };
  const comments = uniqueRecords(observation.comments ?? [], "externalId", issues).map(row => ({
    externalId: row.externalId, postExternalId: row.postExternalId, parentExternalId: row.parentExternalId,
    ...resolveAuthor(row),
    ...bodyFields(row), ...mediaFields(row),
  }));
  const commentIds = new Set(comments.map(row => row.externalId));
  const byCommentId = new Map(comments.map(row => [row.externalId, row]));
  for (const row of comments) {
    if (row.postExternalId !== rawPost.externalId || row.parentExternalId !== null && !commentIds.has(row.parentExternalId)) issues.push({ code: "unresolved_thread_parent", externalId: row.externalId });
    const seen = new Set([row.externalId]);
    let parent = byCommentId.get(row.parentExternalId);
    while (parent) {
      if (seen.has(parent.externalId)) { issues.push({ code: "comment_parent_cycle", externalId: row.externalId }); break; }
      seen.add(parent.externalId); parent = byCommentId.get(parent.parentExternalId);
    }
  }
  if (!Number.isInteger(rawPost.displayedCommentCount) || comments.length !== rawPost.displayedCommentCount) issues.push({ code: "comment_count_mismatch" });
  if (observation.controls?.length || observation.loading) issues.push({ code: "thread_pagination_remaining" });
  const post = {
    externalId: rawPost.externalId, title: rawPost.title, ...bodyFields(rawPost),
    ...resolveAuthor(rawPost), commentsComplete: issues.length === 0,
    categoryComplete: sourceId(options.channelExternalId), ...(sourceId(options.channelExternalId) ? { categoryExternalId: options.channelExternalId } : {}),
    pinnedComplete: typeof options.pinned === "boolean", ...(typeof options.pinned === "boolean" ? { pinned: options.pinned } : {}),
    ...mediaFields(rawPost), ...(safeUrl(options.sourceUrl) ? { sourceUrl: options.sourceUrl } : {}),
  };
  post.commentsComplete = issues.length === 0;
  return { complete: issues.length === 0, issues, post, comments, evidence: {
    displayedCommentCount: rawPost.displayedCommentCount, capturedCommentCount: comments.length,
    sourceCreatedAtLabel: rawPost.sourceCreatedAtLabel, timestampTimezoneVerified: false,
    heldAuthors,
    heldBodies,
    authorHandles: (observation.comments ?? []).filter(row => row.authorHandle).map(row => ({ externalId: row.externalId, authorHandle: row.authorHandle })),
    ...(rawPost.categoryName ? { categoryName: rawPost.categoryName } : {}),
    mediaAreDisplayUrlsOnly: true, unsupportedMedia: [rawPost, ...(observation.comments ?? [])].flatMap(row => (row.unsupported ?? []).map(item => ({
      entity: row === rawPost ? "post" : "comment", externalId: row.externalId, ...item,
    }))),
  } };
}

/** Coverage can become complete only after the real feed end AND an independent count/ID check. */
export function assembleCommunityCapture({ scope, captureId, observedStartedAt, observedCompletedAt, feed, threads, expectedPostCount, expectedPostIds }) {
  const issues = [], cards = uniqueRecords(feed.cards ?? [], "externalId", issues);
  const cardIds = new Set(cards.map(row => row.externalId));
  if (!feed.feedReachedEnd) issues.push({ code: "feed_end_not_observed" });
  if (!Number.isInteger(expectedPostCount) || expectedPostCount < 0 || cardIds.size !== expectedPostCount) issues.push({ code: "post_count_mismatch" });
  if (expectedPostIds && (new Set(expectedPostIds).size !== expectedPostIds.length || expectedPostIds.length !== cardIds.size || expectedPostIds.some(id => !cardIds.has(id)))) issues.push({ code: "post_identity_coverage_mismatch" });
  const threadIds = new Set();
  for (const thread of threads) {
    if (!thread.post || threadIds.has(thread.post.externalId) || !cardIds.has(thread.post.externalId)) issues.push({ code: "unexpected_or_duplicate_thread" });
    else threadIds.add(thread.post.externalId);
    if (!thread.complete) issues.push(...thread.issues);
  }
  if (threadIds.size !== cardIds.size) issues.push({ code: "post_details_missing" });
  const postsComplete = !issues.some(item => ["feed_end_not_observed", "post_count_mismatch", "post_identity_coverage_mismatch", "contradictory_duplicate", "missing_source_identity"].includes(item.code));
  const commentsComplete = issues.length === 0;
  return {
    capture: { schemaVersion: 1, source: "ghl-community-browser", captureId, scope: { ...scope }, observedStartedAt, observedCompletedAt,
      coverage: { posts: postsComplete ? "complete" : "partial", comments: commentsComplete ? "complete" : "partial" },
      posts: threads.flatMap(thread => thread.post ? [thread.post] : []), comments: threads.flatMap(thread => thread.comments),
    },
    evidence: { issues, feedReachedEnd: feed.feedReachedEnd, expectedPostCount, observedPostCount: cardIds.size,
      observedPostIds: [...cardIds], completeThreadCount: threads.filter(thread => thread.complete).length,
      threads: threads.map(thread => ({ externalId: thread.post?.externalId, ...thread.evidence })),
    },
  };
}

function browserContext({ tab, scope, sourceGroupId, feedUrl }) {
  if (!tab?.playwright?.evaluate || !tab?.getAXState || !tab?.scroll || !scope?.groupId || !scope?.locationId || !safeUrl(feedUrl)) throw new Error("Invalid authorized browser reader configuration");
  const base = new URL(feedUrl);
  if (!/^\/communities\/groups\/[^/]+\/home\/?$/.test(base.pathname) || base.search || base.hash) throw new Error("Expected the verified Community home URL");
  const slug = base.pathname.match(/^\/communities\/groups\/([^/]+)\/home\/?$/)[1];
  if (sourceGroupId && (!sourceId(sourceGroupId) || slug !== scope.groupId)) throw new Error("Source URL slug does not match snapshot scope");
  const verifiedSourceGroupId = sourceGroupId ?? scope.groupId;
  const read = () => tab.playwright.evaluate(extractCommunityDom, {});
  const observeAction = async action => { await action(); await tab.getAXState({ emit: false }); };
  return { base, verifiedSourceGroupId, read, observeAction };
}

function observedChannelUrls(base, sourceObservedChannels) {
  if (!Array.isArray(sourceObservedChannels)) throw new Error("Expected independently observed source channel URLs");
  const groupPath = base.pathname.replace(/\/home\/?$/, ""), urls = new Set();
  for (const entry of sourceObservedChannels) {
    const value = typeof entry === "string" ? entry : entry?.url;
    if (!safeUrl(value)) throw new Error("Invalid observed source channel URL");
    const url = new URL(value), slug = url.pathname.startsWith(`${groupPath}/channels/`) ? url.pathname.slice(`${groupPath}/channels/`.length) : null;
    if (url.origin !== base.origin || url.search || url.hash || !sourceId(slug)) throw new Error("Observed source channel URL outside the verified group");
    urls.add(url.href);
  }
  return urls;
}

/** The feed and thread APIs can be called in bounded CUA REPL cells. A caller must
 * assemble every batch before certifying whole-group coverage.
 */
export async function captureCommunityFeed({ tab, scope, sourceGroupId, feedUrl, readUrl = feedUrl, sourceObservedChannels = [], expectedInitialPostIds = [], maxFeedScrolls = 100, refreshSource = true, onProgress = () => {} }) {
  const { base, verifiedSourceGroupId, read, observeAction } = browserContext({ tab, scope, sourceGroupId, feedUrl });
  if (!safeUrl(readUrl)) throw new Error("Invalid feed read URL");
  const sourceRead = new URL(readUrl), channels = observedChannelUrls(base, sourceObservedChannels);
  if (sourceRead.origin !== base.origin || sourceRead.search || sourceRead.hash
    || !(sourceRead.pathname.replace(/\/$/, "") === base.pathname.replace(/\/$/, "") || channels.has(sourceRead.href))) throw new Error("Feed read URL outside the verified group or observed channels");
  if (!Array.isArray(expectedInitialPostIds) || expectedInitialPostIds.some(id => !sourceId(id))) throw new Error("Invalid expected initial source post IDs");
  if (await tab.url() !== readUrl) await observeAction(() => tab.goto(readUrl));
  else if (refreshSource) await observeAction(() => tab.reload());
  else await tab.getAXState({ emit: false });
  let feed = await read();
  const missingExpectedInitialPost = expectedInitialPostIds.length && !feed.cards.some(card => expectedInitialPostIds.includes(card.externalId));
  if (missingExpectedInitialPost || !feed.feedReachedEnd && (feed.cards.length === 0 || feed.regularPostCount === 0)) {
    // The source briefly renders "No posts found" before its first response.
    // That marker never certifies empty coverage. Wait for actual source data.
    const main = tab.playwright.locator('[id="communities-layout-main"]');
    const initialSelector = expectedInitialPostIds.length
      ? expectedInitialPostIds.map(id => `[id="post-card-${id}-card"]`).join(", ")
      : '.post-item [id^="post-card-"][id$="-card"], [id="posts-regular-feed-section"] [id^="post-card-"][id$="-card"]';
    const firstPost = main.locator(initialSelector).first();
    const terminal = main.getByText("You've reached the end of the posts", { exact: true });
    await (expectedInitialPostIds.length ? firstPost : firstPost.or(terminal).first()).waitFor({ state: "visible", timeoutMs: 15000 });
    await tab.getAXState({ emit: false });
    feed = await read();
    if (expectedInitialPostIds.length && !feed.cards.some(card => expectedInitialPostIds.includes(card.externalId))) throw new Error("Expected initial source post not observed");
  }
  const feedCards = new Map();
  let featuredExpansionAttempted = false;
  for (let scroll = 0; scroll <= maxFeedScrolls; scroll++) {
    for (const card of feed.cards) {
      const prior = feedCards.get(card.externalId);
      feedCards.set(card.externalId, prior?.pinned === true ? { ...card, pinned: true, pinnedComplete: true } : card);
    }
    if (feed.announcementOpen) {
      if (!feed.announcementClosable) throw new Error("Source announcement blocks complete feed capture");
      await observeAction(() => tab.playwright.locator('[id="feature-announcement-modal-announcements"] [id="hr-modal__close-button"]').click());
      feed = await read(); continue;
    }
    if (!featuredExpansionAttempted && feed.featuredToggleVisible && feed.expectedFeaturedCount > feed.observedFeaturedCount) {
      featuredExpansionAttempted = true;
      await observeAction(() => tab.playwright.locator('[id="featured-posts-toggle"]').click());
      feed = await read(); continue;
    }
    if (feed.feedReachedEnd || scroll === maxFeedScrolls) break;
    if (!feed.feedScrollPoint) throw new Error("Source feed scroll surface unavailable");
    await observeAction(() => tab.scroll(feed.feedScrollPoint, "down", 4));
    feed = await read();
    await onProgress({ phase: "feed", scroll, observedPostCount: feedCards.size });
  }
  feed.cards = [...feedCards.values()];
  if (feed.observedGroupIds.some(groupId => groupId !== verifiedSourceGroupId)) throw new Error("Source group scope mismatch");
  return feed;
}

export async function captureCommunityThreads({ tab, scope, sourceGroupId, feedUrl, cards, authors = [], channelByPost = {}, pinnedByPost = {}, resolveCategory = false, sourceObservedChannels = [], expectedMediaByRecord = {}, maxThreadActions = 100, onProgress = () => {} }) {
  const { base, verifiedSourceGroupId, read, observeAction } = browserContext({ tab, scope, sourceGroupId, feedUrl });
  const channels = observedChannelUrls(base, sourceObservedChannels);
  if (resolveCategory && channels.size === 0) throw new Error("Category resolution requires independently observed source channel URLs");
  if (!expectedMediaByRecord || typeof expectedMediaByRecord !== "object" || Array.isArray(expectedMediaByRecord)) throw new Error("Invalid independently observed media mapping");
  const knownMedia = new Map();
  for (const [key, values] of Object.entries(expectedMediaByRecord)) {
    const identity = key.match(/^(post|comment):(.+)$/);
    if (!identity || !sourceId(identity[2]) || !Array.isArray(values)) throw new Error("Invalid independently observed media record identity");
    const domIds = values.map(value => typeof value === "string" ? value : value?.sourceAssetDomId);
    if (domIds.some(id => typeof id !== "string" || id.length > 4096 || /[\u0000-\u001f]/.test(id) || !/^video-player-(?:license|source)-.+$/.test(id))) throw new Error("Invalid independently observed media DOM identity");
    knownMedia.set(key, domIds);
  }
  if (!Array.isArray(cards) || cards.length > 100 || cards.some(card => !sourceId(card.externalId))) throw new Error("Invalid bounded source thread batch");
  const threads = [];
  for (const card of cards) {
    const link = card.sourceUrl ? new URL(card.sourceUrl, base).href : null;
    if (!link || new URL(link).origin !== base.origin || new URL(link).pathname !== `${base.pathname.replace(/\/$/, "")}/posts/${card.externalId}`) {
      throw new Error("Source post permalink missing or outside the verified group");
    }
    await observeAction(() => tab.goto(link));
    // Navigation can expose an initial Loading AX state. Wait for the observed
    // detail surface before reading it, rather than accepting an empty thread.
    const detail = tab.playwright.locator('[id="post-view-modal-"]').last();
    await detail.waitFor({ state: "visible", timeoutMs: 15000 });
    await detail.locator('[id="post-view-content-title"]').waitFor({ state: "attached", timeoutMs: 15000 });
    await detail.locator(`[id="post-card-${card.externalId}-comment-button"]`).waitFor({ state: "attached", timeoutMs: 15000 });
    await detail.locator('[id="comments-container"]').waitFor({ state: "attached", timeoutMs: 15000 });
    await tab.getAXState({ emit: false });
    let observation = await read();
    if ((observation.thread?.displayedCommentCount ?? card.displayedCommentCount) > 0 && observation.comments.length === 0) {
      await detail.locator('[id^="comment-"][id$="-content-div"]').first().waitFor({ state: "attached", timeoutMs: 15000 });
      await tab.getAXState({ emit: false });
      observation = await read();
    } else if (observation.thread?.displayedCommentCount === null && observation.comments.length === 0 && !observation.zeroCommentsObserved) {
      const firstComment = detail.locator('[id^="comment-"][id$="-content-div"]').first();
      const explicitEmpty = detail.locator('[id="comments-container"]').getByText("No comments yet", { exact: true });
      await firstComment.or(explicitEmpty).waitFor({ state: "attached", timeoutMs: 15000 });
      await tab.getAXState({ emit: false });
      observation = await read();
    }
    for (let action = 0; action < maxThreadActions; action++) {
      let control = observation.controls.find(item => item.enabled);
      const expectedCommentCount = observation.thread?.displayedCommentCount;
      if (!control && Number.isInteger(expectedCommentCount) && observation.comments.length < expectedCommentCount) {
        // Root comments can arrive before their nested reply controls. Wait on
        // the next meaningful DOM condition, never a fixed sleep or empty read.
        const pagination = detail.locator('[id="comments-view-more-comments-button"], [id="comments-view-more-replies-button"]');
        const expectedLastComment = detail.locator('[id^="comment-"][id$="-content-div"]').nth(expectedCommentCount - 1);
        await pagination.or(expectedLastComment).first().waitFor({ state: "attached", timeoutMs: 10000 });
        await tab.getAXState({ emit: false });
        observation = await read();
        control = observation.controls.find(item => item.enabled);
      }
      if (!control) break;
      const previouslyLoaded = observation.comments.map(comment => comment.externalId).filter(sourceId);
      // These exact IDs were observed on read-only comment/reply pagination controls.
      await observeAction(() => tab.playwright.locator('[id="post-view-modal-"]').last().locator(`[id="${control.id}"]`).first().click());
      const unseenCommentSelector = '[id^="comment-"][id$="-content-div"]'
        + previouslyLoaded.map(id => `:not([id="comment-${id}-content-div"])`).join("");
      await detail.locator(unseenCommentSelector).first().waitFor({ state: "attached", timeoutMs: 15000 });
      await tab.getAXState({ emit: false });
      observation = await read();
    }
    let fieldSettlingIssue;
    for (let settling = 0; settling < maxThreadActions; settling++) {
      const pending = [observation.thread, ...observation.comments].filter(Boolean)
        .find(row => row.bodyComplete !== true || row.attachmentPending);
      if (!pending) break;
      const isPost = pending === observation.thread;
      const ownerId = `comment-${pending.externalId}-content-div`;
      const owner = isPost ? detail.locator('[id="post-view-content"]') : detail.locator(`[id="${ownerId}"]`);
      const body = owner.locator(isPost ? '.post-text-content' : `[id="comment-content-${pending.externalId}"]`).filter({ hasText: /\S/ });
      // Exclude nested reply attachments when settling a parent's own body.
      const excludeNested = isPost ? ':not([id^="comment-"][id$="-content-div"] *)'
        : `:not([id^="comment-"][id$="-content-div"]:not([id="${ownerId}"]) *)`;
      const readyMediaSelector = ['video[src]:not([src=""])', 'video source[src]:not([src=""])', 'audio[src]:not([src=""])', 'audio source[src]:not([src=""])',
        '[id="thumbnail-image-main"][src]:not([src=""])', '.editor-rendered-content img[src]:not([src=""])', 'a[download][href]:not([href=""])']
        .map(selector => `${selector}${excludeNested}`).join(', ');
      let mediaReady = owner.locator(readyMediaSelector).first();
      if (pending.pendingVideoDomIds?.length) {
        const id = pending.pendingVideoDomIds[0].replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        mediaReady = owner.locator(`[id="${id}"]`).locator('video[src]:not([src=""]), video source[src]:not([src=""])').first();
      }
      const previous = JSON.stringify([observation.thread, ...observation.comments].map(row => [row?.externalId, row?.body, row?.bodyComplete, row?.mediaComplete, row?.unsupported]));
      try {
        await (pending.bodyComplete === true ? mediaReady : body.or(mediaReady).first()).waitFor({ state: "attached", timeoutMs: 10000 });
      } catch (error) {
        if (!/timeout|timed out/i.test(String(error?.message ?? error))) throw error;
        fieldSettlingIssue = "source_body_or_attachment_timeout";
        break;
      }
      await tab.getAXState({ emit: false });
      observation = await read();
      if (previous === JSON.stringify([observation.thread, ...observation.comments].map(row => [row?.externalId, row?.body, row?.bodyComplete, row?.mediaComplete, row?.unsupported]))) {
        fieldSettlingIssue = "source_body_or_attachment_did_not_change";
        break;
      }
    }
    // Comment text sanitization can finish before an asynchronous media/license
    // request even creates its DOM wrapper. A body-only read is not proof of
    // empty attachments. The supported CUA networkidle wait settles that phase.
    let mediaLoadState = "unavailable";
    if (typeof tab.playwright.waitForLoadState === "function") {
      try {
        await tab.playwright.waitForLoadState({ state: "networkidle", timeoutMs: 10000 });
        mediaLoadState = "networkidle";
      } catch (error) {
        if (!/timeout|timed out/i.test(String(error?.message ?? error))) throw error;
        mediaLoadState = "timeout";
      }
      await tab.getAXState({ emit: false });
      observation = await read();
    }
    const missingKnownMedia = new Map();
    for (const row of [observation.thread, ...observation.comments].filter(Boolean)) {
      const entity = row === observation.thread ? "post" : "comment", key = `${entity}:${row.externalId}`;
      for (const domId of knownMedia.get(key) ?? []) {
        const escapedId = domId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const owner = entity === "post" ? detail.locator('[id="post-view-content"]') : detail.locator(`[id="comment-${row.externalId}-content-div"]`);
        const excludeNested = entity === "post" ? ':not([id^="comment-"][id$="-content-div"] *)'
          : `:not([id^="comment-"][id$="-content-div"]:not([id="comment-${row.externalId}-content-div"]) *)`;
        try {
          await owner.locator(`[id="${escapedId}"]${excludeNested}`).waitFor({ state: "attached", timeoutMs: 10000 });
        } catch (error) {
          if (!/timeout|timed out/i.test(String(error?.message ?? error))) throw error;
          const missing = missingKnownMedia.get(key) ?? [];
          missing.push(domId); missingKnownMedia.set(key, missing);
        }
        await tab.getAXState({ emit: false });
        observation = await read();
      }
    }
    const guardMedia = (row, entity) => {
      if (!row) return row;
      const missing = missingKnownMedia.get(`${entity}:${row.externalId}`) ?? [];
      if (mediaLoadState === "networkidle" && missing.length === 0) return row;
      return { ...row, mediaComplete: false, unsupported: [...(row.unsupported ?? []), ...missing.map(sourceAssetDomId => ({
        code: "previously_observed_media_not_available", tag: "VIDEO", sourceAssetDomId,
      }))] };
    };
    observation = { ...observation, thread: guardMedia(observation.thread, "post"), comments: observation.comments.map(row => guardMedia(row, "comment")) };
    if (observation.observedGroupIds.some(groupId => groupId !== verifiedSourceGroupId)) throw new Error("Source thread scope mismatch");
    const normalizeOptions = { expectedPostId: card.externalId, sourceUrl: link, authors,
      channelExternalId: resolveCategory ? undefined : channelByPost[card.externalId], pinned: pinnedByPost[card.externalId] ?? (card.pinnedComplete ? card.pinned : undefined) };
    let normalized = normalizeCommunityThread(observation, normalizeOptions);
    if (resolveCategory && normalized.complete && observation.thread?.categoryControlText) {
      const label = observation.thread.categoryControlText;
      // Literal text locates the observed control. Only the resulting URL
      // establishes identity; duplicate channel names never choose a mapping.
      await observeAction(() => detail.locator('[id="post-view-modal--title"]').getByText(label, { exact: true }).click());
      const categoryUrl = new URL(await tab.url());
      if (!channels.has(categoryUrl.href)) throw new Error("Category route did not match an independently observed source channel URL");
      const categoryExternalId = categoryUrl.pathname.slice(`${base.pathname.replace(/\/home\/?$/, "")}/channels/`.length);
      normalized = normalizeCommunityThread(observation, { ...normalizeOptions, channelExternalId: categoryExternalId });
      normalized.evidence.categorySourceUrl = categoryUrl.href;
      normalized.evidence.categoryIdentityFromObservedRoute = true;
    } else if (resolveCategory) normalized.evidence.categoryResolutionIssue = "observed_category_control_unavailable_or_thread_incomplete";
    if (fieldSettlingIssue) normalized.evidence.fieldSettlingIssue = fieldSettlingIssue;
    normalized.evidence.mediaLoadState = mediaLoadState;
    threads.push(normalized);
    await onProgress({ phase: "threads", processed: threads.length, total: cards.length, complete: threads.at(-1).complete });
  }
  return threads;
}

/** Reusable local reader; it never creates a browser, reads cookies or writes app data.
 * Caller passes a dedicated, already authorized CUA source tab and an independently
 * verified CURRENT group count/ID set. Never freeze that count to an old capture.
 */
export async function captureCommunityBrowser({ now = () => new Date().toISOString(), captureId = randomUUID(), ...options }) {
  const observedStartedAt = now();
  const feed = await captureCommunityFeed(options);
  const threads = [];
  for (let offset = 0; offset < feed.cards.length; offset += 100) {
    threads.push(...await captureCommunityThreads({ ...options, cards: feed.cards.slice(offset, offset + 100) }));
  }
  return assembleCommunityCapture({ scope: options.scope, captureId, observedStartedAt, observedCompletedAt: now(), feed, threads,
    expectedPostCount: options.expectedPostCount, expectedPostIds: options.expectedPostIds });
}
