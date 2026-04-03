<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps<{
  url: string
}>()

const container = ref<HTMLDivElement | null>(null)
const totalPages = ref(0)
const loading = ref(false)
const error = ref('')
let pdfDoc: any = null
let destroyed = false

async function loadPdf() {
  if (!props.url) return
  loading.value = true
  error.value = ''
  totalPages.value = 0

  try {
    // Dynamic import to keep it out of the main bundle
    const pdfjsLib = await import('pdfjs-dist')
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).href
    }

    if (pdfDoc) {
      await pdfDoc.destroy()
      pdfDoc = null
    }

    if (destroyed) return
    const el = container.value
    if (!el) return
    el.innerHTML = ''

    const loadingTask = pdfjsLib.getDocument({ url: props.url })
    pdfDoc = await loadingTask.promise

    if (destroyed) return
    totalPages.value = pdfDoc.numPages

    const containerEl = container.value
    if (!containerEl) return

    const dpr = window.devicePixelRatio || 1

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      if (destroyed) break
      const page = await pdfDoc.getPage(pageNum)
      // Use container width to scale PDF to fit
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
    if (!destroyed) loading.value = false
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
    <div v-if="loading" class="pdf-viewer-status">
      <span class="pdf-viewer-spin"></span>
      <span>PDF 加载中…</span>
    </div>
    <div v-if="error" class="pdf-viewer-status pdf-viewer-error">
      <span>⚠ {{ error }}</span>
      <a :href="url" target="_blank" class="pdf-fallback-link">点击直接打开</a>
    </div>
    <div v-if="!loading && !error && totalPages > 0" class="pdf-page-count">
      共 {{ totalPages }} 页
    </div>
    <div ref="container" class="pdf-canvas-container" />
  </div>
</template>

<style scoped>
.pdf-viewer {
  width: 100%;
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

.pdf-viewer-spin {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: pdf-spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes pdf-spin {
  to { transform: rotate(360deg); }
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
