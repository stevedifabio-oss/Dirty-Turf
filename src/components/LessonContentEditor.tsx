import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, ImagePlus, Link2, Pencil, Plus, Trash2, Type, Undo2, Upload, Video } from "lucide-react";
import { LessonContent } from "./LessonContent";
import type { LessonContentBlock } from "../lib/lessonContent";
import { ADMIN_LESSON_BLOCK_IMAGE_LIMIT_BYTES, ADMIN_LESSON_BLOCK_VIDEO_LIMIT_BYTES } from "../lib/lessonUploadLimits";

type Props = {
  blocks: LessonContentBlock[];
  files: Record<string, File>;
  localMedia: Record<string, string>;
  disabled: boolean;
  onChange: (blocks: LessonContentBlock[]) => void;
  onFileChange: (id: string, file: File | undefined) => void;
};
const kinds = [
  { type: "text", label: "Text", icon: Type, help: "Write instructions" },
  { type: "video", label: "Video", icon: Video, help: "Upload or paste a link" },
  { type: "image", label: "Photo", icon: ImagePlus, help: "Upload or paste a link" },
  { type: "link", label: "Link", icon: Link2, help: "Add a useful resource" },
] as const;

export function LessonContentEditor({ blocks, files, localMedia, disabled, onChange, onFileChange }: Props) {
  const [preview, setPreview] = useState(false);
  const [fileError, setFileError] = useState("");
  const [removed, setRemoved] = useState<{ block: LessonContentBlock; index: number; file?: File } | null>(null);
  const focusBlock = useRef("");
  useEffect(() => {
    if (!focusBlock.current) return;
    const node = document.getElementById(`lesson-content-block-${focusBlock.current}`);
    focusBlock.current = "";
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: "start" });
  }, [blocks]);
  const update = (id: string, changes: Record<string, string>) => onChange(blocks.map(block => block.id === id ? { ...block, ...changes } as LessonContentBlock : block));
  const add = (type: typeof kinds[number]["type"]) => {
    const id = crypto.randomUUID();
    const block: LessonContentBlock = type === "text" ? { id, type, text: "" }
      : type === "image" ? { id, type, url: "", alt: "", caption: "" }
      : type === "video" ? { id, type, url: "", caption: "" } : { id, type, url: "", label: "" };
    focusBlock.current = id;
    onChange([...blocks, block]);
    setPreview(false);
  };
  const move = (index: number, direction: -1 | 1) => {
    const next = [...blocks];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  };
  const pickFile = (block: LessonContentBlock, file: File | undefined) => {
    if (!file || (block.type !== "image" && block.type !== "video")) return;
    const types = block.type === "image" ? ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] : ["video/mp4", "video/webm", "video/quicktime"];
    const limit = block.type === "image" ? ADMIN_LESSON_BLOCK_IMAGE_LIMIT_BYTES : ADMIN_LESSON_BLOCK_VIDEO_LIMIT_BYTES;
    if (!types.includes(file.type) || file.size <= 0 || file.size > limit) {
      setFileError(block.type === "image" ? "Choose a JPG, PNG, WebP, GIF or AVIF photo up to 20 MB." : "Choose an MP4, WebM or MOV video up to 50 MB. Use a video link for a larger video.");
      return;
    }
    setFileError("");
    update(block.id, { url: "" });
    onFileChange(block.id, file);
  };
  return <section className="lesson-builder" aria-label="Lesson content builder">
    <header className="lesson-builder-heading"><div><h4>Lesson content</h4><p>Add the pieces you need, in the order members should see them.</p></div><div className="lesson-builder-mode" aria-label="Editor view"><button type="button" aria-pressed={!preview} disabled={disabled} onClick={() => setPreview(false)}><Pencil size={14} /> Edit</button><button type="button" aria-pressed={preview} disabled={disabled} onClick={() => setPreview(true)}><Eye size={15} /> Preview</button></div></header>
    {fileError && <p className="admin-form-error" role="alert">{fileError}</p>}
    {removed && <div className="lesson-builder-undo" role="status">Content removed.<button type="button" disabled={disabled} onClick={() => { const next = [...blocks]; next.splice(Math.min(removed.index, next.length), 0, removed.block); onChange(next); if (removed.file) onFileChange(removed.block.id, removed.file); setRemoved(null); }}><Undo2 size={15} /> Undo</button></div>}
    {preview ? <div className="lesson-builder-preview"><p className="lesson-preview-label">Member preview · unsaved changes</p>{blocks.length ? <LessonContent blocks={blocks} localMedia={localMedia} /> : <p className="admin-muted">Your lesson will appear here. Switch to Edit to add content.</p>}</div> : <div className="lesson-builder-blocks">
      {blocks.map((block, index) => {
        const kind = kinds.find(item => item.type === block.type);
        const Icon = kind?.icon ?? Type;
        const label = block.type === "legacy" ? "Imported content" : kind?.label ?? "Content";
        const inputId = `lesson-block-${block.id}`;
        return <section className="lesson-builder-block" id={`lesson-content-block-${block.id}`} tabIndex={-1} key={block.id} aria-label={`${label} block ${index + 1}`}>
          <header><span><Icon size={17} /><strong>{label}</strong><small>{index + 1}</small></span><div><button type="button" aria-label={`Move ${label.toLowerCase()} block ${index + 1} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`Move ${label.toLowerCase()} block ${index + 1} down`} disabled={disabled || index === blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button><button type="button" aria-label={`Remove ${label.toLowerCase()} block ${index + 1}`} disabled={disabled} onClick={() => { setRemoved({ block, index, file: files[block.id] }); onChange(blocks.filter(item => item.id !== block.id)); onFileChange(block.id, undefined); }}><Trash2 size={16} /></button></div></header>
          <div className="lesson-builder-fields">
            {block.type === "text" && <label htmlFor={inputId}>Text<textarea id={inputId} aria-label={`Text ${index + 1}`} value={block.text} disabled={disabled} rows={5} onChange={event => update(block.id, { text: event.target.value })} placeholder="Explain the steps, share a tip, or introduce the next video…" required /></label>}
            {block.type === "legacy" && <><p className="admin-form-note">Your imported formatting and media are kept. Add new content below, or remove this block to replace it.</p><div className="lesson-imported-preview"><LessonContent blocks={[block]} /></div></>}
            {(block.type === "video" || block.type === "image") && <>
              <div className="lesson-media-source"><label className="lesson-media-upload"><Upload size={18} /><span><strong>{files[block.id] ? "Change file" : `Upload ${block.type === "image" ? "photo" : "video"}`}</strong><small>{files[block.id]?.name ?? (block.type === "image" ? "JPG, PNG, WebP, GIF or AVIF · up to 20 MB" : "MP4, WebM or MOV · up to 50 MB; use a video link for larger videos")}</small></span><input type="file" aria-label={`Upload ${label.toLowerCase()} ${index + 1}`} accept={block.type === "image" ? "image/jpeg,image/png,image/webp,image/gif,image/avif" : "video/mp4,video/webm,video/quicktime"} disabled={disabled} onChange={event => { pickFile(block, event.target.files?.[0]); event.target.value = ""; }} /></label>{block.url.startsWith("academy-asset:") ? <div className="lesson-saved-media"><strong>{label} saved to this lesson</strong><button type="button" disabled={disabled} onClick={() => update(block.id, { url: "" })}>Replace with a link</button></div> : <><span className="lesson-source-or">or paste a link</span><label htmlFor={inputId}>{block.type === "video" ? "Video link" : "Photo link"}<input id={inputId} aria-label={`${label} link ${index + 1}`} type="url" value={block.url} disabled={disabled} onChange={event => { update(block.id, { url: event.target.value }); onFileChange(block.id, undefined); }} placeholder={block.type === "video" ? "https://youtube.com/watch?v=…" : "https://…/photo.jpg"} required={!files[block.id]} /></label></>}</div>
              {localMedia[block.id] && block.type === "image" && <img className="lesson-selected-photo" src={localMedia[block.id]} alt={block.alt || "Selected photo preview"} />}
              {files[block.id] && <p className="lesson-file-ready"><CheckFile />{files[block.id].name} · ready to upload when you save</p>}
              {block.type === "image" && <label>Photo description<input aria-label={`Photo description ${index + 1}`} value={block.alt} disabled={disabled} onChange={event => update(block.id, { alt: event.target.value })} placeholder="Describe the photo for members who use a screen reader" required /></label>}
              <label>Caption (optional)<input aria-label={`${label} caption ${index + 1}`} value={block.caption} disabled={disabled} onChange={event => update(block.id, { caption: event.target.value })} placeholder="What should members notice?" /></label>
            </>}
            {block.type === "link" && <><label htmlFor={inputId}>Link address<input id={inputId} aria-label={`Link address ${index + 1}`} type="url" value={block.url} disabled={disabled} onChange={event => update(block.id, { url: event.target.value })} placeholder="https://…" required /></label><label>Link text<input aria-label={`Link text ${index + 1}`} value={block.label} disabled={disabled} onChange={event => update(block.id, { label: event.target.value })} placeholder="e.g. Download the equipment checklist" required /></label></>}
          </div>
        </section>;
      })}
      <div className="lesson-add-content" aria-label="Add lesson content">{kinds.map(({ type, label, icon: Icon, help }) => <button type="button" key={type} disabled={disabled} onClick={() => add(type)} aria-label={`Add ${label.toLowerCase()}`}><span><Icon size={21} /><Plus size={13} /></span><strong>{label}</strong><small>{help}</small></button>)}</div>
      {!blocks.length && <p className="admin-muted lesson-builder-hint">Start with any content type. You can combine them in the same lesson.</p>}
    </div>}
  </section>;
}

function CheckFile() { return <Upload size={14} aria-hidden="true" />; }
