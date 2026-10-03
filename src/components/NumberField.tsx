import { useEffect, useState } from "react";

type NumberFieldProps = {
  label: string;
  value: number;
  update: (value: number) => void;
  prefix?: string;
  suffix?: string;
};

function draftNumber(text: string) {
  return text === "" || text === "." || text === "," ? 0 : Number(text.replace(",", "."));
}

export function NumberField({ label, value, update, prefix, suffix }: NumberFieldProps) {
  // Keep the text being edited separate from the numeric calculation. Converting
  // an empty input straight back to a number reinserts a zero on every backspace.
  const [draft, setDraft] = useState(value === 0 ? "" : String(value));

  useEffect(() => {
    // An AR measurement can replace the value externally. Preserve equivalent
    // drafts such as "", "0.", and "12.50" while the operator is typing.
    setDraft((current) => draftNumber(current) === value ? current : value === 0 ? "" : String(value));
  }, [value]);

  const change = (text: string) => {
    if (!/^\d*(?:[.,]\d*)?$/.test(text)) return;
    const next = draftNumber(text);
    if (!Number.isFinite(next)) return;
    setDraft(text);
    update(next);
  };

  return <label className="number-field"><span>{label}</span><div>{prefix && <i>{prefix}</i>}<input
    type="text"
    inputMode="decimal"
    value={draft}
    placeholder="0"
    onChange={(event) => change(event.target.value)}
    onBlur={() => setDraft((current) => current === "" || current === "." || current === "," ? "" : String(draftNumber(current)))}
  />{suffix && <small>{suffix}</small>}</div></label>;
}
