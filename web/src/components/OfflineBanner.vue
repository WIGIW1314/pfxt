<script setup lang="ts">
import { useNetworkStore } from "../stores/network";

const network = useNetworkStore();
</script>

<template>
  <Transition name="offline-banner">
    <div v-if="network.showOfflineBanner" class="offline-banner">
      <span>⚠ 当前网络不稳定，部分功能可能不可用</span>
    </div>
  </Transition>
</template>

<style scoped>
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 99999;
  background: #e6a23c;
  color: #fff;
  text-align: center;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.offline-banner-enter-active,
.offline-banner-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.offline-banner-enter-from,
.offline-banner-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
