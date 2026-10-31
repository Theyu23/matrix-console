<script setup>
import { ref } from 'vue'
import { nextWidth, stepWidth } from '../splitter.js'

// 一条可拖动的竖向分隔条。
//
// 关键点：拖动过程中只改宽度、不写存储，松手才落盘——
// 否则每移动一像素写一次 localStorage，拖一下能写几百次。
const props = defineProps({
  spec: { type: Object, required: true },
  width: { type: Number, required: true },
  // 分隔条右侧的分栏：它是「往左拖变宽」，方向要反过来
  invert: { type: Boolean, default: false },
  label: { type: String, default: '' }
})

const emit = defineEmits(['resize', 'commit'])

const active = ref(false)
let startX = 0
let startW = 0

function onPointerMove(e) {
  if (!active.value) return
  const w = nextWidth(startW, e.clientX - startX, props.spec, props.invert)
  emit('resize', w)
}

function onPointerUp() {
  if (!active.value) return
  active.value = false
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  emit('commit')
}

function onPointerDown(e) {
  // 只响应主键，右键/中键不该开始拖动。
  if (e.button !== 0) return
  e.preventDefault()
  active.value = true
  startX = e.clientX
  startW = props.width
  // 拖到 webview / iframe 上方时指针事件会被吞掉，所以监听挂在 window 上，
  // 并在拖动期间用 body 的 cursor 让用户知道还在拖。
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onKeydown(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const w = stepWidth(props.width, e.key, props.spec, {
    invert: props.invert,
    big: e.shiftKey
  })
  emit('resize', w)
  emit('commit')
}

// 双击回到默认宽度：拖歪了总要有个一键复位。
function onDblclick() {
  emit('resize', props.spec.def)
  emit('commit')
}
</script>

<template>
  <div
    class="splitter"
    :class="{ active }"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label || '拖动调整宽度'"
    :aria-valuenow="width"
    :aria-valuemin="spec.min"
    :aria-valuemax="spec.max"
    tabindex="0"
    :title="'拖动调整宽度，双击恢复默认（' + spec.def + 'px）'"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
    @dblclick="onDblclick"
  >
    <span class="grip" />
  </div>
</template>

<style scoped>
/* 视觉上只有 1px 线，热区做到 7px：能用鼠标抓住，又不占视觉空间。 */
.splitter {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 7px;
  cursor: col-resize;
  background: transparent;
  outline: none;
  /* 拖动时鼠标可能滑出条外，靠这层保证指针事件连续。 */
  touch-action: none;
}
.splitter::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  background: var(--line);
}
.splitter:hover::before,
.splitter:focus-visible::before {
  left: 2px;
  width: 3px;
  background: #c9cdd4;
  border-radius: 2px;
}
.splitter.active::before {
  left: 2px;
  width: 3px;
  background: var(--brand);
  border-radius: 2px;
}
.grip {
  width: 3px;
  height: 28px;
  border-radius: 2px;
  background: transparent;
}
.splitter:hover .grip {
  background: #d5d8de;
}
</style>
