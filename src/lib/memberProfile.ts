export type MemberProfile = { name: string; phone: string; location: string; about: string; avatarPath: string; experience: string };
export const emptyMemberProfile: MemberProfile = { name: "", phone: "", location: "", about: "", avatarPath: "", experience: "" };
export function validateMemberProfile(profile: MemberProfile): string | null {
  if (profile.name.trim().length < 2 || profile.name.trim().length > 100) return "Enter your name (2–100 characters).";
  const digits = profile.phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || !/^[+\d\s().-]+$/.test(profile.phone) || profile.phone.length > 40) return "Enter a valid phone number, including your country code.";
  if (profile.location.trim().length < 2 || profile.location.trim().length > 160) return "Enter your city, state or region, and country (up to 160 characters).";
  if (!profile.avatarPath) return "Upload a profile photo.";
  if (profile.about.trim().length < 10 || profile.about.trim().length > 500) return "Tell us a little about yourself (10–500 characters).";
  if (!["just_started", "under_two_years", "over_two_years"].includes(profile.experience)) return "Choose how long you have been cleaning turf.";
  return null;
}
export function validateProfilePhoto(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a JPG, PNG or WebP photo.";
  if (!file.size || file.size > 5 * 1024 * 1024) return "Choose a photo smaller than 5 MB.";
  return null;
}
export async function loadOwnMemberProfile(): Promise<{ required: boolean; profile: MemberProfile }> {
  const { supabase } = await import("./backend");
  if (!supabase) return { required: false, profile: { ...emptyMemberProfile } };
  const { data, error } = await supabase.rpc("get_my_signup_profile");
  if (error) throw new Error("Your profile could not load. Please retry.");
  return { required: Boolean(data.required), profile: { ...emptyMemberProfile, ...data.profile } };
}
export async function saveOwnMemberProfile(profile: MemberProfile, file: File | null, expectedUserId: string): Promise<void> {
  const { supabase } = await import("./backend");
  if (!supabase) throw new Error("Sign in before saving your profile.");
  const current = await supabase.auth.getUser();
  if (current.error || current.data.user?.id !== expectedUserId) throw new Error("Your account changed. Please sign in again.");
  const client = supabase;
  let uploaded: string | null = null;
  let submitted = false;
  try {
    if (file) {
      const invalid = validateProfilePhoto(file); if (invalid) throw new Error(invalid);
      // Decode and re-encode to remove EXIF/GPS metadata and reject invalid images.
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d"); if (!context) throw new Error("Photo processing is unavailable.");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Photo could not be processed.")), "image/jpeg", 0.85));
        uploaded = `${expectedUserId}/${crypto.randomUUID()}.jpg`;
        const { error } = await client.storage.from("member-avatars").upload(uploaded, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error("Photo upload failed. Please retry.");
        profile = { ...profile, avatarPath: uploaded };
      } finally { bitmap.close(); }
    }
    const invalid = validateMemberProfile(profile); if (invalid) throw new Error(invalid);
    const session = await client.auth.getUser();
    if (session.error || session.data.user?.id !== expectedUserId) throw new Error("Your account changed. Please sign in again.");
    submitted = true;
    const { error } = await client.rpc("save_my_signup_profile", { p_name: profile.name.trim(), p_phone: profile.phone.trim(), p_location: profile.location.trim(), p_about: profile.about.trim(), p_avatar_path: profile.avatarPath, p_experience: profile.experience });
    if (error) throw new Error("Your profile could not be saved. Please retry.");
  } catch (error) {
    // A lost response may follow a committed save; do not delete its photo.
    if (uploaded && !submitted) await client.storage.from("member-avatars").remove([uploaded]).catch(() => undefined);
    throw error;
  }
}
