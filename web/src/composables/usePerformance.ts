/**
 * usePerformance — lightweight self-hosted Core Web Vitals monitoring.
 * Reports LCP, FID/INP, CLS to the server via beacon API.
 * No external services required.
 */

import { onMounted, onUnmounted, ref } from "vue";

interface VitalMetrics {
  lcp: number | null;
  fid: number | null;
  cls: number | null;
  ttfb: number | null;
  fcp: number | null;
  url: string;
  userAgent: string;
  timestamp: number;
}

let reported = false;

function getRating(name: "lcp" | "cls" | "ttfb" | "fcp", value: number): "good" | "needs-improvement" | "poor" {
  const thresholds: Record<string, [good: number, poor: number]> = {
    lcp: [2500, 4000],
    cls: [0.1, 0.25],
    ttfb: [800, 1800],
    fcp: [1800, 3000],
  };
  const [good, poor] = thresholds[name] ?? [Infinity, Infinity];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

export function usePerformance() {
  const metrics = ref<VitalMetrics>({
    lcp: null,
    fid: null,
    cls: null,
    ttfb: null,
    fcp: null,
    url: "",
    userAgent: "",
    timestamp: Date.now(),
  });

  const isSlowConnection = ref(false);

  function reportMetrics(data: VitalMetrics) {
    if (reported) return;
    reported = true;

    const payload = {
      ...data,
      ratings: {
        lcp: data.lcp != null ? getRating("lcp", data.lcp) : null,
        fid: data.fid != null ? getRating("ttfb", data.fid) : null, // map fid to ttfb thresholds
        cls: data.cls != null ? getRating("cls", data.cls) : null,
        ttfb: data.ttfb != null ? getRating("ttfb", data.ttfb) : null,
        fcp: data.fcp != null ? getRating("fcp", data.fcp) : null,
      },
    };

    // Use beacon API so it fires even on page unload
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/metrics/web-vitals", blob);
    } else {
      fetch("/api/metrics/web-vitals", {
        method: "POST",
        body: JSON.stringify(payload),
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    }
  }

  function observeLCP() {
    if (!("PerformanceObserver" in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        // Last entry is the final LCP
        const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
        if (last && last.startTime > 0) {
          metrics.value.lcp = Math.round(last.startTime);
        }
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      return observer;
    } catch {
      return null;
    }
  }

  function observeCLS() {
    if (!("PerformanceObserver" in window)) return null;
    let clsValue = 0;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!(e as any).hadRecentInput) {
            clsValue += e.value;
          }
        }
        metrics.value.cls = Math.round(clsValue * 1000) / 1000;
      });
      observer.observe({ type: "layout-shift", buffered: true });
      return observer;
    } catch {
      return null;
    }
  }

  function observeFID() {
    if (!("PerformanceObserver" in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        const first = list.getEntries()[0] as PerformanceEventTiming;
        if (first && first.processingStart !== undefined) {
          const fid = first.processingStart - first.startTime;
          metrics.value.fid = Math.round(fid);
        }
      });
      observer.observe({ type: "first-input", buffered: true });
      return observer;
    } catch {
      return null;
    }
  }

  function observePaintTimings() {
    if (!("PerformanceObserver" in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            metrics.value.fcp = Math.round(entry.startTime);
          }
          if (entry.name === "first-paint") {
            // first paint observed
          }
        }
      });
      observer.observe({ type: "paint", buffered: true });
      return observer;
    } catch {
      return null;
    }
  }

  function measureTTFB() {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      metrics.value.ttfb = Math.round(nav.responseStart);
    }
  }

  function collectAndReport() {
    metrics.value.url = window.location.href;
    metrics.value.userAgent = navigator.userAgent;
    metrics.value.timestamp = Date.now();

    // Wait a bit for LCP/CLS to settle (they can update after page load)
    setTimeout(() => {
      // Fill in any nulls from PerformanceObserver limitations
      if (!metrics.value.ttfb) measureTTFB();

      reportMetrics(metrics.value);
    }, 3000);
  }

  const observers: NonNullable<ReturnType<typeof observeLCP>>[] = [];

  onMounted(() => {
    // Detect slow connections
    const conn = (navigator as any).connection;
    if (conn) {
      isSlowConnection.value = conn.effectiveType === "2g" || conn.effectiveType === "slow-2g";
    }

    const lcpObs = observeLCP();
    if (lcpObs) observers.push(lcpObs);
    const clsObs = observeCLS();
    if (clsObs) observers.push(clsObs);
    const fidObs = observeFID();
    if (fidObs) observers.push(fidObs);
    const paintObs = observePaintTimings();
    if (paintObs) observers.push(paintObs);
    measureTTFB();

    // Report when user leaves
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        collectAndReport();
      }
    });

    // Also report on unload as fallback
    window.addEventListener("beforeunload", collectAndReport);

    // Initial report after load
    setTimeout(collectAndReport, 5000);
  });

  onUnmounted(() => {
    observers.forEach((obs) => obs?.disconnect());
  });

  return { metrics, isSlowConnection, reportMetrics: collectAndReport };
}
