export function normalizeLoginEmail(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

export function memberMagicLinkOptions(redirectTo: string) {
  return {
    emailRedirectTo: redirectTo,
    shouldCreateUser: false,
  } as const;
}
