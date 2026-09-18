import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const androidRoot = resolve(root, "android");
const apkPath = resolve(androidRoot, "app/build/outputs/apk/debug/app-debug.apk");
const packageName = "com.dirtyturf.academy";
const adbPath = findAdb();

const devices = parseDevices(
  execFileSync(adbPath, ["devices", "-l"], { encoding: "utf8" }),
);
const requestedSerial = process.env.ANDROID_SERIAL;
const selected = requestedSerial
  ? devices.find(({ serial }) => serial === requestedSerial)
  : devices.length === 1
    ? devices[0]
    : undefined;

if (!selected) {
  if (devices.length === 0) {
    fail([
      "No Android device is connected.",
      "1. On the Galaxy, enable Developer options by tapping Build number seven times.",
      "2. Turn on USB debugging in Developer options.",
      "3. Connect a data-capable USB cable and approve this computer on the phone.",
      "4. Run npm run native:android:install-device again.",
    ]);
  }

  fail([
    "More than one Android device is connected.",
    "Set ANDROID_SERIAL to the target shown below, then run the command again:",
    ...devices.map(({ serial, description }) => `- ${serial} ${description}`),
  ]);
}

if (selected.state !== "device") {
  fail([
    `Android device ${selected.serial} is ${selected.state}.`,
    selected.state === "unauthorized"
      ? "Unlock the Galaxy and approve the USB debugging prompt, then run the command again."
      : "Reconnect the Galaxy and confirm USB debugging is enabled, then run the command again.",
  ]);
}

if (!existsSync(apkPath)) {
  console.log("Building the Dirty Turf debug APK...");
  execFileSync("./gradlew", [":app:assembleDebug"], {
    cwd: androidRoot,
    stdio: "inherit",
  });
}

console.log(`Installing Dirty Turf on ${selected.serial}...`);
execFileSync(adbPath, ["-s", selected.serial, "install", "-r", "-t", apkPath], {
  stdio: "inherit",
});

console.log("Launching Dirty Turf Academy...");
execFileSync(
  adbPath,
  [
    "-s",
    selected.serial,
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ],
  { stdio: "inherit" },
);

console.log("Dirty Turf Academy is installed and launched on the Galaxy.");

function findAdb() {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    resolve(homedir(), "Library/Android/sdk"),
    resolve(homedir(), "Android/Sdk"),
  ].filter(Boolean);

  for (const sdkRoot of sdkRoots) {
    const candidate = resolve(sdkRoot, "platform-tools/adb");
    if (existsSync(candidate)) return candidate;
  }

  fail([
    "Android Debug Bridge was not found.",
    "Install Android SDK Platform-Tools in Android Studio, then run this command again.",
  ]);
}

function parseDevices(output) {
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/);
      return { serial, state, description: details.join(" ") };
    });
}

function fail(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}
