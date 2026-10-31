<script setup>
import { computed, ref, watch } from 'vue'
import { parsePhrases, serializePhrases } from '../phrases.js'
import {
  PLACEHOLDERS,
  buildContext,
  createRotator,
  nextGroupName,
  renderPhrase
} from '../phraseFill.js'

const props = defineProps({
  platformLabel: String,
  accountCount: Number,
  selectedCount: Number,
  syncEnabled: Boolean,
  chatOpen: Boolean,
  envOpen: Boolean,
  wallOpen: Boolean,
  healthRunning: Boolean,
  healthSummary: { type: Object, default: () => ({ total: 0, ok: 0, expired: 0, unknown: 0 }) },
  tierSummary: { type: Object, default: () => ({ total: 0, main: 0, spare: 0 }) },
  egressSummary: {
    type: Object,
    default: () => ({ total: 0, unconfigured: 0, isolated: 0, shared: 0, egressCount: 0 })
  },
  measuredEgress: {
    type: Object,
    default: () => ({
      total: 0, probed: 0, failed: 0, unprobed: 0, direct: 0,
      distinct: 0, measuredIsolated: 0, sharedIps: [], proxyDead: [], rows: []
    })
  },
  egressMeasuredText: { type: String, default: '' },
  probing: Boolean,
  probedAt: { type: String, default: '' },
  lastSpeaker: { type: String, default: '' },
  openPending: { type: Number, default: 0 }
})

// 出口提示：把「有几个还在共用本机 IP」说清楚。
// 这是隔离里最容易被忽略、也最影响结果的一项。
//
// 配了代理不算数。这里的 title 分两段：
//   前半段是配置（有几个账号配了独立代理）
//   后半段是实测（对方实际看到的 IP 是什么）
// 两者不一致时，以实测为准——平台看到的也只有实测这一份。
const egressTitle = computed(() => {
  const s = props.egressSummary || {}
  const parts = [`配置：独立出口 ${s.isolated || 0} 个 / 共 ${s.total || 0} 个账号`]
  if (s.unconfigured) parts.push(`${s.unconfigured} 个未配代理`)
  if (s.shared) parts.push(`${s.shared} 条代理被多个账号共用`)
  if (props.egressMeasuredText) parts.push(`实测：${props.egressMeasuredText}`)
  if (props.probedAt) parts.push(`（${props.probedAt}）`)
  return parts.join('；')
})

// 实测里最该让人看到的那一条：配了代理，出口却还是本机 IP。
// 这种情况界面上的「独立出口」会显示得很正常，实际完全没有隔离。
const egressAlert = computed(() => {
  const m = props.measuredEgress || {}
  if (m.proxyDead && m.proxyDead.length) {
    return `代理未生效：${m.proxyDead.map((x) => x.name).join('、')}`
  }
  if (m.sharedIps && m.sharedIps.length) {
    const top = m.sharedIps[0]
    return `${top.count} 个账号共用出口 ${top.ip}`
  }
  return ''
})
defineEmits([
  'add',
  'login',
  'select-all',
  'clear',
  'open-live',
  'remove',
  'toggle-sync',
  'toggle-chat',
  'toggle-env',
  'toggle-wall',
  'check-health',
  'probe-egress',
  'export'
])

const liveUrl = ref('')

const PH_KEY = 'matrix.phrases'
const showPhrases = ref(false)
const phrasesText = ref(localStorage.getItem(PH_KEY) ?? ['主播好棒', '支持一下', '666'].join('\n'))
const copied = ref('')
const phraseGroups = computed(() => parsePhrases(phrasesText.value))
const phrases = computed(() => phraseGroups.value.flatMap((g) => g.items))

// 占位符上下文：昵称可以从评论流里带过来，也可以手填。
const PH_NICK_KEY = 'matrix.phraseNickname'
const nickname = ref(localStorage.getItem(PH_NICK_KEY) ?? '')
const rotator = createRotator()
// 分组轮换游标，和 rotator 内部的条目游标是两回事：
// 前者决定「这一轮用哪个分组」，后者决定「这个分组取到第几条」。
const groupCursor = ref(0)
const lastRendered = ref('')

watch(nickname, (v) => localStorage.setItem(PH_NICK_KEY, v))

function currentContext() {
  // 手填的昵称优先；没填就用评论流里最近一个发言者。
  return buildContext({ nickname: nickname.value || props.lastSpeaker })
}

// 评论流里出现新发言者时，如果用户没手填昵称，就跟着最新那个人。
watch(
  () => props.lastSpeaker,
  (v) => {
    if (v && !nickname.value) nickname.value = v
  }
)

// 按「分组轮换 → 组内按序取用 → 占位符填充」取出一条。
// 用 nextPhrase(false) 只预览，用 nextPhrase(true) 才推进游标。
function pickPhrase({ advance = true } = {}) {
  const groups = phraseGroups.value.filter((g) => g.items.length)
  if (!groups.length) return ''
  const groupName = nextGroupName(groups, { groupCursor: groupCursor.value })
  const group = groups.find((g) => g.name === groupName)
  if (!group) return ''
  let raw
  if (advance) {
    raw = rotator.next(group.name, group.items)
    groupCursor.value = (groupCursor.value + 1) % groups.length
  } else {
    // 预览不推进游标：连点预览应该看到同一条，点「下一条」才换。
    raw = group.items[rotator.cursorOf(group.name) % group.items.length]
  }
  return renderPhrase(raw, currentContext())
}

function nextPhrase() {
  const text = pickPhrase({ advance: true })
  if (!text) return
  lastRendered.value = text
  copyPhrase(text)
}

function savePhrases() {
  localStorage.setItem(PH_KEY, phrasesText.value)
}

// 把输入框整理成“分组 + 去重 + 去空行”的规范格式；顺序保持输入顺序。
function tidyPhrases() {
  phrasesText.value = serializePhrases(parsePhrases(phrasesText.value))
  savePhrases()
}

async function copyPhrase(p) {
  try {
    await navigator.clipboard.writeText(p)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = p
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copied.value = p
  setTimeout(() => (copied.value = ''), 1500)
}

function copyRandom() {
  if (!phrases.value.length) return
  copyPhrase(phrases.value[Math.floor(Math.random() * phrases.value.length)])
}
</script>

<template>
  <header class="bar">
    <strong class="title">{{ platformLabel }}</strong>
    <span v-if="openPending" class="queue" title="页面按并发上限依次打开，加载完再放下一条">
      正在打开 {{ openPending }} 个…
    </span>
    <button @click="$emit('add')">添加账号</button>
    <span
      v-if="tierSummary.total"
      class="tier-tally"
      :title="`主力 ${tierSummary.main} 个：优先上墙、巡检更勤、批量操作默认跳过`"
    >
      主力 {{ tierSummary.main }} / 备用 {{ tierSummary.spare }}
    </span>
    <span
      v-if="egressSummary.total"
      class="egress-tally"
      :class="{ warn: egressSummary.unconfigured > 0 || egressSummary.shared > 0 || egressAlert }"
      :title="egressTitle"
    >
      出口 {{ measuredEgress.probed ? measuredEgress.distinct : egressSummary.isolated }} / {{ egressSummary.total }}
    </span>
    <button
      v-if="egressSummary.total"
      class="probe-egress"
      :disabled="probing"
      :title="egressTitle"
      @click="$emit('probe-egress')"
    >
      {{ probing ? '实测中…' : (probedAt ? '重测出口' : '实测出口') }}
    </button>
    <span v-if="egressAlert" class="egress-alert" :title="egressTitle">{{ egressAlert }}</span>
    <button :disabled="!selectedCount" @click="$emit('login')">批量扫码登录</button>
    <button :disabled="!accountCount" @click="$emit('select-all')">全选</button>
    <button :disabled="!selectedCount" @click="$emit('clear')">清空选择</button>
    <button @click="showPhrases = !showPhrases">话术</button>
    <button title="导出账号清单（不含 Cookie/登录状态）" @click="$emit('export')">
      导出账号
    </button>
    <button :class="{ on: chatOpen }" @click="$emit('toggle-chat')">评论流</button>
    <button
      :class="{ on: wallOpen }"
      title="同时监看多个账号页面，点某一格放大成单页"
      @click="$emit('toggle-wall')"
    >
      监看墙
    </button>
    <button
      :class="{ on: envOpen }"
      title="只读比对各账号的浏览器环境，不改任何值"
      @click="$emit('toggle-env')"
    >
      环境自检
    </button>
    <button
      :disabled="healthRunning"
      :title="healthSummary.total ? `在线 ${healthSummary.ok}，失效 ${healthSummary.expired}，待确认 ${healthSummary.unknown}` : '在各自分区里查一次登录态，只看是否被踢下线'"
      @click="$emit('check-health')"
    >
      {{ healthRunning ? '巡检中…' : '巡检登录态' }}
    </button>
    <label class="sync">
      <input
        type="checkbox"
        :checked="syncEnabled"
        @change="$emit('toggle-sync', $event.target.checked)"
      />
      同步跳转
    </label>
    <span class="spacer" />
    <input
      v-model.trim="liveUrl"
      class="url"
      placeholder="直播间或视频 URL，如 https://live.douyin.com/123456"
      @keyup.enter="liveUrl && $emit('open-live', liveUrl)"
    />
    <button
      :disabled="!selectedCount || !liveUrl"
      :title="selectedCount ? '' : '先在列表里勾选账号'"
      @click="$emit('open-live', liveUrl)"
    >
      打开链接
    </button>
    <button class="danger" :disabled="!selectedCount" @click="$emit('remove')">移除选中</button>

    <div v-if="showPhrases" class="phrase-panel">
      <div v-for="(g, gi) in phraseGroups" :key="gi" class="phrase-group">
        <span v-if="phraseGroups.length > 1" class="group-name">{{ g.name }}</span>
        <div class="phrase-chips">
          <button
            v-for="p in g.items"
            :key="p"
            class="chip"
            :class="{ done: copied === p }"
            @click="copyPhrase(p)"
          >
            {{ copied === p ? '已复制' : p }}
          </button>
        </div>
      </div>
      <span v-if="!phrases.length" class="hint">在下面每行输入一条话术</span>
      <div class="phrase-actions">
        <button
          class="chip primary"
          :disabled="!phrases.length"
          title="按分组顺序取一条，填好占位符并复制"
          @click="nextPhrase"
        >
          下一条（轮换）
        </button>
        <button class="chip" :disabled="!phrases.length" @click="copyRandom">
          随机一条
        </button>
        <button class="chip" :disabled="!phrasesText.trim()" @click="tidyPhrases">
          整理去重
        </button>
      </div>
      <label class="nick-row">
        <span>{昵称} 填成</span>
        <input v-model.trim="nickname" :placeholder="lastSpeaker || '留空则去掉该占位符'" />
        <button
          v-if="lastSpeaker"
          class="chip tiny"
          title="用评论流里最近一个发言者"
          @click="nickname = lastSpeaker"
        >
          用最新
        </button>
      </label>
      <p v-if="lastRendered" class="last">
        刚取出：<code>{{ lastRendered }}</code>
      </p>
      <p class="hint placeholders">
        占位符：
        <code v-for="p in PLACEHOLDERS" :key="p.key" :title="p.desc">{{ p.key }}</code>
      </p>
      <textarea
        v-model="phrasesText"
        rows="5"
        placeholder="每行一条话术；以 # 开头表示分组，如 #开场"
        @input="savePhrases"
      />
      <p class="hint">
        #分组名 分组，重复话术只保留一次；「下一条」按分组顺序轮换、组内逐条取用，
        不会连着抽到同一条
      </p>
    </div>
  </header>
</template>

<style scoped>
.bar {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  row-gap: 8px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.phrase-panel {
  position: absolute;
  top: 100%;
  left: 12px;
  z-index: 10;
  width: 400px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.chip.primary {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}
.chip.primary:hover:not(:disabled) {
  background: #e6254a;
  border-color: #e6254a;
}
.chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.nick-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
  color: #646a73;
  font-size: 12px;
}
.nick-row span {
  flex: none;
  white-space: nowrap;
}
.chip.tiny {
  flex: none;
  padding: 2px 6px;
  font-size: 11px;
}
.nick-row input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 5px;
  font: inherit;
  font-size: 12px;
}
.last {
  margin: 4px 0 6px;
  color: #12805c;
  font-size: 12px;
  word-break: break-all;
}
.last code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f0f9f4;
}
.placeholders {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.placeholders code {
  padding: 1px 5px;
  border-radius: 3px;
  background: #eef1f5;
  color: #1f2329;
  font-size: 11px;
}
.phrase-group {
  margin-bottom: 6px;
}
.group-name {
  display: block;
  margin-bottom: 4px;
  color: #8a919f;
  font-size: 12px;
}
.phrase-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.chip {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #f8f9fa;
  font-size: 13px;
}
.chip:hover:not(:disabled) {
  border-color: #c9cdd4;
}
.chip.done {
  background: #e8f7ee;
  border-color: #b7e4c9;
  color: #12805c;
}
.phrase-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.chip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.phrase-panel textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  outline: none;
  resize: vertical;
  font: inherit;
}
.hint {
  margin: 6px 0 0;
  color: #8a919f;
  font-size: 12px;
}
.title {
  flex: none;
  margin-right: 4px;
  font-size: 15px;
  white-space: nowrap;
}
.queue {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fff4e5;
  color: #b76e00;
  font-size: 12px;
  white-space: nowrap;
}
.tier-tally {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f7f8fa;
  color: #646a73;
  font-size: 12px;
  white-space: nowrap;
}
.egress-tally {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef4ff;
  color: #2f6feb;
  font-size: 12px;
  white-space: nowrap;
}
/* 还有账号共用本机 IP 时转成警示色：这是隔离没做完，不是正常状态。 */
.egress-tally.warn {
  background: #fff4e5;
  color: #b76e00;
}
/* 实测按钮：和普通操作按钮分开，它是诊断动作，不是日常操作。 */
.probe-egress {
  flex: none;
  padding: 2px 8px;
  border: 1px solid #d0d5dd;
  border-radius: 999px;
  background: #fff;
  color: #646a73;
  font-size: 12px;
  line-height: 1.6;
  cursor: pointer;
  white-space: nowrap;
}
.probe-egress:hover:not(:disabled) {
  border-color: #2f6feb;
  color: #2f6feb;
}
.probe-egress:disabled {
  opacity: 0.6;
  cursor: default;
}
/* 实测出来的硬结论。这是最该被看见的一行：配置正常但代理没生效，
   或者多个账号挤在同一个 IP 上。 */
.egress-alert {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: #ffece8;
  color: #d4380d;
  font-size: 12px;
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1 1 0;
  min-width: 0;
}
.sync {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  color: #646a73;
  font-size: 13px;
  white-space: nowrap;
}
.url {
  flex: 1 1 260px;
  width: auto;
  min-width: 200px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  outline: none;
}
.bar > button {
  flex: none;
  white-space: nowrap;
}
button {
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: #1f2329;
}
button:hover:not(:disabled) {
  border-color: #c9cdd4;
  background: #f8f9fa;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.danger {
  border-color: #f3c6c3;
  color: #d92d20;
}
button.on {
  border-color: var(--brand);
  color: var(--brand);
}
</style>
