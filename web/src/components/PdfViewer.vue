<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { ElProgress } from 'element-plus'

const props = defineProps<{
  url: string
}>()

const container = ref<HTMLDivElement | null>(null)
const totalPages = ref(0)
const loading = ref(false)
const error = ref('')
const loadingPhase = ref<'init' | 'doc' | 'pages'>('init')
const loadingPage = ref(0)
let pdfDoc: any = null
let destroyed = false

const loadingText = computed(() => {
  if (loadingPhase.value === 'init') return '正在初始化…'
  if (loadingPhase.value === 'doc') return '正在解析文档…'
  if (totalPages.value > 0) return `正在渲染第 ${loadingPage.value}/${totalPages.value} 页`
  return 'PDF 加载中…'
})

const progressPercent = computed(() => {
  if (totalPages.value > 0 && loadingPage.value > 0) {
    return Math.round((loadingPage.value / totalPages.value) * 100)
  }
  return null
})

async function loadPdf() {
  if (!props.url) return
  loading.value = true
  error.value = ''
  totalPages.value = 0
  loadingPage.value = 0
  loadingPhase.value = 'init'

  try {
    const pdfjsLib = await import('pdfjs-dist')
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs'
    }

    if (pdfDoc) {
      await pdfDoc.destroy()
      pdfDoc = null
    }

    if (destroyed) return
    const el = container.value
    if (!el) return
    el.innerHTML = ''

    loadingPhase.value = 'doc'
    const loadingTask = pdfjsLib.getDocument({ url: props.url })
    pdfDoc = await loadingTask.promise

    if (destroyed) return
    totalPages.value = pdfDoc.numPages

    const containerEl = container.value
    if (!containerEl) return

    const dpr = window.devicePixelRatio || 1

    loadingPhase.value = 'pages'
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      if (destroyed) break
      loadingPage.value = pageNum
      const page = await pdfDoc.getPage(pageNum)
      const containerWidth = containerEl.clientWidth || 700
      const unscaledViewport = page.getViewport({ scale: 1 })
      const scale = containerWidth / unscaledViewport.width
      const viewport = page.getViewport({ scale: scale * dpr })

      const wrapper = document.createElement('div')
      wrapper.className = 'pdf-page-wrapper'

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${containerWidth}px`
      canvas.style.height = `${Math.round(containerWidth * (unscaledViewport.height / unscaledViewport.width))}px`
      canvas.style.display = 'block'
      canvas.style.maxWidth = '100%'

      wrapper.appendChild(canvas)
      containerEl.appendChild(wrapper)

      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport }).promise
    }
  } catch (e: any) {
    if (!destroyed) {
      error.value = e.message || 'PDF 加载失败'
    }
  } finally {
    if (!destroyed) {
      loading.value = false
      loadingPage.value = 0
    }
  }
}

watch(() => props.url, async () => {
  await nextTick()
  loadPdf()
})

onMounted(() => {
  destroyed = false
  loadPdf()
})

onBeforeUnmount(() => {
  destroyed = true
  pdfDoc?.destroy()
  pdfDoc = null
})
</script>

<template>
  <div class="pdf-viewer">
    <!-- Loading state with progress -->
    <div v-if="loading" class="pdf-viewer-loading">
      <div class="pdf-viewer-spin"></div>
      <span class="pdf-viewer-status-text">{{ loadingText }}</span>
      <ElProgress
        v-if="progressPercent !== null"
        :percentage="progressPercent"
        :show-text="false"
        :stroke-width="3"
        class="pdf-viewer-progress"
      />
    </div>
    <!-- Error state -->
    <div v-else-if="error" class="pdf-viewer-status pdf-viewer-error">
      <span>⚠ {{ error }}</span>
      <a :href="url" target="_blank" class="pdf-fallback-link">点击直接打开</a>
    </div>
    <!-- Success state -->
    <div v-else-if="!loading && !error && totalPages > 0" class="pdf-page-count">
      共 {{ totalPages }} 页
    </div>
    <div ref="container" class="pdf-canvas-container" />
  </div>
</template>

<style scoped>
.pdf-viewer {
  width: 100%;
}

.pdf-viewer-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 0;
}

.pdf-viewer-spin {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid var(--el-color-primary-light-5, #a0cfff);
  border-top-color: var(--el-color-primary, #409eff);
  border-radius: 50%;
  animation: pdf-spin 0.7s linear infinite;
}

@keyframes pdf-spin {
  to { transform: rotate(360deg); }
}

.pdf-viewer-status-text {
  font-size: 13px;
  color: var(--muted, #999);
  text-align: center;
}

.pdf-viewer-progress {
  width: 160px;
}

.pdf-viewer-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  color: var(--muted, #999);
  font-size: 13px;
}

.pdf-viewer-error {
  color: var(--el-color-danger, #f56c6c);
}

.pdf-fallback-link {
  color: var(--el-color-primary, #409eff);
  text-decoration: underline;
  font-size: 12px;
  margin-left: 4px;
}

.pdf-page-count {
  font-size: 12px;
  color: var(--muted, #999);
  margin-bottom: 8px;
}

.pdf-canvas-container {
  width: 100%;
}

.pdf-canvas-container :deep(.pdf-page-wrapper) {
  margin-bottom: 12px;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  line-height: 0;
}

.pdf-canvas-container :deep(canvas) {
  display: block;
  max-width: 100%;
}
</style>
