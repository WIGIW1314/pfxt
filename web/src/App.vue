<script setup lang="ts">
import { watch, onMounted, onUnmounted } from "vue";
import { useSyncStore } from "./stores/sync";
import { useNetworkStore } from "./stores/network";
import OfflineBanner from "./components/OfflineBanner.vue";

const sync = useSyncStore();
const network = useNetworkStore();

onMounted(async () => {
  sync.fetchSiteTitle();
  network.init();

  // Register service worker
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      reg.addEventListener("updatefound", () => {
        console.log("[SW] New version available");
      });
    } catch (e) {
      console.warn("[SW] Registration failed:", e);
    }

    // Listen for SW messages (e.g., sync-drafts)
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SYNC_DRAFTS") {
        // Trigger draft sync in draft store if needed
        document.dispatchEvent(new CustomEvent("sw-sync-drafts"));
      }
    });
  }

  // Initialize performance monitoring
  const { usePerformance } = await import("./composables/usePerformance");
  const perf = usePerformance();
  void perf; // Composable auto-initializes and reports
});

onUnmounted(() => {
  network.destroy();
});

watch(
  () => sync.siteTitle,
  (title) => {
    document.title = title;
  },
  { immediate: true },
);
</script>

<template>
  <!-- Skip to main content — keyboard accessibility -->
  <a href="#app-main" class="skip-link">跳转到主要内容</a>

  <OfflineBanner />
  <main id="app-main" tabindex="-1">
    <router-view />
  </main>
  <!-- Global aria-live region for screen reader announcements -->
  <div aria-live="polite" aria-atomic="true" class="sr-only" />
</template>

<style>
/* Screen-reader only utility class */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Skip to content link — visible only on focus */
.skip-link {
  position: absolute;
  top: -100%;
  left: 16px;
  z-index: 10000;
  padding: 8px 16px;
  background: var(--primary, #409eff);
  color: #fff;
  font-weight: 600;
  border-radius: 0 0 6px 6px;
  text-decoration: none;
  transition: top 0.2s;
}

.skip-link:focus {
  top: 0;
  outline: none;
}

/* Ensure main content area is focusable for skip link */
#app-main:focus {
  outline: none;
}
</style>
