export type CameraUploadMode = "native" | "inPage";

function isMobileUserAgent(ua: string) {
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

function isWeChatOrQQ(ua: string) {
  return /micromessenger|qq\/|mqqbrowser|qqbrowser/i.test(ua);
}

function isSystemBrowser(ua: string) {
  const text = ua.toLowerCase();
  const isIosSafari =
    /(iphone|ipad|ipod)/.test(text) &&
    /safari/.test(text) &&
    !/(crios|fxios|edgios|opios|micromessenger|qq\/|mqqbrowser|qqbrowser)/.test(text);

  const isAndroidAosp =
    /android/.test(text) &&
    /version\/[\d.]+/.test(text) &&
    /mobile safari\/[\d.]+/.test(text) &&
    !/(chrome|chromium|crios|edg|opr|opera|firefox|fxios|micromessenger|qq\/|mqqbrowser|qqbrowser)/.test(text);

  return isIosSafari || isAndroidAosp;
}

function isChromeFamily(ua: string) {
  const text = ua.toLowerCase();
  if (isWeChatOrQQ(text)) return false;
  return /(chrome|chromium|crios|edg|edgios|opr|opera)/.test(text);
}

function supportsNativeCaptureInput() {
  if (typeof document === "undefined") return false;
  const input = document.createElement("input");
  input.type = "file";
  return "capture" in input;
}

function supportsInPageCamera() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function getPreferredCameraUploadMode(): CameraUploadMode {
  if (typeof navigator === "undefined") return "inPage";
  const ua = navigator.userAgent || "";
  const isMobile = isMobileUserAgent(ua);
  const wechatOrQQ = isWeChatOrQQ(ua);
  const systemBrowser = isSystemBrowser(ua);
  const chromeFamily = isChromeFamily(ua);
  const nativeCapable = supportsNativeCaptureInput();
  const inPageCapable = supportsInPageCamera();

  // 桌面端默认走页内相机；不支持时再退回原生文件选择器
  if (!isMobile) {
    if (inPageCapable) return "inPage";
    return nativeCapable ? "native" : "inPage";
  }

  // 你指定的规则：QQ/微信/系统浏览器优先原生相机
  if (wechatOrQQ || systemBrowser) {
    if (nativeCapable) return "native";
    return inPageCapable ? "inPage" : "native";
  }

  // 你指定的规则：Chrome 系优先页内相机
  if (chromeFamily) {
    if (inPageCapable) return "inPage";
    return nativeCapable ? "native" : "inPage";
  }

  // 其它移动浏览器默认优先原生
  if (nativeCapable) return "native";
  if (inPageCapable) return "inPage";

  return "native";
}

export function shouldUseNativeCameraUpload() {
  return getPreferredCameraUploadMode() === "native";
}
