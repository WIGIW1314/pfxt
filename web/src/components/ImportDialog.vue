<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { UploadFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import type { UploadFile } from "element-plus";
import { api, downloadFile } from "../api";
import { useModalHistory } from "../composables/useModalHistory";

const props = defineProps<{
  modelValue: boolean;
  title: string;
  uploadUrl: string;
  templateUrl: string;
  sampleName: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  success: [];
}>();

const file = ref<File | null>(null);
const uploading = ref(false);
const viewportWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1024);
const fullscreen = computed(() => viewportWidth.value < 768);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function syncViewportWidth() {
  if (typeof window === "undefined") return;
  viewportWidth.value = window.innerWidth;
}

onMounted(() => {
  syncViewportWidth();
  if (typeof window !== "undefined") {
    window.addEventListener("resize", syncViewportWidth);
  }
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", syncViewportWidth);
  }
});

useModalHistory(
  () => props.modelValue,
  async () => {
    emit("update:modelValue", false);
    return true;
  },
  `import-dialog-${props.title}`,
);

function handleFileChange(uploadFile: UploadFile) {
  const raw = uploadFile.raw || null;
  if (raw && raw.size > MAX_FILE_SIZE) {
    ElMessage.warning("文件大小不能超过 10MB");
    file.value = null;
    return;
  }
  file.value = raw;
}

async function submit() {
  if (!file.value || props.disabled) return;
  uploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file.value);
    await api.post(props.uploadUrl, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    emit("success");
    emit("update:modelValue", false);
    file.value = null;
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || "导入失败，请检查文件格式");
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :fullscreen="fullscreen"
    class="mobile-dialog"
    :title="title"
    @close="emit('update:modelValue', false)"
  >
    <div class="glass-panel" style="padding: 16px">
      <div class="toolbar" style="margin-bottom: 12px">
        <el-button type="primary" plain @click="downloadFile(templateUrl, sampleName)">下载导入模板</el-button>
      </div>
      <div v-if="disabled" class="readonly-banner" style="margin-bottom: 12px">
        <span class="readonly-banner-dot"></span>
        <span>当前活动已锁定，只读</span>
      </div>
      <el-upload
        drag
        :auto-upload="false"
        :show-file-list="true"
        :limit="1"
        :disabled="disabled"
        accept=".xlsx"
        @change="handleFileChange"
      >
        <el-icon size="28"><UploadFilled /></el-icon>
        <div style="margin-top: 8px">拖拽 Excel 到这里，或点击选择模板文件</div>
      </el-upload>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="uploading" :disabled="!file || disabled" @click="submit">开始导入</el-button>
    </template>
  </el-dialog>
</template>
