<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'

export interface DocFile {
  name: string
  url: string
  /** 'pdf' | 'docx' | 'html' */
  type: string
  description?: string
}

const props = defineProps<{
  /** HTML string to render directly */
  html?: string
  /** Attached document files */
  files?: DocFile[]
}>()

const docxContainers = ref<Record<string, HTMLElement>>({})
const docxErrors = ref<Record<string, string>>({})
const renderedDocxUrls = ref<Record<string, string>>({})

function setDocxRef(name: string) {
  return (el: any) => {
    if (el) docxContainers.value[name] = el
  }
}

async function renderDocx(file: DocFile) {
  const container = docxContainers.value[file.name]
  if (!container) return
  if (renderedDocxUrls.value[file.name] === file.url && !docxErrors.value[file.name]) return
  try {
    const resp = await fetch(file.url)
    if (!resp.ok) throw new Error('下载失败')
    const blob = await resp.blob()
    const docxPreview = await import('docx-preview')
    container.innerHTML = ''
    await docxPreview.renderAsync(blob, container, undefined, {
      className: 'docx-viewer-inner',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: true,
    })
    renderedDocxUrls.value[file.name] = file.url
    delete docxErrors.value[file.name]
  } catch (e: any) {
    docxErrors.value[file.name] = e.message || '文档加载失败'
  }
}

const docxFiles = ref<DocFile[]>([])
const pdfFiles = ref<DocFile[]>([])

function categorize() {
  const files = props.files || []
  docxFiles.value = files.filter(f => f.type === 'docx')
  pdfFiles.value = files.filter(f => f.type === 'pdf')
}

watch(() => props.files, () => {
  categorize()
  nextTick(() => {
    docxFiles.value.forEach(renderDocx)
  })
})

onMounted(() => {
  categorize()
  nextTick(() => {
    docxFiles.value.forEach(renderDocx)
  })
})
</script>

<template>
  <div class="doc-viewer">
    <!-- HTML content -->
    <div v-if="html" class="doc-viewer-html" v-html="html"></div>

    <!-- Attached files -->
    <template v-if="files && files.length">
      <div v-for="file in pdfFiles" :key="file.name" class="doc-viewer-file">
        <div class="doc-file-header">
          <svg class="doc-file-icon" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="1" width="14" height="18" rx="2" fill="#f56c6c" opacity="0.15" stroke="#f56c6c" stroke-width="1.2"/><path d="M7 7h6M7 10h6M7 13h4" stroke="#f56c6c" stroke-width="1.2" stroke-linecap="round"/><text x="3.5" y="18" font-size="4" font-weight="bold" fill="#f56c6c">PDF</text></svg>
          <div class="doc-file-info">
            <div class="doc-file-name">{{ file.name }}</div>
            <div v-if="file.description" class="doc-file-desc">{{ file.description }}</div>
          </div>
          <a :href="file.url" target="_blank" class="doc-file-download" :download="file.name">
            <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 1v9M4 7l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            下载
          </a>
        </div>
        <iframe :src="file.url" class="pdf-frame" frameborder="0"></iframe>
      </div>

      <div v-for="file in docxFiles" :key="file.name" class="doc-viewer-file">
        <div class="doc-file-header">
          <svg class="doc-file-icon" width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="1" width="14" height="18" rx="2" fill="#409eff" opacity="0.12" stroke="#409eff" stroke-width="1.2"/><path d="M7 7h6M7 10h6M7 13h4" stroke="#409eff" stroke-width="1.2" stroke-linecap="round"/><text x="2" y="18" font-size="3.5" font-weight="bold" fill="#409eff">DOCX</text></svg>
          <div class="doc-file-info">
            <div class="doc-file-name">{{ file.name }}</div>
            <div v-if="file.description" class="doc-file-desc">{{ file.description }}</div>
          </div>
          <a :href="file.url" target="_blank" class="doc-file-download" :download="file.name">
            <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 1v9M4 7l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            下载
          </a>
        </div>
        <div v-if="docxErrors[file.name]" class="doc-error">{{ docxErrors[file.name] }}</div>
        <div :ref="setDocxRef(file.name)" class="docx-container"></div>
      </div>
    </template>

    <div v-if="!html && (!files || !files.length)" class="doc-viewer-empty">
      暂无内容
    </div>
  </div>
</template>

<style scoped>
.doc-viewer {
  width: 100%;
}

.doc-viewer-html {
  line-height: 1.8;
  word-wrap: break-word;
  color: #333;
}

.doc-viewer-html :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 8px 0;
}
.doc-viewer-html :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
}
.doc-viewer-html :deep(th),
.doc-viewer-html :deep(td) {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}
.doc-viewer-html :deep(h1),
.doc-viewer-html :deep(h2),
.doc-viewer-html :deep(h3) {
  margin: 16px 0 8px;
  font-weight: 600;
}
.doc-viewer-html :deep(p) {
  margin: 8px 0;
}
.doc-viewer-html :deep(ul),
.doc-viewer-html :deep(ol) {
  margin-left: 20px;
}
.doc-viewer-html :deep(blockquote) {
  border-left: 3px solid var(--el-color-primary, #409eff);
  padding-left: 12px;
  margin: 8px 0;
  color: #666;
}
.doc-viewer-html :deep(a) {
  color: var(--el-color-primary, #409eff);
}

.doc-viewer-file {
  margin-top: 16px;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  overflow: hidden;
}

.doc-file-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #f9f9f9;
  border-bottom: 1px solid #e8e8e8;
}
.doc-file-icon {
  flex-shrink: 0;
}
.doc-file-info {
  flex: 1;
  min-width: 0;
}
.doc-file-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-file-desc {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-file-download {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-color-primary, #409eff);
  text-decoration: none;
  white-space: nowrap;
  padding: 4px 10px;
  border: 1px solid var(--el-color-primary, #409eff);
  border-radius: 4px;
  transition: background 0.15s;
}
.doc-file-download:hover {
  background: var(--el-color-primary-light-9, #ecf5ff);
}

.pdf-frame {
  width: 100%;
  height: 600px;
  border: none;
  display: block;
}

.docx-container {
  padding: 16px;
  overflow-x: auto;
}
.docx-container :deep(.docx-viewer-inner) {
  margin: 0 auto;
}

.doc-error {
  padding: 12px;
  color: var(--el-color-danger, #f56c6c);
  text-align: center;
  font-size: 13px;
}

.doc-viewer-empty {
  padding: 30px;
  text-align: center;
  color: var(--muted, #999);
  font-size: 14px;
}
</style>
