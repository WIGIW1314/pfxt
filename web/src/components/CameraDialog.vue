<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

const props = defineProps<{
  modelValue: boolean;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", val: boolean): void;
  (e: "capture", blob: Blob): void;
}>();

const videoRef = ref<HTMLVideoElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const cameraState = ref<"idle" | "starting" | "active" | "error">("idle");
const errorMsg = ref("");
const switching = ref(false);
const uploading = ref(false);
const flashing = ref(false);
type CameraMode = "1x" | "wide" | "front";
const activeMode = ref<CameraMode>("1x");
const wideKnownUnavailable = ref(false);
const cameraDeviceMap = ref<Partial<Record<CameraMode, string>>>({});

const lensOptions: Array<{ key: CameraMode; label: string }> = [
  { key: "1x", label: "1x" },
  { key: "wide", label: "广角" },
  { key: "front", label: "前置" },
];

const wideDisabled = computed(() => wideKnownUnavailable.value);
let stream: MediaStream | null = null;
let facingMode: "environment" | "user" = "environment";

type QualityProfile = "ultra" | "high" | "mid" | "base";

function buildVideoConstraints(mode: "environment" | "user", profile: QualityProfile = "high"): MediaTrackConstraints {
  if (profile === "ultra") {
    return {
      facingMode: { ideal: mode },
      width: { min: 1920, ideal: 2560 },
      height: { min: 1080, ideal: 1440 },
      frameRate: { ideal: 30, max: 60 },
    };
  }
  if (profile === "high") {
    return {
      facingMode: { ideal: mode },
      width: { min: 1280, ideal: 1920 },
      height: { min: 720, ideal: 1080 },
      frameRate: { ideal: 30, max: 60 },
    };
  }
  if (profile === "mid") {
    return {
      facingMode: { ideal: mode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24, max: 30 },
    };
  }
  return {
    facingMode: { ideal: mode },
    frameRate: { ideal: 24, max: 30 },
  };
}

async function requestStreamWithFallback(mode: "environment" | "user"): Promise<MediaStream> {
  const profiles: QualityProfile[] = ["ultra", "high", "mid", "base"];
  let lastErr: unknown = null;
  for (const profile of profiles) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(mode, profile),
        audio: false,
      });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("相机启动失败");
}

function scoreRearMainLabel(label: string): number {
  const text = label.toLowerCase();
  let score = 0;
  if (/(back|rear|environment|后置|后摄|主摄)/.test(text)) score += 50;
  if (/(main|1x|standard|标准)/.test(text)) score += 30;
  if (/(ultra|wide|广角|0\.5x|0\.6x)/.test(text)) score -= 40;
  if (/(tele|zoom|长焦|2x|3x|5x)/.test(text)) score -= 60;
  if (/(front|user|前置|前摄)/.test(text)) score -= 100;
  return score;
}

function scoreRearWideLabel(label: string): number {
  const text = label.toLowerCase();
  let score = 0;
  if (/(back|rear|environment|后置|后摄)/.test(text)) score += 40;
  if (/(ultra|wide|广角|0\.5x|0\.6x)/.test(text)) score += 60;
  if (/(tele|zoom|长焦|2x|3x|5x)/.test(text)) score -= 90;
  if (/(front|user|前置|前摄)/.test(text)) score -= 100;
  return score;
}

function scoreFrontLabel(label: string): number {
  const text = label.toLowerCase();
  let score = 0;
  if (/(front|user|前置|前摄)/.test(text)) score += 80;
  if (/(back|rear|environment|后置|后摄)/.test(text)) score -= 100;
  return score;
}

function updateCameraMapFromDevices(devices: MediaDeviceInfo[]) {
  const cameras = devices.filter((d) => d.kind === "videoinput");
  if (!cameras.length) return;

  const pickBest = (scorer: (label: string) => number, minScore = -9999) =>
    [...cameras]
      .map((d) => ({ d, score: scorer(d.label || "") }))
      .sort((a, b) => b.score - a.score)
      .find((item) => item.score > minScore)?.d;

  const rearMain = pickBest(scoreRearMainLabel);
  const rearWide = pickBest(scoreRearWideLabel, 10);
  const front = pickBest(scoreFrontLabel);
  const hasLabeledRear = cameras.some((d) => /(back|rear|environment|后置|后摄)/.test((d.label || "").toLowerCase()));

  cameraDeviceMap.value = {
    "1x": rearMain?.deviceId || cameraDeviceMap.value["1x"],
    wide: rearWide?.deviceId || undefined,
    front: front?.deviceId || cameraDeviceMap.value.front,
  };
  wideKnownUnavailable.value = hasLabeledRear && !rearWide?.deviceId;
}

async function openCameraByMode(mode: CameraMode): Promise<MediaStream> {
  const requestedFacing: "environment" | "user" = mode === "front" ? "user" : "environment";
  const initial = await requestStreamWithFallback(requestedFacing);

  const devices = await navigator.mediaDevices.enumerateDevices();
  updateCameraMapFromDevices(devices);

  // 1x 优先使用系统默认后置主摄，避免误切到长焦导致“2x”观感
  if (mode === "1x") {
    return initial;
  }

  const targetDeviceId = cameraDeviceMap.value[mode];
  if (!targetDeviceId) {
    return initial;
  }

  const currentTrack = initial.getVideoTracks()[0];
  const currentDeviceId = (currentTrack?.getSettings?.().deviceId as string | undefined) || "";
  if (targetDeviceId === currentDeviceId) {
    return initial;
  }

  try {
    const exact = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: targetDeviceId },
        width: { min: 1280, ideal: 1920 },
        height: { min: 720, ideal: 1080 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    });
    initial.getTracks().forEach((t) => t.stop());
    return exact;
  } catch {
    return initial;
  }
}

function getErrorMessage(name: string | undefined, msg?: string): string {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "请允许浏览器访问相机权限，然后在设置中重新开启";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "未检测到可用相机设备";
    case "NotReadableError":
    case "TrackStartError":
      return "相机可能被其他应用占用，请关闭后重试";
    case "OverconstrainedError":
      return "请求的摄像头模式不可用";
    case "NotSupportedError":
      return "当前浏览器不支持相机功能";
    default: {
      if (!navigator.mediaDevices?.getUserMedia) {
        return "此功能需要 HTTPS 环境才能使用";
      }
      return msg || "相机启动失败，请检查相机权限";
    }
  }
}

async function openCamera(mode: CameraMode = activeMode.value) {
  stopCamera();
  cameraState.value = "starting";
  errorMsg.value = "";
  facingMode = mode === "front" ? "user" : "environment";

  if (!navigator.mediaDevices?.getUserMedia) {
    errorMsg.value = "此功能需要 HTTPS 环境才能使用";
    cameraState.value = "error";
    return;
  }

  try {
    stream = await openCameraByMode(mode);
    activeMode.value = mode;
    await bindStreamToVideo(stream);
  } catch (err: any) {
    const name = err?.name;
    const isOverconstrained = name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError";

    // 优先后置摄像头失败时，自动回退到前置摄像头
    if (isOverconstrained && facingMode === "environment") {
      facingMode = "user";
      try {
        stream = await openCameraByMode("front");
        activeMode.value = "front";
        await bindStreamToVideo(stream);
        return;
      } catch (retryErr: any) {
        errorMsg.value = getErrorMessage(retryErr?.name, retryErr?.message);
        cameraState.value = "error";
        return;
      }
    }

    errorMsg.value = getErrorMessage(name, err?.message);
    cameraState.value = "error";
  }
}

async function bindStreamToVideo(activeStream: MediaStream) {
  cameraState.value = "active";
  await nextTick();
  const track = activeStream.getVideoTracks?.()[0] as any;
  if (track?.getCapabilities && track?.applyConstraints) {
    try {
      const caps = track.getCapabilities();
      const advanced: Record<string, number>[] = [];
      if (caps?.width?.max && caps?.height?.max) {
        advanced.push({
          width: Math.min(caps.width.max, 2560),
          height: Math.min(caps.height.max, 1440),
        });
      }
      if (caps?.zoom && typeof caps.zoom.min === "number" && typeof caps.zoom.max === "number") {
        const targetZoom = caps.zoom.min <= 1 && caps.zoom.max >= 1 ? 1 : caps.zoom.min;
        advanced.push({ zoom: targetZoom });
      }
      if (advanced.length) {
        await track.applyConstraints({ advanced });
      }
    } catch {
      // 某些浏览器不支持 zoom 约束，忽略即可
    }
  }
  const video = videoRef.value;
  if (!video) throw new Error("视频预览节点未就绪");
  video.srcObject = activeStream;
  await video.play();
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null;
  }
}

function takePhoto() {
  if (cameraState.value !== "active" || flashing.value) return;
  const video = videoRef.value;
  const canvas = canvasRef.value;
  if (!video || !canvas) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  // 闪光动画
  flashing.value = true;
  setTimeout(() => { flashing.value = false; }, 200);

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, w, h);
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      uploading.value = true;
      emit("capture", blob);
    },
    "image/jpeg",
    0.92,
  );
}

async function selectMode(mode: CameraMode) {
  if (mode === "wide" && wideDisabled.value) return;
  if (mode === activeMode.value && cameraState.value === "active") return;
  if (switching.value || uploading.value) return;
  switching.value = true;
  await openCamera(mode);
  switching.value = false;
}

function closeDialog() {
  stopCamera();
  emit("update:modelValue", false);
}

function onDialogOpen() {
  cameraState.value = "idle";
  errorMsg.value = "";
  uploading.value = false;
  activeMode.value = "1x";
  openCamera("1x");
}

function onDialogClose() {
  stopCamera();
}

onBeforeUnmount(() => {
  stopCamera();
});
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="100vw"
    :fullscreen="true"
    :show-close="true"
    :close-on-click-modal="false"
    title="拍照上传"
    class="camera-dialog camera-dialog-force-full"
    @open="onDialogOpen"
    @close="onDialogClose"
    @update:model-value="(v: boolean) => { if (!v) closeDialog(); }"
  >
    <div class="camera-body">
      <!-- 相机预览 -->
      <div v-if="cameraState === 'active'" class="camera-preview-wrap">
        <video
          ref="videoRef"
          autoplay
          playsinline
          muted
          class="camera-video"
          :class="{ 'camera-switching': switching, 'camera-flash': flashing }"
        />
        <canvas ref="canvasRef" style="display: none" />

        <!-- 工具栏 -->
        <div class="camera-toolbar-overlay">
          <div class="camera-lens-group">
            <el-button
              v-for="item in lensOptions"
              :key="item.key"
              class="camera-lens-btn"
              :class="{ 'is-active': activeMode === item.key }"
              :disabled="(item.key === 'wide' && wideDisabled) || switching || uploading"
              @click="selectMode(item.key)"
            >
              {{ item.label }}
            </el-button>
          </div>
        </div>

        <!-- 拍照按钮 -->
        <div v-if="!switching && !uploading" class="camera-shutter-ring" @click="takePhoto">
          <div class="camera-shutter-btn" />
        </div>

        <!-- 上传中 -->
        <div v-if="uploading" class="camera-uploading-overlay">
          <el-icon class="camera-uploading-icon" :size="28"><Loading /></el-icon>
          <span>正在上传…</span>
        </div>
      </div>

      <!-- 启动中 -->
      <div v-else-if="cameraState === 'starting'" class="camera-placeholder">
        <el-icon :size="48" style="color: #b0c4de"><Camera /></el-icon>
        <div class="muted" style="margin-top: 8px">正在打开相机…</div>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="cameraState === 'error'" class="camera-placeholder camera-error">
        <el-icon :size="48" style="color: #f56c6c"><WarningFilled /></el-icon>
        <div class="camera-error-msg">{{ errorMsg || "相机启动失败" }}</div>
        <el-button type="primary" plain style="margin-top: 16px" @click="openCamera">
          <el-icon style="margin-right: 4px"><RefreshRight /></el-icon>
          重试
        </el-button>
      </div>

      <!-- 空闲占位（不应该出现，但兜底） -->
      <div v-else class="camera-placeholder">
        <el-icon :size="48" style="color: #b0c4de"><Camera /></el-icon>
        <div class="muted" style="margin-top: 8px">正在打开相机…</div>
      </div>

    </div>
  </el-dialog>
</template>

<script lang="ts">
import { Camera, Loading, RefreshRight, WarningFilled } from "@element-plus/icons-vue";
</script>

<style scoped>
.camera-body {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
  min-height: 0;
  background: #000;
}

.camera-preview-wrap {
  position: relative;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 0;
  overflow: hidden;
}

.camera-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  transition: opacity 0.2s;
}

.camera-video.camera-switching {
  opacity: 0.3;
}

/* 拍照闪光动画 */
.camera-video.camera-flash {
  animation: camera-flash-anim 0.2s ease-out forwards;
}

@keyframes camera-flash-anim {
  0%   { filter: brightness(1); }
  20%  { filter: brightness(3); }
  100% { filter: brightness(1); }
}

/* 上传中遮罩 */
.camera-uploading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
}

.camera-uploading-icon {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* 拍照按钮 */
.camera-shutter-ring {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.camera-shutter-ring:active {
  transform: translateX(-50%) scale(0.92);
}

.camera-shutter-btn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: #fff;
}

/* 占位 / 错误 */
.camera-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  background: #f5f7fa;
  border-radius: 10px;
}

.camera-placeholder.camera-error {
  background: #fef0f0;
}

.camera-error-msg {
  margin-top: 10px;
  color: #c45656;
  font-size: 14px;
  text-align: center;
  padding: 0 24px;
  line-height: 1.6;
  max-width: 90%;
}

:deep(.camera-dialog.el-dialog.is-fullscreen) {
  width: 100vw !important;
  max-width: 100vw !important;
  height: 100dvh !important;
  margin: 0 !important;
}

:deep(.camera-dialog.el-dialog.is-fullscreen .el-dialog__body) {
  height: calc(100dvh - 64px);
  padding: 8px;
  overflow: hidden;
}

.camera-toolbar-overlay {
  position: absolute;
  top: calc(env(safe-area-inset-top) + 10px);
  right: 10px;
  z-index: 3;
}

.camera-lens-group {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
}

.camera-lens-btn.el-button {
  min-height: 30px !important;
  min-width: 54px;
  padding: 0 10px !important;
  border-radius: 999px !important;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
  background: rgba(0, 0, 0, 0.18) !important;
  color: rgba(255, 255, 255, 0.92) !important;
  font-size: 13px;
}

.camera-lens-btn.el-button.is-active {
  background: rgba(255, 255, 255, 0.94) !important;
  border-color: rgba(255, 255, 255, 0.94) !important;
  color: #111 !important;
}

.camera-lens-btn.el-button.is-disabled {
  opacity: 0.45;
}

:deep(.camera-dialog-force-full.el-dialog) {
  width: 100vw !important;
  max-width: 100vw !important;
  height: 100dvh !important;
  margin: 0 !important;
  border-radius: 0 !important;
}

:deep(.camera-dialog-force-full.el-dialog .el-dialog__header) {
  display: none !important;
}

:deep(.camera-dialog-force-full.el-dialog .el-dialog__body) {
  height: 100dvh !important;
  padding: 0 !important;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #000;
}

@media (max-width: 768px) {
  .camera-preview-wrap {
    border-radius: 0;
  }

  .camera-placeholder {
    min-height: 0;
    flex: 1;
  }

  .camera-shutter-ring {
    bottom: calc(env(safe-area-inset-bottom) + 16px);
  }
}
</style>
