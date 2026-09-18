export type CommunityBodyBlock =
  | { type: "paragraph"; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] };

const POST_ACTION_LABELS = new Set(["like", "comment", "share"]);
const VIDEO_CONTROL_LABEL = /^(?:play|rewind 10s|forward 10s|\d{1,2}:\d{2}|mute|settings|pip|enter fullscreen)$/i;

function comparableText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function cleanCommunityPostBody(value: string, title?: string) {
  let lines = value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  const trimEdges = () => {
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  };
  trimEdges();

  let removedAction = false;
  while (POST_ACTION_LABELS.has(comparableText(lines.at(-1) ?? ""))) {
    lines.pop();
    removedAction = true;
    trimEdges();
  }
  if (removedAction) {
    while (/^(?:\d+|\d+\s+comments?)$/i.test(lines.at(-1)?.trim() ?? "")) {
      lines.pop();
      trimEdges();
    }
  }

  if (lines.filter((line) => VIDEO_CONTROL_LABEL.test(line.trim())).length >= 3) {
    lines = lines.filter((line) => !VIDEO_CONTROL_LABEL.test(line.trim()));
    trimEdges();
  }

  if (title && comparableText(lines[0] ?? "") === comparableText(title)) {
    lines.shift();
    trimEdges();
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function communityBodyBlocks(value: string): CommunityBodyBlock[] {
  const blocks: CommunityBodyBlock[] = [];
  let paragraph: string[] = [];
  let listType: "unordered-list" | "ordered-list" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };
  const flushList = () => {
    if (listType && listItems.length) blocks.push({ type: listType, items: listItems });
    listType = null;
    listItems = [];
  };

  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const unordered = line.match(/^(?:[-*\u2022])\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "unordered-list" : "ordered-list";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered?.[1] ?? ordered?.[1] ?? "").trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function communityBodyNeedsExpansion(value: string) {
  const normalized = value.trim();
  if (normalized.length > 420) return true;
  const visibleLines = normalized.split(/\r?\n/).filter((line) => line.trim()).length;
  return visibleLines > 7 || communityBodyBlocks(normalized).length > 4;
}

export function communityPostShareUrl(currentUrl: string, cloudId?: string) {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "community");
  if (cloudId) url.searchParams.set("post", cloudId);
  return url.toString();
}
