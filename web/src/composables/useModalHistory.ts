import { onMounted, onUnmounted, watch, type WatchSource } from "vue";

export function useModalHistory(
  visible: WatchSource<boolean>,
  requestClose: () => boolean | Promise<boolean>,
  key = "modal",
) {
  let pushed = false;
  let syncing = false;

  function pushEntry() {
    if (typeof window === "undefined") return;
    window.history.pushState(
      {
        ...(window.history.state ?? {}),
        __modalHistory: key,
      },
      "",
      window.location.href,
    );
    pushed = true;
  }

  function finishSyncSoon() {
    window.setTimeout(() => {
      syncing = false;
    }, 0);
  }

  async function handlePopState() {
    if (syncing) {
      syncing = false;
      return;
    }

    if (!pushed) return;

    const closed = await requestClose();
    if (closed === false) {
      pushEntry();
      return;
    }

    pushed = false;
    syncing = true;
    finishSyncSoon();
  }

  watch(visible, (open) => {
    if (typeof window === "undefined") return;

    if (open && !pushed) {
      pushEntry();
      return;
    }

    if (!open && pushed && !syncing) {
      pushed = false;
      syncing = true;
      window.history.back();
      finishSyncSoon();
    }
  });

  onMounted(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", handlePopState);
    }
  });

  onUnmounted(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", handlePopState);
    }
  });
}
