import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({native:vi.fn(()=>false),otp:vi.fn()}));
vi.mock("@capacitor/core",()=>({Capacitor:{isNativePlatform:mocks.native}}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({auth:{signInWithOtp:mocks.otp}})}));
let requestMagicLink:typeof import("./backend").requestMagicLink;
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();mocks.native.mockReturnValue(false);mocks.otp.mockResolvedValue({error:null});
 vi.stubGlobal("window",{location:{origin:"https://app.dirtyturf.com",href:"https://app.dirtyturf.com/?view=community&post=post-123&comment=reply-456&access_token=private#refresh_token=private"}});
 vi.stubEnv("VITE_SUPABASE_URL","https://example.supabase.co");vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY","test-public-key");
 ({requestMagicLink}=await import("./backend"));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("magic-link request destination integration",()=>{
 it("preserves the exact web discussion while stripping unrelated credentials",async()=>{
  await requestMagicLink("  MEMBER@EXAMPLE.INVALID ");
  expect(mocks.otp).toHaveBeenCalledWith({email:"member@example.invalid",options:{emailRedirectTo:"https://app.dirtyturf.com/?view=community&post=post-123&comment=reply-456",shouldCreateUser:false}});
 });
 it("keeps the verified native callback unchanged",async()=>{
  mocks.native.mockReturnValue(true);await requestMagicLink("member@example.invalid");
  expect(mocks.otp).toHaveBeenCalledWith({email:"member@example.invalid",options:{emailRedirectTo:"https://app.dirtyturf.com/mobile-auth-callback.html",shouldCreateUser:false}});
 });
});
