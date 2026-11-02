import { useId, useRef, useState } from "react";
import { GripVertical } from "lucide-react";

/** Pointer capture keeps touch dragging on the grip, leaving the rest scrollable. */
export function ReorderHandle({ name, disabled, onMove, onStep }: {
  name: string;
  disabled?: boolean;
  onMove: (targetId: string, before: boolean) => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const helpId = useId();
  const drag = useRef<{ pointerId: number; source: HTMLElement; list: HTMLElement; target?: HTMLElement; before: boolean; startY: number; moved: boolean } | undefined>(undefined);
  const [active, setActive] = useState(false);
  const clean = () => {
    const current = drag.current;
    current?.source.removeAttribute("data-reorder-dragging");
    current?.target?.removeAttribute("data-reorder-target");
    drag.current = undefined;
    setActive(false);
  };
  return <><button type="button" className="reorder-handle" disabled={disabled}
    aria-label={`Drag ${name}`} aria-describedby={helpId} aria-pressed={active}
    title="Drag to move, or use the up and down arrow keys"
    onKeyDown={event => {
      if (disabled) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); onStep(event.key === "ArrowUp" ? -1 : 1); }
      if (event.key === "Escape") { event.preventDefault(); clean(); }
    }}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      const source = event.currentTarget.closest<HTMLElement>("[data-reorder-item]");
      const list = source?.closest<HTMLElement>("[data-reorder-list]");
      if (!source || !list) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, source, list, before: true, startY: event.clientY, moved: false };
      source.dataset.reorderDragging = "true";
      setActive(true);
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.moved ||= Math.abs(event.clientY - current.startY) > 5;
      current.target?.removeAttribute("data-reorder-target");
      current.target = undefined;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-reorder-item]");
      if (target && target !== current.source && target.closest("[data-reorder-list]") === current.list) {
        const rect = target.getBoundingClientRect();
        current.before = event.clientY < rect.top + rect.height / 2;
        current.target = target;
        target.dataset.reorderTarget = current.before ? "before" : "after";
      }
      // Keep long outlines usable without turning the whole page into a drag area.
      if (event.clientY < 70) window.scrollBy(0, -18);
      else if (event.clientY > window.innerHeight - 70) window.scrollBy(0, 18);
    }}
    onPointerUp={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const targetId = current.target?.dataset.reorderItem;
      const before = current.before;
      const moved = current.moved;
      clean();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (!disabled && moved && targetId) onMove(targetId, before);
    }}
    onPointerCancel={clean} onLostPointerCapture={clean}><GripVertical size={18} aria-hidden="true" /></button>
    <span className="reorder-sr-only" id={helpId}>Drag to another box, or use the up and down arrow keys to move. Escape cancels a drag.</span></>;
}
