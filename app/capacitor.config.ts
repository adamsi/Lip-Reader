import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.chaplin.app",
  appName: "Chaplin AI",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
