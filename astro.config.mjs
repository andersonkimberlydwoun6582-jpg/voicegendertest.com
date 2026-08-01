import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://voicegendertest.com",
  output: "static",
  trailingSlash: "always",
  integrations: [react()],
});
