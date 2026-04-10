<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

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
const viewportWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1024);
let stream: MediaStream | null = null;
let facingMode: "environment" | "user" = "environment";
const cameraDialogFullscreen = computed(() => viewportWidth.value <= 768);

function syncViewportWidth() {
  if (typeof window === "undefined") return;
  viewportWidth.value = window.innerWidth;
}

function buildVideoConstraints(mode: "environment" | "user"): MediaTrackConstraints {
  return {
    facingMode: { ideal: mode },
    width: { ideal: 1920 },
    height: { ideal: 1440 },
    aspectRatio: { ideal: 4 / 3 },
  };
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

async function openCamera() {
  stopCamera();
  cameraState.value = "starting";
  errorMsg.value = "";

  if (!navigator.mediaDevices?.getUserMedia) {
    errorMsg.value = "此功能需要 HTTPS 环境才能使用";
    cameraState.value = "error";
    return;
  }

  try {
    const constraints: MediaStreamConstraints = {
      video: buildVideoConstraints(facingMode),
      audio: false,
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    await bindStreamToVideo(stream);
  } catch (err: any) {
    const name = err?.name;
    const isOverconstrained = name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError";

    // 优先后置摄像头失败时，自动回退到前置摄像头
    if (isOverconstrained && facingMode === "environment") {
      facingMode = "user";
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(facingMode),
          audio: false,
        });
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

async function switchCamera() {
  if (switching.value) return;
  switching.value = true;
  facingMode = facingMode === "environment" ? "user" : "environment";
  await openCamera();
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
  openCamera();
}

function onDialogClose() {
  stopCamera();
}

onBeforeUnmount(() => {
  stopCamera();
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", syncViewportWidth);
  }
});

onMounted(() => {
  syncViewportWidth();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", syncViewportWidth);
  }
});
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    width="min(920px, calc(100vw - 16px))"
    :fullscreen="cameraDialogFullscreen"
    :show-close="true"
    :close-on-click-modal="false"
    title="拍照上传"
    class="camera-dialog"
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

      <!-- 工具栏 -->
      <div v-if="cameraState === 'active'" class="camera-toolbar">
        <el-button text @click="switchCamera" :loading="switching">
          <el-icon :size="20"><RefreshRight /></el-icon>
          <span style="margin-left: 4px">翻转</span>
        </el-button>
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
  gap: 12px;
}

.camera-preview-wrap {
  position: relative;
  width: 100%;
  height: min(72vh, 760px);
  background: #000;
  border-radius: 10px;
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
  aspect-ratio: 4 / 3;
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
}

.camera-toolbar {
  display: flex;
  justify-content: center;
  gap: 12px;
}

@media (max-width: 768px) {
  .camera-preview-wrap {
    height: calc(100dvh - 220px);
    border-radius: 8px;
  }
}
</style>
