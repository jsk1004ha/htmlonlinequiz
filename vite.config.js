import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ["logingwak.xyz"],
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
  preview: {
    allowedHosts: ["logingwak.xyz"],
  },
});
