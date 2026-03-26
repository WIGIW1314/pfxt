import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { ElConfigProvider } from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

createApp({
  render() {
    return h(
      ElConfigProvider,
      { locale: zhCn },
      {
        default: () => h(App),
      },
    );
  },
})
  .use(createPinia())
  .use(router)
  .mount("#app");
