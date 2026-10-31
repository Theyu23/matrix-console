<script setup>
defineProps({ platforms: Array, active: String })
defineEmits(['switch'])
</script>

<template>
  <nav class="sidebar">
    <div class="brand">矩阵控制台</div>
    <button
      v-for="p in platforms"
      :key="p.key"
      class="tab"
      :class="{ active: active === p.key }"
      @click="$emit('switch', p.key)"
    >
      {{ p.label }}
    </button>
    <div class="foot">本地运行 · 无遥测</div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 200px;
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  background: var(--sidebar);
  color: #c9d1d9;
}
.brand {
  padding: 4px 8px 16px;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}
.tab {
  margin-bottom: 6px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
}
.tab:hover {
  background: #1c2733;
}
.tab.active {
  background: var(--brand);
  color: #fff;
}
.foot {
  margin-top: auto;
  padding: 8px;
  color: #6b7280;
  font-size: 12px;
}
</style>
