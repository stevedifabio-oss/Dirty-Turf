import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dirtyturf.academy",
  appName: "Dirty Turf Academy",
  webDir: "dist",
  backgroundColor: "#f4faee",
  appendUserAgent: "DirtyTurfAcademy/1.0 (+https://app.dirtyturf.com; contact: hello@dirtyturf.com)",
  ios: {
    contentInset: "always",
    preferredContentMode: "mobile",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
