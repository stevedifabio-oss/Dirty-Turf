import { describe, expect, it } from "vitest";
import { lessonBodyForSave, lessonBodyText, quizEditorState, serializeQuizQuestion } from "../lib/adminContent";

describe("Admin Studio imported content editing", () => {
  it("preserves an untouched HTML lesson body exactly", () => {
    const body = { html: "<p>Imported <strong>lesson</strong></p>", providerData: { id: "ghl-1" } };
    const initial = lessonBodyText(body);

    expect(initial).toBe("Imported lesson");
    expect(lessonBodyForSave(body, initial, initial)).toEqual(body);
  });

  it("replaces imported HTML only after the administrator changes the text", () => {
    const body = { html: "<p>Original lesson</p>", providerData: { id: "ghl-2" } };
    const saved = lessonBodyForSave(body, lessonBodyText(body), "Updated lesson");

    expect(saved).toEqual({ text: "Updated lesson", providerData: { id: "ghl-2" } });
  });

  it("round-trips rich quiz prompts and options without flattening their HTML", () => {
    const prompt = { text: "What comes first?", html: "<p><strong>What</strong> comes first?</p>" };
    const wrong = { text: "Rinse", html: "<p>Rinse</p>" };
    const correct = { text: "Inspect", html: "<p><em>Inspect</em></p>" };
    const explanation = { text: "Inspect", html: "<p>Inspect</p>" };
    const body = { quiz: { passingPercent: 90, questions: [{ prompt, options: [wrong, correct], explanation, providerId: "quiz-1" }] } };

    const editor = quizEditorState(body);
    expect(editor.passingPercent).toBe(90);
    expect(editor.questions[0]?.correctOption).toBe(2);
    expect(serializeQuizQuestion(editor.questions[0]!)).toEqual({
      prompt,
      options: [wrong, correct],
      explanation,
      correctOptionIndex: 1,
      providerId: "quiz-1",
    });
  });
});
