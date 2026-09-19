import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Ports are configurable so that a second checkout (for example a git
// worktree used by a parallel task) can run beside this one; defaults keep
// the documented local addresses unchanged.
const apiPort = Number(process.env.SCENEDESK_API_PORT ?? 4310);
const webPort = Number(process.env.SCENEDESK_WEB_PORT ?? 4311);
const previewPort = Number(process.env.SCENEDESK_PREVIEW_PORT ?? 4312);

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "media-chrome/react",
      "media-chrome/dist/lang/zh-CN.js",
      "media-chrome/dist/utils/i18n.js",
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id))
            return "react-runtime";
          if (id.includes("/node_modules/@mantine/")) return "mantine-ui";
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/v1": `http://127.0.0.1:${apiPort}`,
      "/health": `http://127.0.0.1:${apiPort}`,
      "/design": `http://127.0.0.1:${apiPort}`,
    },
  },
  preview: { host: "127.0.0.1", port: previewPort, strictPort: true },
});
