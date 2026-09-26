import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, AtSign, Bookmark, CalendarDays, Check, ChevronRight, ExternalLink, Flag, Hash, Heart, Link2, LockKeyhole, MapPin, Megaphone, MessageSquare, MoreHorizontal, Pin, Plus, Search, Send, Share2, ThumbsUp, Trophy, UserX, Users, X } from "lucide-react";
import type { AcademyEvent, CommunityComment, CommunityMedia, CommunityPost, Member } from "../domain";
import { communityChannels, communityLeaders, communityStats, featuredCommunityPost, postsFromFollowedMembers } from "../lib/communityOverview";
import { communityBodyBlocks, communityBodyNeedsExpansion, communityPostShareUrl } from "../lib/communityPost";
import { nextBlockedMemberIds, validReportReason, withoutMemberContent } from "../lib/communitySafety";
import { getNextUpcomingEvent } from "../lib/eventTiming";

type Props = {
  posts: CommunityPost[];
  comments: CommunityComment[];
  members: Member[];
  events: AcademyEvent[];
  requestedPostCloudId?: string;
  onRequestedPostOpened: () => void;
  onPostsChange: (posts: CommunityPost[]) => void;
  onCommentsChange: (comments: CommunityComment[]) => void;
  onMembersChange: (members: Member[]) => void;
  onToggleFollow: (member: Member, following: boolean) => Promise<boolean>;
  onLoadMorePosts: () => Promise<void>;
  hasMorePosts: boolean;
  loadingMorePosts: boolean;
  onCreatePost: (post: CommunityPost) => Promise<CommunityPost>;
  onCreateComment: (comment: CommunityComment, postCloudId?: string) => Promise<CommunityComment>;
  onToggleLike: (post: CommunityPost) => Promise<boolean | null>;
  onToggleCommentLike: (comment: CommunityComment) => Promise<boolean | null>;
  onToggleBookmark: (post: CommunityPost) => Promise<boolean | null>;
  onReport: (contentType: "post" | "comment" | "member", contentId: string, reason: string) => Promise<void>;
  onBlockMember: (memberId: string) => Promise<boolean>;
  onLoadBlockedMembers: () => Promise<string[]>;
  onRefreshCommunity: () => void;
  onNavigate: (view: "events") => void;
  onToast: (message: string) => void;
};

export function CommunityView({ posts, comments, members, events, requestedPostCloudId, onRequestedPostOpened, onPostsChange, onCommentsChange, onMembersChange, onToggleFollow, onLoadMorePosts, hasMorePosts, loadingMorePosts, onCreatePost, onCreateComment, onToggleLike, onToggleCommentLike, onToggleBookmark, onReport, onBlockMember, onLoadBlockedMembers, onRefreshCommunity, onNavigate, onToast }: Props) {
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<"Recent" | "Popular" | "Following" | "Saved">("Recent");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [commentText, setCommentText] = useState("");
  const [replyingTo, setReplyingTo] = useState<CommunityComment | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [communitySection, setCommunitySection] = useState<"discussion" | "leaderboard" | "about">("discussion");
  const [memberQuery, setMemberQuery] = useState("");
  const [activeQuickReplyPostId, setActiveQuickReplyPostId] = useState<number | null>(null);
  const [quickReplyDrafts, setQuickReplyDrafts] = useState<Record<number, string>>({});
  const [expandedPostIds, setExpandedPostIds] = useState<Set<number>>(() => new Set());
  const [openPostMenuId, setOpenPostMenuId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingFollowId, setPendingFollowId] = useState<number | null>(null);
  const [blockedMemberIds, setBlockedMemberIds] = useState<string[]>([]);
  const [blockedMembersLoading, setBlockedMembersLoading] = useState(false);
  const [blockedMembersError, setBlockedMembersError] = useState(false);
  const [pendingBlockMemberId, setPendingBlockMemberId] = useState<string | null>(null);
  const selected = posts.find((post) => post.id === selectedPostId);
  const selectThread = (postId: number | null) => {
    setSelectedPostId(postId);
    setReplyingTo(null);
    setCommentText("");
  };

  const reportContent = async (contentType: "post" | "comment" | "member", contentId: string, label: string) => {
    const reason = window.prompt(`Why are you reporting this ${label}?`, "Spam or inappropriate content");
    if (!reason?.trim()) return;
    if (!validReportReason(reason)) {
      onToast("Please enter a reason between 3 and 500 characters.");
      return;
    }
    try {
      await onReport(contentType, contentId, reason.trim());
      onToast("Report sent to the Academy administrators.");
    } catch {
      onToast("The report could not be sent.");
    }
  };

  const toggleMemberBlock = async (memberId: string, name: string) => {
    if (pendingBlockMemberId) return;
    const isBlocked = blockedMemberIds.includes(memberId);
    if (!isBlocked && !window.confirm(`Block ${name}? Their posts and comments will be hidden from you.`)) return;
    setPendingBlockMemberId(memberId);
    try {
      const blocked = await onBlockMember(memberId);
      setBlockedMemberIds((current) => nextBlockedMemberIds(current, memberId, blocked));
      if (blocked) {
        onPostsChange(withoutMemberContent(posts, memberId));
        onCommentsChange(withoutMemberContent(comments, memberId));
        selectThread(null);
        onToast(`${name} is blocked.`);
      } else {
        onRefreshCommunity();
        onToast(`${name} is unblocked.`);
      }
    } catch {
      onToast("Could not update this member's block status.");
    } finally {
      setPendingBlockMemberId(null);
    }
  };

  useEffect(() => {
    if (!membersOpen) return;
    let active = true;
    setBlockedMembersLoading(true);
    setBlockedMembersError(false);
    void onLoadBlockedMembers().then((ids) => {
      if (active) setBlockedMemberIds(ids);
    }).catch(() => {
      if (active) setBlockedMembersError(true);
    }).finally(() => {
      if (active) setBlockedMembersLoading(false);
    });
    return () => { active = false; };
  }, [membersOpen, onLoadBlockedMembers]);

  useEffect(() => {
    if (!requestedPostCloudId) return;
    const requested = posts.find((post) => post.cloudId === requestedPostCloudId);
    if (!requested) return;
    selectThread(requested.id);
    onRequestedPostOpened();
  }, [onRequestedPostOpened, posts, requestedPostCloudId]);
  const channels = useMemo(() => communityChannels(posts), [posts]);
  const categories = useMemo(() => ["All", ...channels.map((channel) => channel.name)], [channels]);
  const featuredPost = useMemo(() => featuredCommunityPost(posts), [posts]);
  const leaders = useMemo(() => communityLeaders(members), [members]);
  const stats = useMemo(() => communityStats(posts, members), [members, posts]);
  const upcomingEvent = getNextUpcomingEvent(events);
  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase();
    if (!query) return members;
    return members.filter((member) => [member.name, member.company, member.location, member.role].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [memberQuery, members]);

  const visible = useMemo(() => {
    let next = category === "All" ? [...posts] : posts.filter((post) => post.category === category);
    if (sort === "Popular") next.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
    if (sort === "Following") next = postsFromFollowedMembers(next, members);
    if (sort === "Saved") next = next.filter((post) => post.saved);
    return next.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [category, members, posts, sort]);

  const toggleFollow = async (member: Member) => {
    if (member.isSelf || pendingFollowId !== null) return;
    setPendingFollowId(member.id);
    try {
      const following = await onToggleFollow(member, !member.following);
      onMembersChange(members.map((item) => item.id === member.id ? { ...item, following } : item));
      onToast(following ? `Following ${member.name}.` : `Unfollowed ${member.name}.`);
    } catch {
      onToast(`Could not update your follow for ${member.name}.`);
    } finally {
      setPendingFollowId(null);
    }
  };

  const updatePost = (id: number, changes: Partial<CommunityPost>) => onPostsChange(posts.map((post) => post.id === id ? { ...post, ...changes } : post));
  const syncPostUrl = (cloudId?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "community");
    if (cloudId) url.searchParams.set("post", cloudId);
    else url.searchParams.delete("post");
    window.history.replaceState(window.history.state, "", url);
  };
  const openThread = (id: number) => {
    const post = posts.find((candidate) => candidate.id === id);
    selectThread(id);
    setOpenPostMenuId(null);
    syncPostUrl(post?.cloudId);
    document.querySelector(".phone-frame")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  };
  const openMembers = () => {
    setMembersOpen(true);
    window.requestAnimationFrame(() => {
      document.querySelector(".phone-frame")?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    });
  };
  const closeThread = () => {
    selectThread(null);
    setOpenPostMenuId(null);
    syncPostUrl();
  };

  const publish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    const post: CommunityPost = { id: Date.now(), name: title.trim(), author: "You", body: body.trim(), replies: 0, likes: 0, age: "Just now", category: newCategory, mentionedMemberIds: mentionedMemberIds(body, members) };
    setSaving(true);
    try {
      const saved = await onCreatePost(post);
      onPostsChange([saved, ...posts]);
      setTitle(""); setBody(""); setComposerOpen(false);
      onToast("Post published.");
    } catch {
      onToast("Post could not be published.");
    } finally {
      setSaving(false);
    }
  };

  const addComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !commentText.trim()) return;
    const comment: CommunityComment = {
      id: Date.now(),
      postId: selected.id,
      parentId: replyingTo?.postId === selected.id ? replyingTo.id : undefined,
      parentCloudId: replyingTo?.postId === selected.id ? replyingTo.cloudId : undefined,
      author: "You",
      body: commentText.trim(),
      age: "Just now",
      likes: 0,
      mentionedMemberIds: mentionedMemberIds(commentText, members),
    };
    setSaving(true);
    try {
      const saved = await onCreateComment(comment, selected.cloudId);
      onCommentsChange([...comments, saved]);
      updatePost(selected.id, { replies: selected.replies + 1 });
      setCommentText("");
      setReplyingTo(null);
      onToast("Reply posted.");
    } catch {
      onToast("Reply could not be posted.");
    } finally {
      setSaving(false);
    }
  };

  const addQuickComment = async (event: React.FormEvent, post: CommunityPost) => {
    event.preventDefault();
    const quickReplyText = quickReplyDrafts[post.id] ?? "";
    if (!quickReplyText.trim()) return;
    const comment: CommunityComment = {
      id: Date.now(),
      postId: post.id,
      author: "You",
      body: quickReplyText.trim(),
      age: "Just now",
      likes: 0,
      mentionedMemberIds: mentionedMemberIds(quickReplyText, members),
    };
    setSaving(true);
    try {
      const saved = await onCreateComment(comment, post.cloudId);
      onCommentsChange([...comments, saved]);
      updatePost(post.id, { replies: post.replies + 1 });
      setQuickReplyDrafts((current) => ({ ...current, [post.id]: "" }));
      onToast("Comment posted.");
    } catch {
      onToast("Comment could not be posted.");
    } finally {
      setSaving(false);
    }
  };

  const openCommunitySection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    setCommunitySection("discussion");
    openCommunitySection("community-discussion");
  };

  const focusQuickReply = (postId: number) => {
    setActiveQuickReplyPostId(postId);
    window.requestAnimationFrame(() => document.getElementById(`quick-reply-${postId}`)?.focus());
  };

  const togglePostExpansion = (postId: number) => {
    setExpandedPostIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const toggleLike = async (post: CommunityPost) => {
    const nextLiked = !post.liked;
    updatePost(post.id, { liked: nextLiked, likes: Math.max(0, (post.likes ?? 0) + (nextLiked ? 1 : -1)) });
    try {
      const cloudValue = await onToggleLike(post);
      if (cloudValue !== null && cloudValue !== nextLiked) updatePost(post.id, { liked: cloudValue });
    } catch {
      updatePost(post.id, { liked: post.liked, likes: post.likes });
      onToast("Reaction could not be saved.");
    }
  };

  const toggleBookmark = async (post: CommunityPost) => {
    const nextSaved = !post.saved;
    updatePost(post.id, { saved: nextSaved });
    try {
      const cloudValue = await onToggleBookmark(post);
      if (cloudValue !== null && cloudValue !== nextSaved) updatePost(post.id, { saved: cloudValue });
    } catch {
      updatePost(post.id, { saved: post.saved });
      onToast("Bookmark could not be saved.");
    }
  };

  const toggleCommentLike = async (comment: CommunityComment) => {
    const nextLiked = !comment.liked;
    onCommentsChange(comments.map((item) => item.id === comment.id ? { ...item, liked: nextLiked, likes: Math.max(0, item.likes + (nextLiked ? 1 : -1)) } : item));
    try {
      const cloudValue = await onToggleCommentLike(comment);
      if (cloudValue !== null && cloudValue !== nextLiked) {
        onCommentsChange(comments.map((item) => item.id === comment.id ? { ...item, liked: cloudValue } : item));
      }
    } catch {
      onCommentsChange(comments);
      onToast("Reaction could not be saved.");
    }
  };

  const sharePost = async (post: CommunityPost) => {
    const url = communityPostShareUrl(window.location.href, post.cloudId);
    const shareData = { title: post.name, text: post.body, url };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(`${post.name}\n\n${post.body}\n\n${url}`);
        onToast("Post copied to the clipboard.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onToast("Post could not be shared.");
    }
  };

  const copyPostLink = async (post: CommunityPost) => {
    try {
      await navigator.clipboard.writeText(communityPostShareUrl(window.location.href, post.cloudId));
      setOpenPostMenuId(null);
      onToast("Post link copied.");
    } catch {
      onToast("Post link could not be copied.");
    }
  };

  if (membersOpen) {
    return <div className="view-content member-directory-view">
      <div className="subview-bar"><button className="back-link" onClick={() => setMembersOpen(false)}><ArrowLeft size={17} /> Community</button><span>{members.length} members</span></div>
      <section className="member-directory-heading"><p className="kicker">Operator network</p><h2>Academy members</h2></section>
      <label className="member-directory-search"><Search size={17} /><span className="sr-only">Search members</span><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search name, company, or location" /></label>
      {blockedMembersError && <div className="community-safety-error" role="alert">Blocked members could not be loaded. Close and reopen the directory to retry.</div>}
      <section className="member-directory">{filteredMembers.map((member) => <article className="member-row" key={member.id}>
        {member.avatarUrl ? <img className="avatar small" src={member.avatarUrl} alt="" /> : <span className="avatar small">{member.initials}</span>}
        <span><strong>{member.name}</strong><small>{member.company || member.role}</small><em><MapPin size={12} /> {member.location || "Location not listed"}</em></span>
        <span className="member-directory-actions"><span className="member-level">Lv {member.level}</span>{!member.isSelf && <button className={`follow-button${member.following ? " active" : ""}`} type="button" aria-label={`${member.following ? "Unfollow" : "Follow"} ${member.name}`} aria-pressed={member.following} disabled={pendingFollowId !== null} onClick={() => void toggleFollow(member)}>{member.following ? <Check size={16} /> : <Plus size={16} />}</button>}{!member.isSelf && member.cloudId && <><button className="member-safety-action" type="button" onClick={() => void reportContent("member", member.cloudId!, "member")}>Report</button><button className="member-safety-action" type="button" disabled={blockedMembersLoading || blockedMembersError || pendingBlockMemberId !== null} onClick={() => void toggleMemberBlock(member.cloudId!, member.name)}>{blockedMemberIds.includes(member.cloudId) ? "Unblock" : "Block"}</button></>}</span>
      </article>)}</section>
      {filteredMembers.length === 0 && <div className="empty-state"><Users size={24} /><h3>{members.length ? "No members match that search" : "No members imported yet"}</h3><p>{members.length ? "Try a different name, company, or location." : "The directory will populate from the verified HighLevel member export."}</p></div>}
    </div>;
  }

  if (selected) {
    const thread = orderThread(comments.filter((comment) => comment.postId === selected.id));
    const commentMentionMatches = mentionMatches(commentText, members);
    return <div className="view-content thread-view">
      <div className="subview-bar"><button className="back-link" onClick={closeThread}><ArrowLeft size={17} /> Back to discussions</button><PostMenu post={selected} open={openPostMenuId === selected.id} onOpen={() => setOpenPostMenuId(openPostMenuId === selected.id ? null : selected.id)} onBookmark={() => void toggleBookmark(selected)} onCopyLink={() => void copyPostLink(selected)} onReport={() => selected.cloudId && void reportContent("post", selected.cloudId, "post")} onBlock={() => selected.authorCloudId && void toggleMemberBlock(selected.authorCloudId, selected.author)} /></div>
      <article className="thread-post">
        <PostIdentity post={selected} members={members} onCategory={() => { closeThread(); selectCategory(selected.category ?? "General"); }} />
        <h2>{selected.name}</h2><PostBody body={selected.body} />
        <CommunityMediaGallery items={selected.mediaItems ?? []} />
        <EngagementSummary likes={selected.likes ?? 0} comments={thread.length} />
        <div className="post-actions"><button className={selected.liked ? "active" : ""} onClick={() => void toggleLike(selected)}><ThumbsUp size={17} fill={selected.liked ? "currentColor" : "none"} /> Like</button><button onClick={() => { const input = document.getElementById("thread-reply"); input?.focus(); input?.scrollIntoView({ behavior: "smooth", block: "center" }); }}><MessageSquare size={17} /> Comment</button><button onClick={() => void sharePost(selected)}><Share2 size={17} /> Share</button></div>
      </article>
      <section className="thread-comments">
        <div className="thread-count">{thread.length} {thread.length === 1 ? "comment" : "comments"}</div>
        {thread.map((comment) => <article className={`${comment.answer ? "comment answer" : "comment"}${comment.parentId ? " nested" : ""}`} key={comment.id}><Avatar name={comment.author} members={members} /><div><div className="comment-head"><strong>{comment.author}</strong><span>{comment.age}</span>{comment.answer && <em><Check size={11} /> Answer</em>}</div><p>{comment.body}</p><div className="comment-actions"><button className={comment.liked ? "active" : ""} onClick={() => void toggleCommentLike(comment)}><Heart size={14} fill={comment.liked ? "currentColor" : "none"} /> {comment.likes}</button><button onClick={() => { setReplyingTo(comment); setCommentText(`@${comment.author} `); }}><MessageSquare size={14} /> Reply</button>{comment.cloudId && <button onClick={() => void reportContent("comment", comment.cloudId!, "comment")}><Flag size={14} /> Report</button>}{comment.authorCloudId && <button onClick={() => void toggleMemberBlock(comment.authorCloudId!, comment.author)}><UserX size={14} /> Block</button>}</div></div></article>)}
        {thread.length === 0 && <div className="thread-empty"><MessageSquare size={19} /><span><strong>Start the conversation</strong><small>Share an answer or ask a follow-up question.</small></span></div>}
      </section>
      {replyingTo && <div className="replying-to"><span>Replying to <strong>{replyingTo.author}</strong></span><button onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
      <form className="reply-composer" onSubmit={addComment}><Avatar name="You" members={members} /><div className="reply-input-wrap"><input id="thread-reply" value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder={replyingTo ? `Reply to ${replyingTo.author}...` : "Write a comment..."} aria-label="Write a comment" />{commentMentionMatches.length > 0 && <MentionSuggestions members={commentMentionMatches} onSelect={(member) => setCommentText(insertMention(commentText, member.name))} />}</div><button disabled={saving || !commentText.trim()} aria-label="Post comment"><Send size={17} /></button></form>
    </div>;
  }

  return (
    <div className="view-content community-view">
      <nav className="community-section-tabs" aria-label="Community sections">
        <button className={communitySection === "discussion" ? "active" : ""} aria-current={communitySection === "discussion" ? "page" : undefined} onClick={() => { setCommunitySection("discussion"); setCategory("All"); openCommunitySection("community-discussion"); }}>Discussion</button>
        <button className={communitySection === "leaderboard" ? "active" : ""} aria-current={communitySection === "leaderboard" ? "page" : undefined} onClick={() => { setCommunitySection("leaderboard"); openCommunitySection("community-leaderboard"); }}><Trophy size={15} /> Leaderboard</button>
        <button onClick={openMembers}><Users size={15} /> Members</button>
        <button className={communitySection === "about" ? "active" : ""} aria-current={communitySection === "about" ? "page" : undefined} onClick={() => { setCommunitySection("about"); openCommunitySection("community-about"); }}><LockKeyhole size={15} /> About</button>
      </nav>
      <div className="community-product-layout">
        <aside className="community-channel-rail" aria-label="Discussion channels">
          <div className="community-rail-heading"><img src="/dirty-turf-logo.png" alt="" /><span><strong>7 Figure Turf Cleaning</strong><small>Academy community</small></span></div>
          <button className={category === "All" ? "active" : ""} onClick={() => selectCategory("All")}><MessageSquare size={16} /><span>All posts</span><em>{posts.length}</em></button>
          <p>Channels</p>
          {channels.map((channel) => <button className={category === channel.name ? "active" : ""} onClick={() => selectCategory(channel.name)} key={channel.name}>{channel.name === "Announcements" ? <Megaphone size={15} /> : <Hash size={15} />}<span>{channel.name}</span>{channel.count > 0 && <em>{channel.count}</em>}</button>)}
        </aside>

        <main className="community-main" id="community-discussion">
          <section className="community-header"><div><p className="kicker">7 Figure Turf Cleaning</p><h2>Answers from people doing the work.</h2></div><button className="member-count" onClick={openMembers} aria-label="Open member directory"><span className="avatar-pair">{members.slice(0, 2).map((member) => <i key={member.cloudId ?? member.id}>{member.initials}</i>)}</span><strong>{members.length}</strong><Users size={15} /></button></section>
          {!composerOpen && <button className="composer-prompt" onClick={() => setComposerOpen(true)}><Avatar name="You" members={members} /><span>Ask about a job, product, or process...</span><Plus size={18} /></button>}
          {composerOpen && <form className="full-composer" onSubmit={publish}>
            <div className="composer-head"><strong>New discussion</strong><button type="button" aria-label="Close composer" onClick={() => setComposerOpen(false)}><X size={18} /></button></div>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Clear, specific title" aria-label="Post title" maxLength={120} />
            <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add the details other operators need..." rows={4} aria-label="Post body" maxLength={5000} />
            {mentionMatches(body, members).length > 0 && <MentionSuggestions members={mentionMatches(body, members)} onSelect={(member) => setBody(insertMention(body, member.name))} />}
            <div className="composer-foot"><select value={newCategory} onChange={(event) => setNewCategory(event.target.value)} aria-label="Post category">{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select><button className="publish-button" disabled={saving || !title.trim() || !body.trim()}>{saving ? "Publishing..." : "Publish"}</button></div>
          </form>}
          {featuredPost && <section className="featured-discussion"><span><Pin size={15} /> Featured</span><button onClick={() => openThread(featuredPost.id)}><span><strong>{featuredPost.name}</strong><small>{featuredPost.author} · {featuredPost.likes ?? 0} likes</small></span><ChevronRight size={17} /></button></section>}
          <div className="category-scroller" role="tablist" aria-label="Discussion categories">{categories.map((item) => <button role="tab" aria-selected={category === item} className={category === item ? "active" : ""} onClick={() => selectCategory(item)} key={item}>{item}</button>)}</div>
          <div className="feed-controls"><div className="feed-tabs">{(["Recent", "Popular", "Following", "Saved"] as const).map((item) => <button className={sort === item ? "active" : ""} onClick={() => setSort(item)} key={item}>{item}</button>)}</div></div>
          <section className="community-feed">{visible.map((post) => {
            const quickReplyText = quickReplyDrafts[post.id] ?? "";
            const bodyExpandable = communityBodyNeedsExpansion(post.body);
            const bodyExpanded = expandedPostIds.has(post.id);
            return <article className="post-card" key={post.id}>
              <div className="post-card-heading"><PostIdentity post={post} members={members} onCategory={() => selectCategory(post.category ?? "General")} /><PostMenu post={post} open={openPostMenuId === post.id} onOpen={() => setOpenPostMenuId(openPostMenuId === post.id ? null : post.id)} onBookmark={() => void toggleBookmark(post)} onCopyLink={() => void copyPostLink(post)} onReport={() => post.cloudId && void reportContent("post", post.cloudId, "post")} onBlock={() => post.authorCloudId && void toggleMemberBlock(post.authorCloudId, post.author)} /></div>
              <button className="post-title-button" onClick={() => openThread(post.id)} aria-label={`Open ${post.name}`}><h3>{post.name}</h3></button>
              <div className={`feed-post-body${bodyExpandable && !bodyExpanded ? " collapsed" : ""}`}><PostBody body={post.body} /></div>
              {bodyExpandable && <button className="post-view-more" aria-expanded={bodyExpanded} onClick={() => togglePostExpansion(post.id)}>{bodyExpanded ? "Show less" : "View more"}</button>}
              <CommunityMediaGallery items={(post.mediaItems ?? []).slice(0, 3)} />
              <EngagementSummary likes={post.likes ?? 0} comments={post.replies} />
              <div className="post-actions"><button className={post.liked ? "active" : ""} onClick={() => void toggleLike(post)}><ThumbsUp size={16} fill={post.liked ? "currentColor" : "none"} /> Like</button><button onClick={() => focusQuickReply(post.id)}><MessageSquare size={16} /> Comment</button><button onClick={() => void sharePost(post)}><Share2 size={16} /> Share</button></div>
              <form className="quick-reply" onSubmit={(event) => void addQuickComment(event, post)}><Avatar name="You" members={members} /><div className="reply-input-wrap"><input id={`quick-reply-${post.id}`} value={quickReplyText} onFocus={() => setActiveQuickReplyPostId(post.id)} onChange={(event) => setQuickReplyDrafts((current) => ({ ...current, [post.id]: event.target.value }))} placeholder="Add a comment..." aria-label={`Comment on ${post.name}`} />{activeQuickReplyPostId === post.id && mentionMatches(quickReplyText, members).length > 0 && <MentionSuggestions members={mentionMatches(quickReplyText, members)} onSelect={(member) => setQuickReplyDrafts((current) => ({ ...current, [post.id]: insertMention(quickReplyText, member.name) }))} />}</div><button disabled={saving || !quickReplyText.trim()} aria-label="Post comment"><Send size={16} /></button></form>
            </article>;
          })}{visible.length === 0 && <div className="empty-state"><Search size={24} /><h3>{sort === "Following" ? "No posts from followed members yet" : "No discussions here yet"}</h3><p>{sort === "Following" ? "Follow members in the directory or load more posts below." : "Choose another feed or start the first conversation."}</p></div>}</section>
          {hasMorePosts && <div className="community-load-more"><button type="button" disabled={loadingMorePosts} onClick={() => void onLoadMorePosts()}>{loadingMorePosts ? "Loading posts..." : "Load more posts"}</button></div>}
        </main>

        <aside className="community-context-rail">
          <section className="community-overview-card" id="community-about">
            <div className="community-group-banner"><img src="/dirty-turf-logo.png" alt="Dirty Turf" /><span><LockKeyhole size={13} /> Private Academy</span></div>
            <div className="community-group-copy"><h3>7 Figure Turf Cleaning</h3><p>Connect, learn, and grow with turf cleaning owners and operators building stronger companies.</p><button onClick={openMembers}>View members <ChevronRight size={15} /></button></div>
            <dl className="community-stats"><div><dt>{stats.members}</dt><dd>Members</dd></div><div><dt>{stats.posts}</dt><dd>Posts</dd></div><div><dt>{stats.admins}</dt><dd>Admins</dd></div></dl>
          </section>
          {upcomingEvent && <section className="community-event-preview"><div><span><CalendarDays size={15} /> Next event</span><strong>{upcomingEvent.date}</strong></div><h3>{upcomingEvent.title}</h3><p>{upcomingEvent.time} · {upcomingEvent.duration} · {upcomingEvent.host}</p><button onClick={() => onNavigate("events")}>View event <ChevronRight size={15} /></button></section>}
          <section className="community-leaderboard" id="community-leaderboard"><div className="context-heading"><span><Trophy size={16} /> Activity leaders</span><button onClick={openMembers}>View all</button></div>{leaders.map((member, index) => <div className="community-leader" key={member.cloudId ?? member.id}><strong>{index + 1}</strong>{member.avatarUrl ? <img className="avatar small" src={member.avatarUrl} alt="" /> : <span className="avatar small">{member.initials}</span>}<span><b>{member.name}</b><small>{member.company || member.role}</small></span><em>{member.points.toLocaleString()} pts</em></div>)}{leaders.length === 0 && <p className="community-context-empty">Member activity will appear here.</p>}</section>
        </aside>
      </div>
    </div>
  );
}

function PostIdentity({ post, members, onCategory }: { post: CommunityPost; members: Member[]; onCategory: () => void }) {
  const category = post.category ?? "General";
  return <div className="post-top">
    <Avatar name={post.author} members={members} />
    <div className="post-author-meta">
      <div><strong>{post.author}</strong><span>{post.age}</span></div>
      <span>posted in <button className="post-category-tag" onClick={onCategory}>{category}</button></span>
    </div>
    {post.pinned && <span className="pinned-label"><Pin size={12} /> Pinned</span>}
  </div>;
}

function PostMenu({ post, open, onOpen, onBookmark, onCopyLink, onReport, onBlock }: { post: CommunityPost; open: boolean; onOpen: () => void; onBookmark: () => void; onCopyLink: () => void; onReport: () => void; onBlock: () => void }) {
  return <div className="post-menu-wrap">
    <button className="post-options-button" aria-label="Post options" aria-expanded={open} onClick={onOpen}><MoreHorizontal size={19} /></button>
    {open && <div className="post-menu" role="menu">
      <button role="menuitem" onClick={() => { onBookmark(); onOpen(); }}><Bookmark size={15} fill={post.saved ? "currentColor" : "none"} /> {post.saved ? "Remove saved post" : "Save post"}</button>
      <button role="menuitem" onClick={() => { onCopyLink(); onOpen(); }}><Link2 size={15} /> Copy post link</button>
      {post.cloudId && <button role="menuitem" onClick={() => { onReport(); onOpen(); }}><Flag size={15} /> Report post</button>}
      {post.authorCloudId && <button role="menuitem" onClick={() => { onBlock(); onOpen(); }}><UserX size={15} /> Block author</button>}
    </div>}
  </div>;
}

function PostBody({ body }: { body: string }) {
  return <div className="community-post-copy">{communityBodyBlocks(body).map((block, index) => {
    if (block.type === "paragraph") return <p key={`${block.type}-${index}`}>{block.text}</p>;
    const List = block.type === "ordered-list" ? "ol" : "ul";
    return <List key={`${block.type}-${index}`}>{block.items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{item}</li>)}</List>;
  })}</div>;
}

function EngagementSummary({ likes, comments }: { likes: number; comments: number }) {
  if (!likes && !comments) return null;
  return <div className="post-engagement-summary">
    <span>{likes ? `${likes} ${likes === 1 ? "like" : "likes"}` : ""}</span>
    <span>{comments ? `${comments} ${comments === 1 ? "comment" : "comments"}` : ""}</span>
  </div>;
}

function CommunityMediaGallery({ items }: { items: CommunityMedia[] }) {
  if (!items.length) return null;
  return <div className={`community-media-grid${items.length === 1 ? " single" : ""}`} aria-label="Post attachments">
    {items.map((item, index) => item.kind === "image"
      ? <a className="community-media-image" href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`} aria-label={`Open attachment ${index + 1}`}><img src={item.url} alt={`Post attachment ${index + 1}`} loading="lazy" /></a>
      : item.kind === "video"
        ? <video className="community-media-video" src={item.url} controls preload="metadata" key={`${item.url}-${index}`} aria-label={`Post video ${index + 1}`} />
        : <a className="community-media-link" href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}><ExternalLink size={17} /><span><strong>{item.label}</strong><small>Open shared resource</small></span></a>)}
  </div>;
}

function Avatar({ name, members }: { name: string; members: Member[] }) {
  const member = members.find((candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const initials = name === "You" ? "YR" : name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  if (member?.avatarUrl) return <img className="avatar small" src={member.avatarUrl} alt="" />;
  return <span className="avatar small">{initials}</span>;
}

function MentionSuggestions({ members, onSelect }: { members: Member[]; onSelect: (member: Member) => void }) {
  return <div className="mention-suggestions" role="listbox" aria-label="Mention a member">
    {members.slice(0, 5).map((member) => <button type="button" role="option" key={member.cloudId ?? member.id} onClick={() => onSelect(member)}><AtSign size={14} /><span><strong>{member.name}</strong><small>{member.company || member.role}</small></span></button>)}
  </div>;
}

function mentionMatches(value: string, members: Member[]) {
  const match = value.match(/(?:^|\s)@([^@\n]{0,60})$/);
  if (!match) return [];
  const query = match[1].trim().toLocaleLowerCase();
  return members.filter((member) => !query || member.name.toLocaleLowerCase().includes(query));
}

function insertMention(value: string, name: string) {
  return value.replace(/(^|\s)@([^@\n]{0,60})$/, (_match, prefix: string) => `${prefix}@${name} `);
}

function mentionedMemberIds(value: string, members: Member[]) {
  const normalized = value.toLocaleLowerCase();
  return members.flatMap((member) => member.cloudId && normalized.includes(`@${member.name.toLocaleLowerCase()}`) ? [member.cloudId] : []);
}

function orderThread(comments: CommunityComment[]) {
  const children = new Map<number | undefined, CommunityComment[]>();
  for (const comment of comments) {
    const key = comment.parentId && comments.some((candidate) => candidate.id === comment.parentId) ? comment.parentId : undefined;
    children.set(key, [...(children.get(key) ?? []), comment]);
  }
  const ordered: CommunityComment[] = [];
  const visited = new Set<number>();
  const visit = (comment: CommunityComment) => {
    if (visited.has(comment.id)) return;
    visited.add(comment.id);
    ordered.push(comment);
    for (const child of children.get(comment.id) ?? []) visit(child);
  };
  for (const comment of children.get(undefined) ?? []) visit(comment);
  for (const comment of comments) visit(comment);
  return ordered;
}
