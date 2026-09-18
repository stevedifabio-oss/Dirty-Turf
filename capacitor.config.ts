import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dirtyturf.academy",
  appName: "Dirty Turf Academy",
  webDir: "dist",
  backgroundColor: "#f4faee",
  ios: {
    contentInset: "always",
    preferredContentMode: "mobile",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
