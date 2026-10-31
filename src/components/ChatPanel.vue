<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps({
  messages: Array,
  accountName: String,
  hint: String,
  publishing: Boolean,
  // 多路合并模式：每条消息带来源账号，需要单独标出来，否则分不清谁在说。
  multi: { type: Boolean, default: false },
  // 可筛选的来源列表 [{ id, name }]，以及当前只看哪一路。
  sources: { type: Array, default: () => [] },
  focusedId: { type: String, default: '' },
  // 发布目标：墙上被选中的那一格。空表示「跟随选中」。
  publishTo: { type: String, default: '' },
  // 各账号此刻的页面类型（live / video / ''），用来在确认框里说清发到哪种页面。
  pageKinds: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['fill', 'publish', 'focus-source'])
const feed = ref(null)
const draft = ref('')

// 当前发布目标的名字，用于按钮提示和二次确认。
const targetName = computed(() => {
  const hit = (props.sources || []).find((s) => s.id === props.publishTo)
  return hit ? String(hit.name || '') : props.accountName || ''
})
// 页面类型的中文标签，由 App 用 pageKindLabel 算好后传进来。
// 这里只负责显示，避免两处各写一套判定。
function kindLabel(id) {
  const k = props.pageKinds && props.pageKinds[id]
  return k || ''
}

async function scrollToBottom() {
  await nextTick()
  if (feed.value) feed.value.scrollTop = feed.value.scrollHeight
}

function submit() {
  if (!draft.value) return
  emit('fill', draft.value)
}

function publish() {
  if (!draft.value || props.publishing) return
  emit('publish', draft.value)
}

function onEnter(e) {
  // 中文输入法确认候选词的 Enter 不应触发“填入”
  if (e.isComposing) return
  // Ctrl/Cmd+Enter 一键走发布（仍会二次确认，且只对当前账号）。
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    publish()
    return
  }
  submit()
}

watch(() => props.messages.length, scrollToBottom, { immediate: true })
onMounted(scrollToBottom)
</script>

<template>
  <aside class="chat">
    <header>
      评论流 <span class="badge" title="只读采集；发布只对当前账号且需确认">只读</span>
      <span v-if="multi" class="src-badge" title="监看墙模式下合并显示多个账号的评论">
        {{ messages.length ? '多路合并' : '多路' }}
      </span>
      <span v-if="accountName" class="who">{{ accountName }}</span>
    </header>
    <!--
      多路时在头部列出各来源，点一下只看那一路，再点回到全看。
      筛选只作用于这个面板：账号列表的勾选是批量打开的入口，混用会互相打架。
    -->
    <div v-if="multi && sources.length" class="src-bar">
      <button
        v-for="s in sources"
        :key="s.id"
        class="src-chip"
        :class="{ on: s.id === focusedId }"
        :title="focusedId === s.id ? '再点一次看全部' : `只看「${s.name}」`"
        @click="$emit('focus-source', s.id)"
      >
        {{ s.name }}
      </button>
    </div>
    <div ref="feed" class="feed">
      <p v-if="!messages.length" class="empty">
        <template v-if="multi">
          监看墙上打开页面后自动采集；勾选账号可只看选中的几个。
        </template>
        <template v-else>
          直播间和视频页打开后自动采集；切到对应页面时评论流会继续累积。
        </template>
      </p>
      <div v-for="(m, i) in messages" :key="m.ts + '-' + i" class="msg">
        <span v-if="multi && m.srcName" class="from" :title="m.srcName">{{ m.srcName }}</span>
        <span v-if="m.kind === 'video'" class="tag">视频</span>
        <span v-if="m.nickname" class="nick">{{ m.nickname }}</span>
        <span class="text">{{ m.text }}</span>
      </div>
    </div>
    <div v-if="hint" class="fill-hint">{{ hint }}</div>
    <!--
      发布目标。监看墙模式下这里决定「发到哪一格」，
      默认跟随墙上点选的那一格。多账号同时开着一堆页面时，
      不标出来就没人说得清这条会发到哪个号下面。
    -->
    <div v-if="sources.length" class="target-row">
      <span class="target-label">发布到</span>
      <select
        class="target-select"
        :value="publishTo"
        :disabled="publishing || !sources.length"
        @change="$emit('pick-target', $event.target.value)"
      >
        <option v-for="s in sources" :key="s.id" :value="s.id">
          {{ s.name }}{{ kindLabel(s.id) ? '（' + kindLabel(s.id) + '）' : '' }}
        </option>
      </select>
    </div>
    <footer class="composer">
      <input
        v-model.trim="draft"
        placeholder="输入内容，Enter 填入，Ctrl+Enter 发送"
        @keydown.enter="onEnter"
      />
      <button :disabled="!draft" title="只填入，不发送" @click="submit">填入</button>
      <button
        class="publish"
        :disabled="!draft || publishing"
        :title="`发布前会二次确认；只对「${targetName || '当前账号'}」`"
        @click="publish"
      >
        {{ publishing ? '发布中' : '发布' }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.chat {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 280px;
  min-height: 0;
  background: #fff;
  border-left: 1px solid var(--line);
}
header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  font-weight: 600;
}
.badge {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #f2f3f5;
  color: #8a919f;
  font-size: 12px;
  font-weight: 400;
}
.who {
  display: block;
  max-width: 100%;
  margin-top: 2px;
  overflow: hidden;
  color: #8a919f;
  font-size: 12px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 多路来源筛选条。横向可滚，账号多时不换行挤压头部。 */
.src-bar {
  display: flex;
  flex: none;
  gap: 4px;
  padding: 6px 10px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.src-bar::-webkit-scrollbar {
  display: none;
}
.src-chip {
  flex: none;
  max-width: 9em;
  padding: 2px 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff;
  color: #646a73;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.src-chip:hover {
  border-color: #c9cdd4;
  color: #1f2329;
}
.src-chip.on {
  border-color: #2f6feb;
  background: #eef4ff;
  color: #2f6feb;
}
.feed {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
.empty {
  color: #8a919f;
  font-size: 12px;
  line-height: 1.6;
}
.msg {
  padding: 3px 0;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
.nick {
  color: #8a919f;
  margin-right: 6px;
}
/* 多路合并时标出这条来自哪个账号。做成低调的圆角块：
   它是「这行属于谁」的线索，不是内容本身，不该抢过正文。 */
.from {
  display: inline-block;
  max-width: 7em;
  margin-right: 5px;
  padding: 0 5px;
  overflow: hidden;
  border-radius: 3px;
  background: #f2f3f5;
  color: #646a73;
  font-size: 11px;
  vertical-align: 1px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.src-badge {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #fff1f3;
  color: #d92d20;
  font-size: 12px;
  font-weight: 400;
}
.tag {
  margin-right: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: #eef4ff;
  color: #2f6feb;
  font-size: 11px;
}
.text {
  color: #1f2329;
}
.fill-hint {
  flex: none;
  padding: 6px 12px;
  background: #f0f9f4;
  color: #12805c;
  font-size: 12px;
  border-top: 1px solid #d9f0e4;
}
/* 发布目标行。放在输入框上方而不是塞进 composer：
   一行放输入框 + 下拉 + 两个按钮会挤到没法看清账号名。 */
.target-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 0;
}
.target-label {
  flex: none;
  color: #8a919f;
  font-size: 12px;
}
.target-select {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: #1f2329;
  font-size: 12px;
}
.composer {
  display: flex;
  flex: none;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--line);
}
.composer input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  outline: none;
  font: inherit;
}
.composer button {
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
}
.composer button.publish {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}
.composer button.publish:hover:not(:disabled) {
  background: #e6254a;
  border-color: #e6254a;
}
.composer button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
