import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath, encoding = "utf8") => fs.readFileSync(path.join(root, relativePath), encoding);
const metadata = JSON.parse(read("store/metadata.json"));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function checkLimit(label, value, maximum) {
  const length = Array.from(value).length;
  check(length > 0, `${label} is empty`);
  check(length <= maximum, `${label} is ${length} characters; maximum is ${maximum}`);
}

function checkProductionUrl(label, value, pathname) {
  try {
    const url = new URL(value);
    check(url.protocol === "https:", `${label} must use HTTPS`);
    check(url.hostname === "app.dirtyturf.com", `${label} must use app.dirtyturf.com`);
    check(url.pathname === pathname, `${label} must use ${pathname}`);
  } catch {
    failures.push(`${label} is not a valid URL`);
  }
}

function pngDetails(relativePath) {
  const buffer = read(relativePath, null);
  const signature = "89504e470d0a1a0a";
  check(buffer.subarray(0, 8).toString("hex") === signature, `${relativePath} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
    hasTransparencyChunk: buffer.includes(Buffer.from("tRNS")),
  };
}

const { identity, release, urls, apple, googlePlay, privacy } = metadata;
check(identity.name === "Dirty Turf Academy", "Store app name must be Dirty Turf Academy");
check(identity.bundleId === "com.dirtyturf.academy", "Bundle/package ID must be com.dirtyturf.academy");
check(identity.appleId === "6813588770", "App Store Connect Apple ID is missing or incorrect");
check(identity.googlePlayAppId === "4973615558687213779", "Google Play app ID is missing or incorrect");
check(identity.containsAds === false, "Store declaration must remain ad-free");
check(release.versionName === "1.0", "Release version must match the native projects");
check(release.versionCode === 1, "Android version code must match the native project");

checkLimit("Apple app name", identity.name, 30);
checkLimit("Apple subtitle", apple.subtitle, 30);
checkLimit("Apple promotional text", apple.promotionalText, 170);
checkLimit("Apple description", apple.description, 4000);
checkLimit("Apple keywords", apple.keywords, 100);
checkLimit("Apple reviewer notes", apple.reviewerNotes, 4000);
checkLimit("Google Play app name", identity.name, 30);
checkLimit("Google Play short description", googlePlay.shortDescription, 80);
checkLimit("Google Play full description", googlePlay.fullDescription, 4000);

const allCopy = JSON.stringify(metadata);
for (const unsafe of ["TODO", "TBD", "example.com", "{{", "re_xxxxxxxxx", "sk_test_", "sk_live_"]) {
  check(!allCopy.includes(unsafe), `Store metadata contains placeholder or secret-like text: ${unsafe}`);
}
check(!/https?:\/\//.test(apple.description), "Apple description must not contain an external purchase link");
check(!/https?:\/\//.test(googlePlay.fullDescription), "Google Play description must not contain an external purchase link");
for (const phrase of ["purchase on the web", "purchases and billing", "completed on the dirty turf website"]) {
  check(!apple.description.toLowerCase().includes(phrase), `Apple description contains purchase steering: ${phrase}`);
  check(!googlePlay.fullDescription.toLowerCase().includes(phrase), `Google Play description contains purchase steering: ${phrase}`);
}

checkProductionUrl("Privacy URL", urls.privacy, "/privacy.html");
checkProductionUrl("Support URL", urls.support, "/support.html");
checkProductionUrl("Account deletion URL", urls.accountDeletion, "/delete-account.html");
checkProductionUrl("Marketing URL", urls.marketing, "/");
check(googlePlay.contactEmail === "hello@dirtyturf.com", "Google Play contact email must use the Dirty Turf address");
check(privacy.tracking === false && privacy.advertising === false, "Privacy declarations must remain tracking- and ad-free");
check(privacy.accountDeletionAvailable === true, "Account deletion must remain declared and available");

const capacitor = read("capacitor.config.ts");
const androidGradle = read("android/app/build.gradle");
const androidManifest = read("android/app/src/main/AndroidManifest.xml");
const iosProject = read("ios/App/App.xcodeproj/project.pbxproj");
const iosInfo = read("ios/App/App/Info.plist");

check(capacitor.includes(`appId: "${identity.bundleId}"`), "Capacitor app ID does not match store metadata");
check(capacitor.includes(`appName: "${identity.name}"`), "Capacitor app name does not match store metadata");
check(androidGradle.includes(`applicationId "${identity.bundleId}"`), "Android application ID does not match store metadata");
check(androidGradle.includes(`versionCode ${release.versionCode}`), "Android version code does not match store metadata");
check(androidGradle.includes(`versionName "${release.versionName}"`), "Android version name does not match store metadata");
check(iosProject.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${identity.bundleId};`), "iOS bundle ID does not match store metadata");
check(iosProject.includes(`MARKETING_VERSION = ${release.versionName};`), "iOS marketing version does not match store metadata");
check(iosProject.includes("CURRENT_PROJECT_VERSION = 1;"), "iOS build number does not match store metadata");
check(iosInfo.includes(`<string>${identity.name}</string>`), "iOS display name does not match store metadata");
check(iosInfo.includes("NSCameraUsageDescription"), "iOS camera usage description is missing");
check(iosInfo.includes("NSLocationWhenInUseUsageDescription"), "iOS location usage description is missing");
check(
  iosInfo.includes("<key>ITSAppUsesNonExemptEncryption</key>") &&
    /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(iosInfo),
  "iOS exempt-encryption declaration is missing or incorrect",
);
check(iosInfo.includes(`<string>${identity.bundleId}</string>`), "iOS Magic Link URL scheme is missing");

for (const permission of [
  "android.permission.CAMERA",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
]) {
  check(androidManifest.includes(permission), `Android permission is missing: ${permission}`);
}
check(androidManifest.includes('android.hardware.camera" android:required="false"'), "Android camera capability must remain optional");
check(androidManifest.includes('android.hardware.camera.ar" android:required="false"'), "Android AR capability must remain optional");
check(androidManifest.includes('android:name="com.google.ar.core" android:value="optional"'), "ARCore must remain optional");
check(androidManifest.includes(`android:scheme="${identity.bundleId}"`), "Android Magic Link URL scheme is missing");
check(androidManifest.includes('android:host="auth"'), "Android Magic Link host is missing");
check(androidManifest.includes('android:path="/callback"'), "Android Magic Link callback path is missing");

for (const [relativePath, title] of [
  ["public/privacy.html", "Privacy Policy"],
  ["public/support.html", "Support"],
  ["public/delete-account.html", "Delete Account"],
]) {
  const page = read(relativePath);
  check(page.includes(title), `${relativePath} is missing its expected title`);
  check(page.includes("hello@dirtyturf.com"), `${relativePath} is missing the support address`);
}

const icon = pngDetails("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
check(icon.width === 1024 && icon.height === 1024, "iOS App Store icon must be 1024 x 1024");
check(![4, 6].includes(icon.colorType) && !icon.hasTransparencyChunk, "iOS App Store icon must not contain transparency");

if (failures.length > 0) {
  console.error(`Store metadata check failed with ${failures.length} issue${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Store metadata check passed");
console.log(`- Apple subtitle: ${Array.from(apple.subtitle).length}/30 characters`);
console.log(`- Google short description: ${Array.from(googlePlay.shortDescription).length}/80 characters`);
console.log(`- Apple keywords: ${Array.from(apple.keywords).length}/100 characters`);
console.log("- Bundle identity, native permissions, legal routes, and 1024px opaque icon match the release record");
