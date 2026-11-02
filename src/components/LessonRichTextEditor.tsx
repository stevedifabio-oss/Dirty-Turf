import { useEffect, useRef, useState } from "react";
import { escapeLessonText, isLessonEditorLink, sanitizeLessonRichText } from "../lib/lessonRichText";

type Props = { html: string; label: string; disabled?: boolean; onChange: (html: string) => void };

/** Browser editing commands preserve the selection and native undo history. */
export function LessonRichTextEditor({ html, label, disabled = false, onChange }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const emitted = useRef<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    // Do not normalize the saved source until the author actually edits it.
    // Never replace active DOM after its own input; doing so loses the caret.
    if (editor.current && emitted.current !== html) editor.current.innerHTML = sanitizeLessonRichText(html);
    emitted.current = html;
  }, [html]);
  const rememberSelection = () => {
    const selected = window.getSelection();
    if (selected?.rangeCount && editor.current?.contains(selected.anchorNode) && editor.current?.contains(selected.focusNode)) selection.current = selected.getRangeAt(0).cloneRange();
  };
  const emit = () => {
    if (!editor.current || disabled) return;
    const next = sanitizeLessonRichText(editor.current.innerHTML);
    emitted.current = next;
    onChange(next);
  };
  const command = (name: string, value?: string) => {
    if (disabled || !editor.current) return;
    editor.current.focus();
    if (selection.current && editor.current.contains(selection.current.commonAncestorContainer)) {
      const selected = window.getSelection();
      selected?.removeAllRanges(); selected?.addRange(selection.current);
    }
    if (typeof document.execCommand !== "function") { setError("Formatting is unavailable in this browser. You can still edit the text."); return; }
    document.execCommand(name, false, value);
    rememberSelection();
    emit();
  };
  const controls = [
    ["Bold", "bold"], ["Italic", "italic"], ["Underline", "underline"],
    ["Bulleted list", "insertUnorderedList"], ["Numbered list", "insertOrderedList"],
    ["Undo text edit", "undo"], ["Redo text edit", "redo"],
  ];
  return <div className="lesson-description-editor">
    <div role="group" aria-label={`${label} formatting`} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
      {controls.map(([title, name]) => <button type="button" key={name} aria-label={title} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command(name)}>{title.replace(" text edit", "")}</button>)}
      <label>Style<select aria-label={`${label} text style`} defaultValue="p" disabled={disabled} onMouseDown={rememberSelection} onChange={event => command("formatBlock", event.target.value)}><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option><option value="blockquote">Quote</option></select></label>
      <button type="button" disabled={disabled} onMouseDown={event => { event.preventDefault(); rememberSelection(); }} onClick={() => { setLinkOpen(value => !value); setError(""); }}>Add link</button>
      <button type="button" disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => command("unlink")}>Remove link</button>
    </div>
    {linkOpen && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}><label>Link address<input type="url" aria-label={`${label} link address`} value={link} disabled={disabled} onChange={event => setLink(event.target.value)} placeholder="https://…" /></label><button type="button" disabled={disabled} onClick={() => {
      const url = link.trim();
      if (!isLessonEditorLink(url)) { setError("Enter a full http:// or https:// link without a username or password."); return; }
      command("createLink", url); setLinkOpen(false); setLink(""); setError("");
    }}>Apply link</button></div>}
    {error && <p className="admin-form-error" role="alert">{error}</p>}
    <div ref={editor} className="lesson-rich-text lesson-description-input" role="textbox" aria-label={label} aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning tabIndex={disabled ? -1 : 0}
      style={{ minHeight: 180, padding: 12, border: "1px solid #b7c4bc", borderRadius: 10, overflowWrap: "anywhere" }}
      onInput={emit} onKeyUp={rememberSelection} onMouseUp={rememberSelection}
      onClick={event => { if ((event.target as Element).closest("a")) event.preventDefault(); }}
      onPaste={event => { event.preventDefault(); command("insertHTML", escapeLessonText(event.clipboardData.getData("text/plain"))); }}
      onDrop={event => { event.preventDefault(); setError("Use the photo or video blocks to add files. Paste text into the description."); }} />
    <p className="admin-form-note">Select text to format it. Pasted text uses this editor’s formatting. Use Preview to check lesson media.</p>
  </div>;
}
