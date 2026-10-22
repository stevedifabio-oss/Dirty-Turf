import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// Only the foremost modal owns keyboard focus. Keep scroll locking correct if
// a parent closes while a second dialog is still mounted.
const dialogs: HTMLElement[] = [];
let overflowBeforeDialogs = "";

export function useModalDialog(dialogRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialogs.length) overflowBeforeDialogs = document.body.style.overflow;
    dialogs.push(dialog);
    document.body.style.overflow = "hidden";
    const isForemost = () => dialogs[dialogs.length - 1] === dialog;

    const focusTimer = window.setTimeout(() => {
      if (isForemost()) dialog.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isForemost()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (isForemost() && event.target instanceof Node && !dialog.contains(event.target)) {
        dialog.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      const wasForemost = isForemost();
      const index = dialogs.lastIndexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      document.body.style.overflow = dialogs.length ? "hidden" : overflowBeforeDialogs;
      if (wasForemost) previousFocus?.focus();
    };
  }, [dialogRef]);
}
