import type { Course, Lesson } from "../domain";
import { combinedCourseProgress } from "./courseProgress";

export function academyDurationLabel(duration: string) {
  const label = duration.trim();
  return !label || /^(?:unknown|0\s*(?:min(?:utes?)?|h(?:ours?)?|hr|s(?:econds?)?|sec)?)$/i.test(label)
    ? "Self-paced"
    : label;
}

export function hasCarriedOverProgress(course: Pick<Course, "modules" | "importedProgress">) {
  const lessons = course.modules.flatMap((module) => module.lessons);
  const currentProgress = combinedCourseProgress(lessons.filter((lesson) => lesson.completed).length, lessons.length);
  return (course.importedProgress ?? 0) > currentProgress;
}

type LessonResource = NonNullable<Lesson["resources"]>[number];

const fileLabels: Record<string, string> = {
  pdf: "PDF",
  doc: "Document", docx: "Document", document: "Document",
  xls: "Spreadsheet", xlsx: "Spreadsheet", csv: "Spreadsheet",
  ppt: "Presentation", pptx: "Presentation",
  txt: "Text file", rtf: "Document",
  jpg: "Image", jpeg: "Image", png: "Image", gif: "Image", webp: "Image", svg: "Image", image: "Image",
  mp3: "Audio", wav: "Audio", m4a: "Audio", ogg: "Audio", audio: "Audio",
  mp4: "Video", mov: "Video", webm: "Video", video: "Video",
  zip: "Archive", rar: "Archive", "7z": "Archive", archive: "Archive",
};

export function academyResourcePresentation(resource: LessonResource) {
  let url: URL | undefined;
  try { url = new URL(resource.url); } catch { /* Keep an authored title when a URL cannot be parsed. */ }
  const isWebsite = url?.protocol === "https:" || url?.protocol === "http:";
  const hostname = isWebsite ? url?.hostname.replace(/^www\./i, "") : undefined;
  let filename = url?.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try { filename = decodeURIComponent(filename); } catch { /* Retain malformed source text without throwing. */ }
  const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  const declaredType = resource.type?.trim().toLowerCase();
  const fileType = fileLabels[extension ?? ""] ?? fileLabels[declaredType ?? ""];
  const title = resource.title.trim();
  const isUrlTitle = /^(?:https?:)?\/\//i.test(title);
  const isOpaqueSlug = title === filename && /[0-9._-]/.test(title) && !/\s/.test(title) && !fileLabels[extension ?? ""];

  return {
    title: hostname && (!title || isUrlTitle || isOpaqueSlug) ? hostname : title || "Lesson resource",
    type: fileType ?? (isWebsite ? "Website" : "Resource"),
    isDownload: Boolean(fileType),
  };
}
