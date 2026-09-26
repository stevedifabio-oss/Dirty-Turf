export function assertAuthPluginRegistered(contents, platform, label) {
  const registry = JSON.parse(contents);
  const registered = platform === "android"
    ? Array.isArray(registry) && registry.some((plugin) =>
      plugin.pkg === "@capacitor/app" && plugin.classpath === "com.capacitorjs.plugins.app.AppPlugin")
    : Array.isArray(registry.packageClassList) && registry.packageClassList.includes("AppPlugin");
  if (!registered) throw new Error(`${label}: native App plugin is missing. Run npm run native:sync before building.`);
}
