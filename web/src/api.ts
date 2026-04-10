import axios from "axios";
import { ElMessage } from "element-plus";

/** 根据当前页面地址自动推导 API 基础地址，也可通过 VITE_API_URL 环境变量覆盖 */
export const API_BASE =
  import.meta.env.VITE_API_URL || window.location.origin;

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Send httpOnly cookies with every request
});

// --- Global error handling: show friendly message on API failures ---
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Skip if the caller opted out of global error toast
    if (error.config?._skipGlobalError) {
      return Promise.reject(error);
    }

    if (!error.response) {
      // Network error (no response from server)
      if (!navigator.onLine) {
        ElMessage.warning("网络已断开，请检查网络连接");
      } else {
        ElMessage.error("无法连接到服务器，请稍后重试");
      }
    } else {
      const status = error.response.status;
      const data = error.response.data;
      const msg = data?.message || data?.error || "";

      if (status === 401) {
        // Auth errors are handled by router guard — suppress toast
      } else if (status === 423) {
        ElMessage.warning(msg || "资源已锁定");
      } else if (status === 429) {
        ElMessage.warning("操作过于频繁，请稍后再试");
      } else if (status >= 500) {
        ElMessage.error(msg || "服务器内部错误，请稍后重试");
      } else if (status >= 400 && status !== 401) {
        ElMessage.warning(msg || "请求失败");
      }
    }

    return Promise.reject(error);
  },
);

// --- Response cache for GET requests ---
const responseCache = new Map<string, { data: any; ts: number }>();

/** 删除指定 URL 的缓存条目（用于活动切换等场景强制刷新） */
export function invalidateCache(url: string) {
  responseCache.delete(url);
}

/**
 * Cached GET request. Returns cached data if within TTL, otherwise fetches fresh data.
 * Use for data that changes infrequently (e.g., templates, site config).
 */
export async function cachedGet<T = any>(url: string, ttl = 30_000): Promise<T> {
  const cacheKey = url;
  const hit = responseCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < ttl) {
    return hit.data as T;
  }
  const res = await api.get<T>(url);
  responseCache.set(cacheKey, { data: res.data, ts: Date.now() });
  return res.data;
}

/**
 * Retry a request up to `retries` times with exponential backoff.
 * Useful for flaky network conditions (mobile, weak signal).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  baseDelay = 1000,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

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

// --- QR Code image upload ---
export type QrcodeUploadResult = {
  thumb: string;
  medium: string;
  original: string;
  meta: {
    thumb: { url: string; width: number | null; height: number | null };
    medium: { url: string; width: number | null; height: number | null };
    original: { url: string; width: number | null; height: number | null };
  };
};

/**
 * Upload a QR code image. The server will convert it to WebP and generate
 * thumb + medium variants. Returns all variant URLs.
 */
export async function uploadQrcode(file: File): Promise<QrcodeUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post<QrcodeUploadResult>("/api/admin/groups/qrcode-upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

function canvasToWebpBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("图片压缩失败"));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality,
    );
  });
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取图片，请重新选择"));
    };
    image.src = objectUrl;
  });
}

function getWebpName(fileName: string) {
  const safeName = String(fileName || "artwork").trim() || "artwork";
  const noExt = safeName.replace(/\.[^.]+$/, "");
  return `${noExt}.webp`;
}

export async function compressImageToWebp(
  file: File,
  options?: {
    targetMaxBytes?: number;
    maxDimension?: number;
    minQuality?: number;
  },
) {
  const targetMaxBytes = options?.targetMaxBytes ?? 200 * 1024;
  const maxDimension = options?.maxDimension ?? 1920;
  const minQuality = options?.minQuality ?? 0.35;

  const image = await loadImageElement(file);
  const maxOriginalSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const initialScale = maxOriginalSide > maxDimension ? (maxDimension / maxOriginalSide) : 1;
  const baseWidth = Math.max(1, Math.round((image.naturalWidth || image.width) * initialScale));
  const baseHeight = Math.max(1, Math.round((image.naturalHeight || image.height) * initialScale));
  const scaleSteps = [1, 0.9, 0.8, 0.7, 0.6];
  const qualitySteps = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46, minQuality].filter((v, idx, arr) => v > 0 && arr.indexOf(v) === idx);

  let bestBlob: Blob | null = null;
  for (const scale of scaleSteps) {
    const width = Math.max(1, Math.round(baseWidth * scale));
    const height = Math.max(1, Math.round(baseHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器不支持图片压缩");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    for (const quality of qualitySteps) {
      const blob = await canvasToWebpBlob(canvas, quality);
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }
      if (blob.size <= targetMaxBytes) {
        bestBlob = blob;
        break;
      }
    }
    if (bestBlob && bestBlob.size <= targetMaxBytes) {
      break;
    }
  }

  if (!bestBlob) {
    throw new Error("图片压缩失败");
  }

  return new File([bestBlob], getWebpName(file.name), { type: "image/webp" });
}
