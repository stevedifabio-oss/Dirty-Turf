const otherMobilePlatforms = /\b(?:android|arcore|google\s+play|play\s+store|galaxy\s+store|amazon\s+appstore|fire\s+os|windows\s+phone|blackberry)\b/i;

export function inspectApplePublicMetadata({ identity, apple }) {
  const fields = [
    ["app name", identity.name],
    ["subtitle", apple.subtitle],
    ["promotional text", apple.promotionalText],
    ["description", apple.description],
    ["keywords", apple.keywords],
  ];
  const failures = [];
  for (const [label, value] of fields) {
    const reference = value.match(otherMobilePlatforms)?.[0];
    if (reference) failures.push(`Apple ${label} references another mobile platform: ${reference}`);
  }
  return { failures };
}
