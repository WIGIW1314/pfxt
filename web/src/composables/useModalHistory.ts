import { onMounted, onUnmounted, watch, type WatchSource } from "vue";

export function useModalHistory(
  visible: WatchSource<boolean>,
  requestClose: () => boolean | Promise<boolean>,
  key = "modal",
) {
  let pushed = false;
  let closingFromPopstate = false;
  let ignoreNextPopstate = false;

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

  async function handlePopState() {
    if (ignoreNextPopstate) {
      ignoreNextPopstate = false;
      return;
    }

    if (!pushed) return;

    closingFromPopstate = true;
    const closed = await requestClose();
    if (closed === false) {
      closingFromPopstate = false;
      pushEntry();
      return;
    }

    pushed = false;
    closingFromPopstate = false;
  }

  watch(visible, (open) => {
    if (typeof window === "undefined") return;

    if (open && !pushed) {
      pushEntry();
      return;
    }

    if (!open && pushed) {
      if (closingFromPopstate) {
        pushed = false;
        closingFromPopstate = false;
        return;
      }

      pushed = false;
      ignoreNextPopstate = true;
      window.history.back();
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
