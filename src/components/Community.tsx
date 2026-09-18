import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, AtSign, Bookmark, Check, ExternalLink, Heart, Image, MapPin, MessageSquare, MoreHorizontal, Paperclip, Pin, Plus, Search, Send, Share2, SlidersHorizontal, Users, X } from "lucide-react";
import type { CommunityComment, CommunityMedia, CommunityPost, Member } from "../domain";

type Props = {
  posts: CommunityPost[];
  comments: CommunityComment[];
  members: Member[];
  requestedPostCloudId?: string;
  onRequestedPostOpened: () => void;
  onPostsChange: (posts: CommunityPost[]) => void;
  onCommentsChange: (comments: CommunityComment[]) => void;
  onCreatePost: (post: CommunityPost) => Promise<CommunityPost>;
  onCreateComment: (comment: CommunityComment, postCloudId?: string) => Promise<CommunityComment>;
  onToggleLike: (post: CommunityPost) => Promise<boolean | null>;
  onToggleCommentLike: (comment: CommunityComment) => Promise<boolean | null>;
  onToggleBookmark: (post: CommunityPost) => Promise<boolean | null>;
  onToast: (message: string) => void;
};

const highLevelChannels = [
  "Announcements",
  "Start Here",
  "General",
  "Turf Help",
  "Chemistry & Cleaners",
  "Infill",
  "Equipment",
  "Marketing",
  "Sales",
  "Business",
  "Job Help",
  "Member Wins",
  "Myth Busters",
  "Products",
  "Completed Jobs",
];

export function CommunityView({ posts, comments, members, requestedPostCloudId, onRequestedPostOpened, onPostsChange, onCommentsChange, onCreatePost, onCreateComment, onToggleLike, onToggleCommentLike, onToggleBookmark, onToast }: Props) {
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
  const [saving, setSaving] = useState(false);
  const selected = posts.find((post) => post.id === selectedPostId);

  useEffect(() => {
    if (!requestedPostCloudId) return;
    const requested = posts.find((post) => post.cloudId === requestedPostCloudId);
    if (!requested) return;
    setSelectedPostId(requested.id);
    onRequestedPostOpened();
  }, [onRequestedPostOpened, posts, requestedPostCloudId]);
  const categories = useMemo(() => {
    const discovered = posts
      .map((post) => post.category?.trim())
      .filter((item): item is string => Boolean(item));
    return ["All", ...Array.from(new Set([...highLevelChannels, ...discovered]))];
  }, [posts]);

  const visible = useMemo(() => {
    let next = category === "All" ? [...posts] : posts.filter((post) => post.category === category);
    if (sort === "Popular") next.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
    if (sort === "Following") next = next.filter((post) => post.following);
    if (sort === "Saved") next = next.filter((post) => post.saved);
    return next.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [category, posts, sort]);

  const updatePost = (id: number, changes: Partial<CommunityPost>) => onPostsChange(posts.map((post) => post.id === id ? { ...post, ...changes } : post));
  const openThread = (id: number) => {
    setSelectedPostId(id);
    document.querySelector(".phone-frame")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
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
      parentId: replyingTo?.id,
      parentCloudId: replyingTo?.cloudId,
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
    const shareData = { title: post.name, text: post.body };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(`${post.name}\n\n${post.body}`);
        onToast("Post copied to the clipboard.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onToast("Post could not be shared.");
    }
  };

  if (membersOpen) {
    return <div className="view-content member-directory-view">
      <div className="subview-bar"><button className="back-link" onClick={() => setMembersOpen(false)}><ArrowLeft size={17} /> Community</button><span>{members.length} members</span></div>
      <section className="member-directory-heading"><p className="kicker">Operator network</p><h2>Academy members</h2></section>
      <section className="member-directory">{members.map((member) => <article className="member-row" key={member.id}>
        {member.avatarUrl ? <img className="avatar small" src={member.avatarUrl} alt="" /> : <span className="avatar small">{member.initials}</span>}
        <span><strong>{member.name}</strong><small>{member.company || member.role}</small><em><MapPin size={12} /> {member.location || "Location not listed"}</em></span>
        <span className="member-level">Lv {member.level}</span>
      </article>)}</section>
      {members.length === 0 && <div className="empty-state"><Users size={24} /><h3>No members imported yet</h3><p>The directory will populate from the verified HighLevel member export.</p></div>}
    </div>;
  }

  if (selected) {
    const thread = orderThread(comments.filter((comment) => comment.postId === selected.id));
    const commentMentionMatches = mentionMatches(commentText, members);
    return <div className="view-content thread-view">
      <div className="subview-bar"><button className="back-link" onClick={() => setSelectedPostId(null)}><ArrowLeft size={17} /> Community</button><button className="icon-plain" aria-label="Post options" onClick={() => onToast("Post moderation options are ready for admins.")}><MoreHorizontal size={19} /></button></div>
      <article className="thread-post">
        <div className="post-top"><Avatar name={selected.author} /><div><strong>{selected.author}</strong><span>{selected.age} · {selected.category}</span></div>{selected.pinned && <span className="pinned-label"><Pin size={12} /> Pinned</span>}</div>
        <h2>{selected.name}</h2><p>{selected.body}</p>
        <CommunityMediaGallery items={selected.mediaItems ?? []} />
        <div className="post-actions"><button className={selected.liked ? "active" : ""} onClick={() => void toggleLike(selected)}><Heart size={17} fill={selected.liked ? "currentColor" : "none"} /> {selected.likes ?? 0}</button><button><MessageSquare size={17} /> {thread.length}</button><button onClick={() => void sharePost(selected)}><Share2 size={17} /> Share</button><button className={selected.saved ? "active" : ""} onClick={() => void toggleBookmark(selected)}><Bookmark size={17} fill={selected.saved ? "currentColor" : "none"} /> {selected.saved ? "Saved" : "Save"}</button></div>
      </article>
      <section className="thread-comments">
        <div className="thread-count">{thread.length} replies</div>
        {thread.map((comment) => <article className={`${comment.answer ? "comment answer" : "comment"}${comment.parentId ? " nested" : ""}`} key={comment.id}><Avatar name={comment.author} /><div><div className="comment-head"><strong>{comment.author}</strong><span>{comment.age}</span>{comment.answer && <em><Check size={11} /> Answer</em>}</div><p>{comment.body}</p><div className="comment-actions"><button className={comment.liked ? "active" : ""} onClick={() => void toggleCommentLike(comment)}><Heart size={14} fill={comment.liked ? "currentColor" : "none"} /> {comment.likes}</button><button onClick={() => { setReplyingTo(comment); setCommentText(`@${comment.author} `); }}><MessageSquare size={14} /> Reply</button></div></div></article>)}
      </section>
      {replyingTo && <div className="replying-to"><span>Replying to <strong>{replyingTo.author}</strong></span><button onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}
      <form className="reply-composer" onSubmit={addComment}><Avatar name="You" /><div className="reply-input-wrap"><input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder={replyingTo ? `Reply to ${replyingTo.author}...` : "Write a reply..."} aria-label="Write a reply" />{commentMentionMatches.length > 0 && <MentionSuggestions members={commentMentionMatches} onSelect={(member) => setCommentText(insertMention(commentText, member.name))} />}</div><button disabled={saving || !commentText.trim()} aria-label="Post reply"><Send size={17} /></button></form>
    </div>;
  }

  return (
    <div className="view-content community-view">
      <section className="community-header"><div><p className="kicker">7 Figure Turf Cleaning</p><h2>Answers from people doing the work.</h2></div><button className="member-count" onClick={() => setMembersOpen(true)} aria-label="Open member directory"><span className="avatar-pair"><i>M</i><i>C</i></span><strong>{members.length}</strong><Users size={15} /></button></section>
      {!composerOpen && <button className="composer-prompt" onClick={() => setComposerOpen(true)}><Avatar name="You" /><span>Ask about a job, product, or process...</span><Plus size={18} /></button>}
      {composerOpen && <form className="full-composer" onSubmit={publish}>
        <div className="composer-head"><strong>New discussion</strong><button type="button" aria-label="Close composer" onClick={() => setComposerOpen(false)}><X size={18} /></button></div>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Clear, specific title" aria-label="Post title" maxLength={120} />
        <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add the details other operators need..." rows={4} aria-label="Post body" maxLength={5000} />
        {mentionMatches(body, members).length > 0 && <MentionSuggestions members={mentionMatches(body, members)} onSelect={(member) => setBody(insertMention(body, member.name))} />}
        <div className="composer-foot"><select value={newCategory} onChange={(event) => setNewCategory(event.target.value)} aria-label="Post category">{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select><button type="button" className="attach-button" aria-label="Attach media" onClick={() => onToast("Photo and file uploads activate with private storage.")}><Paperclip size={17} /></button><button className="publish-button" disabled={saving || !title.trim() || !body.trim()}>{saving ? "Publishing..." : "Publish"}</button></div>
      </form>}
      <div className="category-scroller" role="tablist" aria-label="Discussion categories">{categories.map((item) => <button role="tab" aria-selected={category === item} className={category === item ? "active" : ""} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
      <div className="feed-controls"><div className="feed-tabs">{(["Recent", "Popular", "Following", "Saved"] as const).map((item) => <button className={sort === item ? "active" : ""} onClick={() => setSort(item)} key={item}>{item}</button>)}</div><button className="icon-plain" aria-label="Feed filters" onClick={() => onToast("Showing posts from your company community.")}><SlidersHorizontal size={17} /></button></div>
      <section className="community-feed">{visible.map((post) => <article className="post-card" key={post.id}>
        <div className="post-top"><Avatar name={post.author} /><div><strong>{post.author}</strong><span>{post.age} · {post.category}</span></div>{post.pinned && <span className="pinned-label"><Pin size={12} /> Pinned</span>}</div>
        <button className="post-open" onClick={() => openThread(post.id)}><h3>{post.name}</h3><p>{post.body}</p>{Boolean(post.mediaItems?.length) && <span className="media-strip"><Image size={16} /> {post.mediaItems!.length} {post.mediaItems!.length === 1 ? "attachment" : "attachments"}</span>}</button>
        <div className="post-actions"><button className={post.liked ? "active" : ""} onClick={() => void toggleLike(post)}><Heart size={16} fill={post.liked ? "currentColor" : "none"} /> {post.likes ?? 0}</button><button onClick={() => openThread(post.id)}><MessageSquare size={16} /> {post.replies}</button><button aria-label="Share post" onClick={() => void sharePost(post)}><Share2 size={16} /></button><button className={post.saved ? "active" : ""} aria-label={post.saved ? "Remove bookmark" : "Bookmark post"} onClick={() => void toggleBookmark(post)}><Bookmark size={16} fill={post.saved ? "currentColor" : "none"} /></button></div>
      </article>)}{visible.length === 0 && <div className="empty-state"><Search size={24} /><h3>No discussions here yet</h3><p>Choose another feed or start the first conversation.</p></div>}</section>
    </div>
  );
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

function Avatar({ name }: { name: string }) {
  const initials = name === "You" ? "YR" : name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
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
