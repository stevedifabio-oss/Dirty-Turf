export type QuizQuestionDraft = {
  id: string;
  prompt: string;
  optionLines: string;
  correctOption: number;
  explanation: string;
  original?: Record<string, unknown>;
};

export function lessonBodyText(body?: Record<string, unknown>) {
  if (!body) return "";
  for (const key of ["text", "content", "description"] as const) {
    if (typeof body[key] === "string") return body[key];
  }
  return typeof body.html === "string" ? plainText(body.html) : "";
}

export function lessonBodyForSave(body: Record<string, unknown> | undefined, initialContent: string, nextContent: string) {
  const saved: Record<string, unknown> = { ...(body ?? {}) };
  if (!body || nextContent !== initialContent) {
    saved.text = nextContent.trim();
    delete saved.content;
    delete saved.description;
    delete saved.html;
  }
  return saved;
}

export function emptyQuizQuestion(): QuizQuestionDraft {
  return { id: crypto.randomUUID(), prompt: "", optionLines: "", correctOption: 1, explanation: "" };
}

export function quizOptionsFor(question: QuizQuestionDraft) {
  return question.optionLines.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function updateQuizQuestion(questions: QuizQuestionDraft[], id: string, changes: Partial<QuizQuestionDraft>) {
  return questions.map((question) => question.id === id ? { ...question, ...changes } : question);
}

export function existingQuizBody(body?: Record<string, unknown>) {
  return body && isRecord(body.quiz) ? body.quiz : {};
}

export function quizEditorState(body?: Record<string, unknown>): { passingPercent: number; questions: QuizQuestionDraft[] } {
  const quiz = existingQuizBody(body);
  const passingPercent = typeof quiz.passingPercent === "number" ? Math.min(100, Math.max(1, quiz.passingPercent)) : 80;
  const questions = Array.isArray(quiz.questions) ? quiz.questions.flatMap((value) => {
    if (!isRecord(value) || !Array.isArray(value.options)) return [];
    const prompt = editableRichText(value.prompt);
    const options = value.options.map(editableRichText).filter(Boolean);
    const explanation = editableRichText(value.explanation);
    if (!prompt || options.length < 2) return [];
    const legacyAnswer = options.findIndex((option) => normalizedAnswer(option) === normalizedAnswer(explanation));
    const storedAnswer = typeof value.correctOptionIndex === "number" && Number.isInteger(value.correctOptionIndex)
      && value.correctOptionIndex >= 0 && value.correctOptionIndex < options.length ? value.correctOptionIndex : undefined;
    return [{ id: crypto.randomUUID(), prompt, optionLines: options.join("\n"), correctOption: (storedAnswer ?? (legacyAnswer >= 0 ? legacyAnswer : 0)) + 1, explanation, original: value }];
  }) : [];
  return { passingPercent, questions: questions.length ? questions : [emptyQuizQuestion()] };
}

export function serializeQuizQuestion(question: QuizQuestionDraft) {
  const options = quizOptionsFor(question);
  const original = question.original;
  const originalOptions = original && Array.isArray(original.options) ? original.options : [];
  return {
    ...(original ?? {}),
    prompt: original && editableRichText(original.prompt) === question.prompt.trim() ? original.prompt : question.prompt.trim(),
    options: options.map((option, index) => originalOptions[index] !== undefined && editableRichText(originalOptions[index]) === option ? originalOptions[index] : option),
    correctOptionIndex: question.correctOption - 1,
    explanation: original && editableRichText(original.explanation) === question.explanation.trim() ? original.explanation : question.explanation.trim(),
  };
}

function editableRichText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text.trim();
  return typeof value.html === "string" ? plainText(value.html) : "";
}

function plainText(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p\s*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ").replace(/ *\n+ */g, "\n").trim();
}

function normalizedAnswer(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
