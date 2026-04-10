<script setup lang="ts">
import { RefreshRight } from "@element-plus/icons-vue";

const props = defineProps<{
  error: Error;
  section?: string;
}>();

const emit = defineEmits<{
  retry: [];
}>();

// Log to console for debugging
console.error("[ErrorFallback]", props.section ? `Section: ${props.section}` : "", props.error);
</script>

<template>
  <div class="error-fallback glass-panel" role="alert" aria-live="assertive">
    <div class="error-fallback-icon">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="var(--el-color-danger-light-9)" />
        <path d="M12 7v6M12 16v.5" stroke="var(--el-color-danger)" stroke-width="2" stroke-linecap="round" />
      </svg>
    </div>
    <h3 class="error-fallback-title">加载失败</h3>
    <p class="error-fallback-message">
      {{ section ? `「${section}」页面` : '该组件' }}加载时遇到问题，可能数据较大，请重试。
    </p>
    <p class="error-fallback-detail muted">{{ error.message || '未知错误' }}</p>
    <el-button type="primary" :icon="RefreshRight" @click="emit('retry')">
      重试
    </el-button>
  </div>
</template>

<style scoped>
.error-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  border-radius: 12px;
  min-height: 200px;
  margin: 16px;
}

.error-fallback-icon {
  margin-bottom: 16px;
  opacity: 0.85;
}

.error-fallback-title {
  margin: 0 0 8px;
  font-size: 18px;
  color: var(--el-text-color-primary);
}

.error-fallback-message {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--el-text-color-regular);
  max-width: 360px;
}

.error-fallback-detail {
  margin: 0 0 20px;
  font-size: 12px;
  max-width: 400px;
  word-break: break-all;
}

.error-fallback :deep(.el-button) {
  min-width: 120px;
}
</style>
