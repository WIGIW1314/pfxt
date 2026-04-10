import { ref } from "vue";
import { defineStore } from "pinia";

export const useNetworkStore = defineStore("network", () => {
  const isOnline = ref(navigator.onLine);
  const showOfflineBanner = ref(false);
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;

  function onOnline() {
    isOnline.value = true;
    showOfflineBanner.value = false;
  }

  function onOffline() {
    isOnline.value = false;
    if (bannerTimer) clearTimeout(bannerTimer);
    // Delay so the banner doesn't flash on quick reconnects
    bannerTimer = setTimeout(() => {
      showOfflineBanner.value = true;
    }, 500);
  }

  function init() {
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
  }

  function destroy() {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    if (bannerTimer) clearTimeout(bannerTimer);
  }

  return { isOnline, showOfflineBanner, init, destroy };
});
