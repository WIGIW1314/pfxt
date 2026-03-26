<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";

defineProps<{
  items: Array<{ label: string; path: string; icon: any }>;
}>();

const route = useRoute();
const router = useRouter();
</script>

<template>
  <nav class="dock">
    <div
      v-for="item in items"
      :key="item.path"
      class="dock-item"
      :class="{ active: route.path.startsWith(item.path) }"
      @click="router.push(item.path)"
    >
      <el-icon size="18"><component :is="item.icon" /></el-icon>
      <span>{{ item.label }}</span>
    </div>
  </nav>
</template>
