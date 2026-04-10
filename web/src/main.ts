import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

const app = createApp({
  render() {
    return h(
      ElConfigProvider,
      { locale: zhCn },
      {
        default: () => h(App),
      },
    );
  },
});

// Global error handler — prevents white screen from uncaught JS errors
app.config.errorHandler = (err, _instance, info) => {
  // Distinguish recoverable vs fatal errors
  // Transition/nextTick errors are usually noise (component not mounted)
  const isNoise = info?.includes("nextTick") || info?.includes("transition") ||
    (info?.includes("mounted") || info?.includes("unmounted"));

  if (isNoise) return;

  // Log full error for debugging
  console.error("[Vue Error]", info, err);
};

// Global warning handler — log Vue dev warnings in dev mode
app.config.warnHandler = (msg, _instance, trace) => {
  // Ignore known benign warnings
  if (msg.includes("extraneous non-prop attrs")) return;
  if (msg.includes("missing required prop")) return;
  console.warn(`[Vue Warning] ${msg}`, trace || "");
};

app.use(createPinia()).use(router).mount("#app");
