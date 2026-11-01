import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ native: false, signUp: vi.fn(), reset: vi.fn(), getUser: vi.fn(), update: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mock.native } }));
vi.mock("./backend", () => ({ supabase: { auth: { signUp: mock.signUp, resetPasswordForEmail: mock.reset, getUser: mock.getUser, updateUser: mock.update } } }));
import { accountEmailRedirect, createPasswordAccount, newPasswordError, requestPasswordReset, saveRecoveredPassword } from "./passwordAccount";
beforeEach(() => {
  vi.clearAllMocks(); mock.native = false;
  vi.stubGlobal("window", { location: { href: "https://app.dirtyturf.com/?view=admin&redirect=https://other.test" } });
  mock.signUp.mockResolvedValue({ error: null }); mock.reset.mockResolvedValue({ error: null });
  mock.getUser.mockResolvedValue({ data: { user: { id: "account-a" } }, error: null }); mock.update.mockResolvedValue({ error: null });
});
describe("password account lifecycle", () => {
  it("validates password length and confirmation without sending weak passwords", async () => {
    expect(newPasswordError("short", "short")).not.toBeNull();
    expect(newPasswordError("a".repeat(129), "a".repeat(129))).not.toBeNull();
    expect(newPasswordError("a-long-password", "different-password")).not.toBeNull();
    await expect(createPasswordAccount("a@example.test", "short", "short")).rejects.toThrow();
    expect(mock.signUp).not.toHaveBeenCalled();
  });
  it("creates only an Auth login and normalizes the account email", async () => {
    await createPasswordAccount(" Alex@Example.test ", "a-long-password", "a-long-password");
    expect(mock.signUp).toHaveBeenCalledWith({ email: "alex@example.test", password: "a-long-password", options: { emailRedirectTo: "https://app.dirtyturf.com/" } });
  });
  it("uses the same origin for web recovery and the existing bridge for native", async () => {
    await requestPasswordReset(" Alex@Example.test ");
    expect(mock.reset).toHaveBeenCalledWith("alex@example.test", { redirectTo: "https://app.dirtyturf.com/?auth=recovery" });
    mock.native = true;
    expect(accountEmailRedirect("https://app.dirtyturf.com/", true)).toBe("https://app.dirtyturf.com/mobile-auth-callback.html");
  });
  it("refuses insecure web redirects", () => {
    expect(() => accountEmailRedirect("http://untrusted.test/", true)).toThrow();
    expect(accountEmailRedirect("http://127.0.0.1:5173/?plan=anything", true)).toBe("http://127.0.0.1:5173/?auth=recovery");
  });
  it("updates a password only after verifying the expected account", async () => {
    await saveRecoveredPassword("account-a", "new-long-password", "new-long-password");
    expect(mock.update).toHaveBeenCalledWith({ password: "new-long-password" });
    mock.update.mockClear();
    await expect(saveRecoveredPassword("account-b", "new-long-password", "new-long-password")).rejects.toThrow("changed or expired");
    expect(mock.update).not.toHaveBeenCalled();
    mock.getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    await expect(saveRecoveredPassword("account-a", "new-long-password", "new-long-password")).rejects.toThrow();
    expect(mock.update).not.toHaveBeenCalled();
  });
});
