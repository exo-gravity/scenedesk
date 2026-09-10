import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
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
    port: 4311,
    strictPort: true,
    proxy: {
      "/v1": "http://127.0.0.1:4310",
      "/health": "http://127.0.0.1:4310",
      "/design": "http://127.0.0.1:4310",
    },
  },
  preview: { host: "127.0.0.1", port: 4312, strictPort: true },
});
