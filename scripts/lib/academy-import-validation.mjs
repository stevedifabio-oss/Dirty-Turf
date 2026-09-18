function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function lessonHasContent(lesson) {
  if (!lesson || typeof lesson !== "object") return false;
  if (hasText(lesson.videoUrl) || hasText(lesson.transcript)) return true;
  if (Array.isArray(lesson.resources) && lesson.resources.length > 0) return true;

  const body = lesson.body;
  if (hasText(body)) return true;
  if (!body || typeof body !== "object") return false;
  if (["html", "text", "content", "description"].some((key) => hasText(body[key]))) return true;

  return Array.isArray(body.quiz?.questions) && body.quiz.questions.length > 0;
}
