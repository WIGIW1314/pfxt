import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import ElementPlus from "unplugin-element-plus/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

export default defineConfig({
  plugins: [
    vue(),
    Components({
      dts: false,
      resolvers: [
        ElementPlusResolver({
          importStyle: "css",
        }),
      ],
    }),
    ElementPlus({}),
  ],
  optimizeDeps: {
    include: [
      "dayjs",
      "dayjs/plugin/customParseFormat",
      "dayjs/plugin/weekday",
      "dayjs/plugin/localeData",
      "dayjs/plugin/weekOfYear",
      "dayjs/plugin/weekYear",
      "dayjs/plugin/advancedFormat",
      "dayjs/plugin/quarterOfYear",
      "axios",
    ],
  },
  esbuild: {
    drop: ["console", "debugger"],
  },
  build: {
    cssMinify: "esbuild",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("@tiptap") || id.includes("prosemirror")) {
            return "tiptap";
          }

          if (id.includes("docx-preview")) {
            return "docx-preview";
          }

          if (id.includes("element-plus")) {
            return "element-plus";
          }

          if (
            id.includes("vue-router")
            || id.includes("pinia")
            || id.includes("/vue/")
            || id.includes("\\vue\\")
          ) {
            return "vue-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["test.hist.top"],
    proxy: {
      "/api": "http://127.0.0.1:3100",
      "/ws": {
        target: "ws://127.0.0.1:3100",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", () => {});
          proxy.on("proxyReqWs", (_proxyReq, _req, socket) => {
            socket.on("error", () => {});
          });
        },
      },
    },
  },
});
