<script setup lang="ts">
import { watch, onMounted } from "vue";
import { useSyncStore } from "./stores/sync";

const sync = useSyncStore();

onMounted(() => {
  sync.fetchSiteTitle();
});

watch(
  () => sync.siteTitle,
  (title) => {
    document.title = title;
  },
  { immediate: true },
);
</script>

<template>
  <router-view />
</template>
