import axios from "axios";

/** 根据当前页面地址自动推导 API 基础地址，也可通过 VITE_API_URL 环境变量覆盖 */
export const API_BASE =
  import.meta.env.VITE_API_URL || window.location.origin;

export const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("score-system-token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function parseFilenameFromDisposition(disposition?: string) {
  if (!disposition) return "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = disposition.match(/filename="?([^"]+)"?/i);
  return asciiMatch?.[1] || "";
}

export type DownloadFileProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export async function downloadFile(
  url: string,
  fallbackName: string,
  options?: {
    onProgress?: (progress: DownloadFileProgress) => void;
  },
) {
  const response = await api.get(url, {
    responseType: "blob",
    onDownloadProgress: (event) => {
      const total = typeof event.total === "number" && event.total > 0 ? event.total : null;
      options?.onProgress?.({
        loaded: event.loaded,
        total,
        percent: total ? Math.round((event.loaded / total) * 100) : null,
      });
    },
  });
  options?.onProgress?.({
    loaded: response.data.size || 0,
    total: response.data.size || null,
    percent: 100,
  });
  const href = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = href;
  link.download = parseFilenameFromDisposition(response.headers["content-disposition"]) || fallbackName;
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(href);
  }, 1000);
}
