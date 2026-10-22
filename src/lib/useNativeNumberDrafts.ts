import { useState, type ChangeEvent } from "react";

/** Keep native number constraints and numeric values without reinserting 0 on Backspace. */
export function useNativeNumberDrafts() {
  const [drafts, setDrafts] = useState<Record<string, { text: string; number: number }>>({});
  return (key: string, value: number, update: (value: number) => void) => ({
    value: drafts[key]?.number === value ? drafts[key].text : String(value),
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const text = event.target.value;
      const number = Number(text);
      if (!Number.isFinite(number)) return;
      setDrafts(current => ({ ...current, [key]: { text, number } }));
      update(number);
    },
  });
}
