import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
import { AccountEntry, PasswordResetForm } from "./AccountEntry";
it("defaults to email and password with create account and recovery controls", () => {
  const html = renderToStaticMarkup(<AccountEntry onPasswordSignIn={async () => undefined} onRequestMagicLink={async () => undefined} onConsentChange={() => undefined} />);
  expect(html).toContain('type="email"'); expect(html).toContain('autoComplete="username"'); expect(html).toContain('autoComplete="current-password"');
  expect(html).toContain("Forgot password?"); expect(html).toContain("Create an account");
  expect(html).not.toContain("How long have you been cleaning turf?");
});
it("uses new-password autofill and confirmation for recovery", () => {
  const html = renderToStaticMarkup(<PasswordResetForm userId="a" onComplete={() => undefined} onSignOut={() => undefined} />);
  expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
  expect(html).toContain("Confirm new password"); expect(html).toContain("Cancel and sign out");
});
