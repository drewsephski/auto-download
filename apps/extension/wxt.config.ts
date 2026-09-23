import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
import { EXTENSION_PERMISSIONS } from "./lib/constants";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Download Automations",
    description: "Run a configured action when a browser download finishes.",
    permissions: [...EXTENSION_PERMISSIONS],
    icons: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    },
    action: {
      default_title: "Download Automations",
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
