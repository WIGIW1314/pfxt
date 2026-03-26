<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit,
    Underline,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Link.configure({ openOnClick: false }),
    Image,
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
  ],
  onUpdate({ editor }) {
    emit('update:modelValue', editor.getHTML())
  },
})

watch(() => props.modelValue, (val) => {
  if (editor.value && editor.value.getHTML() !== val) {
    editor.value.commands.setContent(val, { emitUpdate: false })
  }
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

/* ---- color ---- */
const colorPicker = ref('#000000')
const bgColorPicker = ref('#ffff00')

/* ---- link popover ---- */
const showLinkPopover = ref(false)
const linkInput = ref('')
const linkInputEl = ref<HTMLInputElement | null>(null)

function openLinkPopover() {
  linkInput.value = editor.value?.getAttributes('link').href || ''
  showLinkPopover.value = true
  nextTick(() => linkInputEl.value?.focus())
}
function applyLink() {
  const url = linkInput.value.trim()
  if (url) {
    editor.value?.chain().focus().setLink({ href: url }).run()
  } else {
    editor.value?.chain().focus().unsetLink().run()
  }
  showLinkPopover.value = false
  linkInput.value = ''
}
function onLinkKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') applyLink()
  if (e.key === 'Escape') { showLinkPopover.value = false; linkInput.value = '' }
}

/* ---- image popover ---- */
const showImagePopover = ref(false)
const imageInput = ref('')
const imageInputEl = ref<HTMLInputElement | null>(null)

function openImagePopover() {
  showImagePopover.value = true
  nextTick(() => imageInputEl.value?.focus())
}
function applyImage() {
  const url = imageInput.value.trim()
  if (url) editor.value?.chain().focus().setImage({ src: url }).run()
  showImagePopover.value = false
  imageInput.value = ''
}
function onImageKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') applyImage()
  if (e.key === 'Escape') { showImagePopover.value = false; imageInput.value = '' }
}

function insertTable() {
  editor.value?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}
</script>

<template>
  <div class="rich-editor" v-if="editor">
    <!-- ===== toolbar ===== -->
    <div class="rich-editor-toolbar">

      <!-- text style -->
      <div class="toolbar-group">
        <button :class="{ active: editor.isActive('bold') }" title="粗体 Ctrl+B" @click="editor.chain().focus().toggleBold().run()"><b>B</b></button>
        <button :class="{ active: editor.isActive('italic') }" title="斜体 Ctrl+I" @click="editor.chain().focus().toggleItalic().run()"><i>I</i></button>
        <button :class="{ active: editor.isActive('underline') }" title="下划线 Ctrl+U" @click="editor.chain().focus().toggleUnderline().run()"><u>U</u></button>
        <button :class="{ active: editor.isActive('strike') }" title="删除线" @click="editor.chain().focus().toggleStrike().run()"><s>S</s></button>
      </div>

      <!-- headings -->
      <div class="toolbar-group">
        <button :class="{ active: editor.isActive('heading', { level: 1 }) }" @click="editor.chain().focus().toggleHeading({ level: 1 }).run()">H1</button>
        <button :class="{ active: editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
        <button :class="{ active: editor.isActive('heading', { level: 3 }) }" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()">H3</button>
      </div>

      <!-- alignment -->
      <div class="toolbar-group">
        <button :class="{ active: editor.isActive({ textAlign: 'left' }) }" title="左对齐" @click="editor.chain().focus().setTextAlign('left').run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor"/><rect x="1" y="7" width="10" height="2" rx="1" fill="currentColor"/><rect x="1" y="12" width="12" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <button :class="{ active: editor.isActive({ textAlign: 'center' }) }" title="居中" @click="editor.chain().focus().setTextAlign('center').run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor"/><rect x="3" y="7" width="10" height="2" rx="1" fill="currentColor"/><rect x="2" y="12" width="12" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <button :class="{ active: editor.isActive({ textAlign: 'right' }) }" title="右对齐" @click="editor.chain().focus().setTextAlign('right').run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor"/><rect x="5" y="7" width="10" height="2" rx="1" fill="currentColor"/><rect x="3" y="12" width="12" height="2" rx="1" fill="currentColor"/></svg>
        </button>
      </div>

      <!-- lists -->
      <div class="toolbar-group">
        <button :class="{ active: editor.isActive('bulletList') }" title="无序列表" @click="editor.chain().focus().toggleBulletList().run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="2" cy="4" r="1.5" fill="currentColor"/><rect x="5" y="3" width="10" height="2" rx="1" fill="currentColor"/><circle cx="2" cy="8" r="1.5" fill="currentColor"/><rect x="5" y="7" width="10" height="2" rx="1" fill="currentColor"/><circle cx="2" cy="12" r="1.5" fill="currentColor"/><rect x="5" y="11" width="10" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <button :class="{ active: editor.isActive('orderedList') }" title="有序列表" @click="editor.chain().focus().toggleOrderedList().run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><text x="0" y="5" font-size="5" font-family="monospace" fill="currentColor">1.</text><rect x="5" y="3" width="10" height="2" rx="1" fill="currentColor"/><text x="0" y="10" font-size="5" font-family="monospace" fill="currentColor">2.</text><rect x="5" y="8" width="10" height="2" rx="1" fill="currentColor"/><text x="0" y="15" font-size="5" font-family="monospace" fill="currentColor">3.</text><rect x="5" y="13" width="10" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <button :class="{ active: editor.isActive('blockquote') }" title="引用" @click="editor.chain().focus().toggleBlockquote().run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="2" width="3" height="12" rx="1.5" fill="var(--el-color-primary,#409eff)"/><rect x="6" y="4" width="9" height="2" rx="1" fill="currentColor"/><rect x="6" y="8" width="7" height="2" rx="1" fill="currentColor"/><rect x="6" y="12" width="8" height="2" rx="1" fill="currentColor"/></svg>
        </button>
      </div>

      <!-- color -->
      <div class="toolbar-group">
        <label class="color-btn" title="文字颜色">
          <svg width="14" height="14" viewBox="0 0 16 16"><text x="2" y="11" font-size="11" font-weight="bold" font-family="serif" fill="currentColor">A</text><rect x="1" y="13" width="14" height="2" rx="1" :fill="colorPicker"/></svg>
          <input type="color" v-model="colorPicker" @input="editor.chain().focus().setColor(colorPicker).run()" />
        </label>
        <label class="color-btn" title="背景色">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="3" :fill="bgColorPicker" opacity="0.6"/><text x="2" y="12" font-size="11" font-weight="bold" font-family="serif" fill="#333">A</text></svg>
          <input type="color" v-model="bgColorPicker" @input="editor.chain().focus().setHighlight({ color: bgColorPicker }).run()" />
        </label>
      </div>

      <!-- insert -->
      <div class="toolbar-group" style="position:relative">
        <!-- link button + popover -->
        <div style="position:relative">
          <button :class="{ active: editor.isActive('link') }" title="插入链接" @click="openLinkPopover">
            <svg width="14" height="14" viewBox="0 0 16 16"><path d="M6.5 11.5l-1.5 1.5a3 3 0 01-4.24-4.24l3-3a3 3 0 014.1.12" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M9.5 4.5l1.5-1.5a3 3 0 014.24 4.24l-3 3a3 3 0 01-4.1-.12" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M5.5 10.5l5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <div v-if="showLinkPopover" class="url-popover">
            <input
              ref="linkInputEl"
              v-model="linkInput"
              placeholder="输入链接地址"
              @keydown="onLinkKeydown"
            />
            <button class="url-popover-confirm" @click="applyLink">确认</button>
            <button class="url-popover-cancel" @click="showLinkPopover = false">取消</button>
          </div>
        </div>

        <!-- image button + popover -->
        <div style="position:relative">
          <button title="插入图片" @click="openImagePopover">
            <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/><path d="M1.5 13l4-4 3 3 2-2 4 4" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div v-if="showImagePopover" class="url-popover">
            <input
              ref="imageInputEl"
              v-model="imageInput"
              placeholder="输入图片 URL"
              @keydown="onImageKeydown"
            />
            <button class="url-popover-confirm" @click="applyImage">确认</button>
            <button class="url-popover-cancel" @click="showImagePopover = false">取消</button>
          </div>
        </div>

        <button title="插入表格" @click="insertTable">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.3" fill="none"/><line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.2"/><line x1="1" y1="11" x2="15" y2="11" stroke="currentColor" stroke-width="1.2"/><line x1="6" y1="1" x2="6" y2="15" stroke="currentColor" stroke-width="1.2"/><line x1="11" y1="1" x2="11" y2="15" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button title="分割线" @click="editor.chain().focus().setHorizontalRule().run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>

      <!-- undo / redo -->
      <div class="toolbar-group">
        <button title="撤销 Ctrl+Z" :disabled="!editor.can().undo()" @click="editor.chain().focus().undo().run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8a5 5 0 105 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><polyline points="1,5 3,8 6,6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </button>
        <button title="重做 Ctrl+Y" :disabled="!editor.can().redo()" @click="editor.chain().focus().redo().run()">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M13 8a5 5 0 11-5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><polyline points="15,5 13,8 10,6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>

    <!-- editor content -->
    <EditorContent :editor="editor" class="rich-editor-content" />
  </div>
</template>

<style scoped>
.rich-editor {
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  overflow: visible;
  background: #fff;
}

.rich-editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--el-border-color, #dcdfe6);
  background: #fafafa;
  border-radius: 6px 6px 0 0;
  align-items: center;
}

.toolbar-group {
  display: flex;
  gap: 1px;
  margin-right: 4px;
  padding-right: 6px;
  border-right: 1px solid #e4e7ed;
  align-items: center;
}
.toolbar-group:last-child {
  border-right: none;
  padding-right: 0;
  margin-right: 0;
}

.rich-editor-toolbar button,
.rich-editor-toolbar .color-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: #555;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
  padding: 0;
}
.rich-editor-toolbar button:hover {
  background: #eef0f5;
  color: #222;
}
.rich-editor-toolbar button.active {
  background: var(--el-color-primary-light-8, #d9ecff);
  color: var(--el-color-primary, #409eff);
}
.rich-editor-toolbar button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.color-btn {
  position: relative;
  overflow: hidden;
}
.color-btn input[type="color"] {
  position: absolute;
  bottom: -4px;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* url inline popover */
.url-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 6px;
  padding: 6px 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  white-space: nowrap;
}
.url-popover input {
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 13px;
  outline: none;
  width: 220px;
  height: 28px;
}
.url-popover input:focus {
  border-color: var(--el-color-primary, #409eff);
}
.url-popover-confirm {
  background: var(--el-color-primary, #409eff) !important;
  color: #fff !important;
  font-size: 12px !important;
  padding: 0 10px !important;
  height: 28px !important;
  width: auto !important;
  border-radius: 4px !important;
  border: none !important;
}
.url-popover-cancel {
  background: transparent !important;
  color: #909399 !important;
  font-size: 12px !important;
  padding: 0 8px !important;
  height: 28px !important;
  width: auto !important;
  border-radius: 4px !important;
  border: 1px solid #dcdfe6 !important;
}

.rich-editor-content {
  border-radius: 0 0 6px 6px;
  overflow: hidden;
}

.rich-editor-content :deep(.tiptap) {
  padding: 12px 14px;
  min-height: 160px;
  outline: none;
  font-size: 14px;
  line-height: 1.8;
  color: #303133;
}
.rich-editor-content :deep(.tiptap p) { margin: 0.4em 0; }
.rich-editor-content :deep(.tiptap h1) { font-size: 1.6em; font-weight: 700; margin: 0.8em 0 0.4em; }
.rich-editor-content :deep(.tiptap h2) { font-size: 1.3em; font-weight: 700; margin: 0.7em 0 0.3em; }
.rich-editor-content :deep(.tiptap h3) { font-size: 1.1em; font-weight: 600; margin: 0.6em 0 0.3em; }
.rich-editor-content :deep(.tiptap ul),
.rich-editor-content :deep(.tiptap ol) { padding-left: 1.5em; margin: 0.4em 0; }
.rich-editor-content :deep(.tiptap blockquote) {
  border-left: 3px solid var(--el-color-primary, #409eff);
  padding-left: 12px;
  margin: 8px 0;
  color: #666;
  font-style: italic;
}
.rich-editor-content :deep(.tiptap hr) {
  border: none;
  border-top: 2px solid #e4e7ed;
  margin: 12px 0;
}
.rich-editor-content :deep(.tiptap a) {
  color: var(--el-color-primary, #409eff);
  text-decoration: underline;
  cursor: pointer;
}
.rich-editor-content :deep(.tiptap img) {
  max-width: 100%;
  border-radius: 4px;
  height: auto;
}
.rich-editor-content :deep(.tiptap table) {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  table-layout: fixed;
}
.rich-editor-content :deep(.tiptap th),
.rich-editor-content :deep(.tiptap td) {
  border: 1px solid #dcdfe6;
  padding: 6px 10px;
  text-align: left;
  position: relative;
}
.rich-editor-content :deep(.tiptap th) {
  background: #f5f7fa;
  font-weight: 600;
}
.rich-editor-content :deep(.tiptap .selectedCell:after) {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(64,158,255,0.1);
  pointer-events: none;
}
</style>


const props = defineProps<{
