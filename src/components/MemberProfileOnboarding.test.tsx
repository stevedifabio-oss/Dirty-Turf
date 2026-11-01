import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../lib/backend", () => ({ supabase: null }));
import { MemberProfileForm, MemberProfileBoundary } from "./MemberProfileOnboarding";
it("collects required member details and explains phone privacy", () => {
  const html = renderToStaticMarkup(<MemberProfileForm onSave={async () => undefined} />);
  for (const text of ["Full name", "Phone number", "Where are you located?", "A little about you", "Profile photo", "How long have you been cleaning turf?", "Just started", "Under 2 years", "Over 2 years", "not shown to other members"]) expect(html).toContain(text);
  expect(html).toContain('type="file"'); expect(html).toContain('maxLength="500"');
  expect(html.match(/required=""/g)).toHaveLength(6);
});
it("keeps public sign-in available without a signed-in account", () => {
  expect(renderToStaticMarkup(<MemberProfileBoundary userId={null} onSignOut={() => undefined}><p>Member sign in</p></MemberProfileBoundary>)).toBe("<p>Member sign in</p>");
});
