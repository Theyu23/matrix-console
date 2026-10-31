<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { CHAT_OBSERVER_SCRIPT, VIDEO_OBSERVER_SCRIPT, fillInputScript, sendCommentScript } from '../chatObserver.js'
import { commentKind, statusFor } from '../platforms.js'
import { decideCrashRetry } from '../crashGuard.js'
import { ENV_PROBE_SCRIPT } from '../envProbe.js'
import { HEALTH_PROBE_SCRIPT, isProfileUrl } from '../health.js'
import { MAX_CELLS, cellsFor, gridShape } from '../gridLayout.js'
import { isNearBottom, wallChatsFor } from '../wallChat.js'
import { safeViewUrl } from '../viewUrl.js'

const props = defineProps({
  accounts: Array,
  activeId: String,
  // none=单页（只显示 activeId），grid=分屏监看墙（同时显示所有已打开账号）
  mode: { type: String, default: 'none' },
  // id → 该账号的评论消息数组。监看墙上每格直接显示自己这条流的最新几条。
  chats: { type: Object, default: () => ({}) },
  // 监看墙里当前被选为发布目标的账号 id。
  publishTarget: { type: String, default: '' }
})
const emit = defineEmits(['status', 'navigate', 'chat', 'logout', 'close', 'restart', 'focus', 'pick'])

const views = new Map()
const manualMuted = reactive(new Set())
// 每个账号的崩溃时间戳，用于判断是否需要自动重挂。
const crashHistory = new Map()

const activeView = computed(() => props.accounts.find((a) => a.id === props.activeId) || null)

// 监看墙：同时上墙的账号，最多 MAX_CELLS 个。
// 超出的不上墙但仍在后台运行，不会因为没上墙就停止采集。
const wallAccounts = computed(() => cellsFor(props.accounts))
const shape = computed(() => gridShape(wallAccounts.value.length))
const isGrid = computed(() => props.mode === 'grid' && wallAccounts.value.length > 0)

// 一个账号此刻是否可见：单页模式下只有选中的，分屏模式下所有上墙的都可见。
function isVisible(id) {
  if (isGrid.value) return wallAccounts.value.some((a) => a.id === id)
  return id === props.activeId
}

// 监看墙上每格显示的评论：该账号自己那条流里最新的若干条。
// 为什么从尾部取而不是过滤时间：切走再切回时消息会继续累积，
// 取尾部就是「此刻最新」，比按时间窗口筛更直接。
// 取 20 条而不是 3 条，是因为评论条本身可滚动：默认露最近 3 条，
// 想看更早的直接在上面滚轮翻，不用切回单页。
function wallChats(id) {
  return wallChatsFor(props.chats, id)
}

// 监看墙评论条：默认停在最新一条，新评论进来继续贴底；
// 但用户手动往上翻时不能把他拽回底部——那是打断阅读。
const stickToBottom = new Map()
const chatEls = new Map()

function bindLines(id, el) {
  if (el) chatEls.set(id, el)
  else chatEls.delete(id)
}

function sticky(id) {
  // 没记录过的格子按「看最新」处理，上墙后才会贴底。
  return stickToBottom.get(id) !== false
}

function onLinesScroll(id, e) {
  const el = e.target
  if (!el) return
  stickToBottom.set(id, isNearBottom(el))
}

async function pinToBottom(onlySticky = true) {
  await nextTick()
  for (const [id, el] of chatEls) {
    if (onlySticky && !sticky(id)) continue
    el.scrollTop = el.scrollHeight
  }
}

// 新评论进来：只在仍贴着底的格子里继续贴底。
watch(() => props.chats, () => pinToBottom(true), { deep: true })

// 刚上墙时所有格子都先贴到底，否则默认停在最上面那几条旧的。
watch(isGrid, (grid) => {
  if (grid) pinToBottom(false)
})

function applyMute(id, el) {
  if (!el || typeof el.setAudioMuted !== 'function') return
  try {
    el.setAudioMuted(id !== props.activeId || manualMuted.has(id))
  } catch {
    // webview 尚未 ready 时忽略，后续 did-finish-load 会再调一次
  }
}

function bindView(el, id) {
  if (el) {
    views.set(id, el)
    applyMute(id, el)
  } else {
    views.delete(id)
  }
}

watch(
  () => props.activeId,
  () => {
    for (const [id, el] of views) applyMute(id, el)
  }
)

defineExpose({
  // 在单个账号页面里跑一次只读环境探测。页面没挂起来时返回 error 说明。
  async probeActive(id) {
    const el = views.get(id)
    if (!el) return { error: '页面未打开' }
    try {
      return { env: await el.executeJavaScript(ENV_PROBE_SCRIPT) }
    } catch (error) {
      return { error: error?.message ? String(error.message).slice(0, 80) : '执行失败' }
    }
  },
  // 已挂载的账号 id 列表，自检面板据此决定哪些能探。跨平台未挂载的探不了。
  listMounted() {
    return [...views.keys()]
  },
  // 巡检用：先把账号切到个人页，再数一遍登录入口和头像。只读，不点不改。
  // 切页是必要的——其他页面上的头像是作者/主播的，不代表当前账号。
  async probeHealth(id, platform) {
    const el = views.get(id)
    if (!el) return { error: '页面未打开' }
    try {
      const target = platform === 'channels'
        ? 'https://channels.weixin.qq.com/platform'
        : 'https://www.douyin.com/user/self'
      // 已经在个人页就不重复加载，省一次请求。
      const current = safeViewUrl(el)
      if (!isProfileUrl(current)) {
        await el.loadURL(target)
        // 等页面把登录入口/头像渲染出来，否则会数到 0 个元素误判。
        await new Promise((resolve) => setTimeout(resolve, 2500))
      }
      return await el.executeJavaScript(HEALTH_PROBE_SCRIPT)
    } catch {
      return { error: '页面无法执行脚本' }
    }
  },
  async fillActive(id, text) {
    const el = views.get(id)
    if (!el) return 'no-view'
    try {
      return await el.executeJavaScript(fillInputScript(text))
    } catch {
      return 'error'
    }
  },
  async publishActive(id, text) {
    const el = views.get(id)
    if (!el) return 'no-view'
    try {
      const filled = await el.executeJavaScript(fillInputScript(text))
      if (filled !== 'filled') return filled
      // 给页面框架一点时间同步输入框状态，再点发送。
      await new Promise((resolve) => setTimeout(resolve, 180))
      return await el.executeJavaScript(sendCommentScript())
    } catch {
      return 'error'
    }
  }
})

function reloadActive() {
  const el = views.get(props.activeId)
  if (!el) return
  try {
    el.reload()
  } catch {
    // 页面崩溃时 reload 可能抛错，忽略即可
  }
}

async function clearCache() {
  const id = props.activeId
  if (!id) return
  if (!window.confirm('只清理该账号的网页缓存，登录状态会保留。继续？')) return
  try {
    await window.matrix?.clearCache(`persist:acct-${id}`)
    window.alert('缓存已清理。')
  } catch {
    window.alert('清理缓存失败，请重试。')
  }
}

function toggleMute() {
  const id = props.activeId
  if (!id) return
  if (manualMuted.has(id)) manualMuted.delete(id)
  else manualMuted.add(id)
  applyMute(id, views.get(id))
}

function openDevTools() {
  const el = views.get(props.activeId)
  if (!el) return
  try {
    el.openDevTools()
  } catch {
    // 页面尚未 ready
  }
}

function requestLogout() {
  if (props.activeId) emit('logout', props.activeId)
}

function requestClose() {
  if (props.activeId) emit('close', props.activeId)
}

function onStartLoading(acct, e) {
  // did-start-loading 可能早于 dom-ready：此时 e.target.getURL() 会抛
  // "The WebView must be attached to the DOM..."，把整个回调打断。
  emit('status', {
    id: acct.id,
    status: 'loading',
    url: safeViewUrl(e.target, acct.currentUrl)
  })
}

// 按页面类型注入对应的只读观察器。直播间和视频页是两套节点结构，选择器不能混用。
// 同一个页面可能被注入多次（SPA 内跳转、刷新），脚本内部有 flag 防重入。
function installObserver(target, url) {
  const kind = commentKind(url)
  if (!kind) return
  const script = kind === 'video' ? VIDEO_OBSERVER_SCRIPT : CHAT_OBSERVER_SCRIPT
  target.executeJavaScript(script).catch(() => {})
}

function onLoad(acct, e) {
  const url = safeViewUrl(e.target, acct.currentUrl)
  const status = statusFor(acct, url)
  emit('status', { id: acct.id, status, url })
  applyMute(acct.id, e.target)
  installObserver(e.target, url)
}

function onFail(acct, e) {
  // -3 是 ERR_ABORTED（切页时正常出现）；子 frame 失败不应把整个账号标离线。
  if (e.errorCode === -3 || e.isMainFrame === false) return
  emit('status', {
    id: acct.id,
    status: 'offline',
    url: e.validatedURL || safeViewUrl(e.target, acct.currentUrl)
  })
}

function onNavigate(acct, e) {
  const url = e.url || safeViewUrl(e.target, acct.currentUrl)
  emit('status', { id: acct.id, status: statusFor(acct, url), url })
  emit('navigate', { id: acct.id, url })
}

function onNavigateInPage(acct, e) {
  if (e.isMainFrame === false) return
  // 从站内其他页面 SPA 跳进直播间/视频页时，did-finish-load 不会再触发一次，
  // 所以这里要按新 URL 重新判断该挂哪个观察器。
  installObserver(e.target, e.url)
  onNavigate(acct, e)
}

// 渲染进程崩溃：窗口期内第一次自动重挂，同一窗口内再崩就放弃并报离线。
// 之前只标 offline，页面一直空着，用户得手动重开；长时挂直播间时这是常态故障。
function onCrash(acct) {
  const history = crashHistory.get(acct.id) || []
  const { retry, recent, count } = decideCrashRetry(history, Date.now())
  crashHistory.set(acct.id, recent)

  if (retry) {
    emit('status', { id: acct.id, status: 'loading', url: acct.currentUrl })
    // 换 key 让 Vue 重新挂一个新的 webview：崩溃的实例已经不可用，
    // 在上面调 reload() 没有意义。
    emit('restart', { id: acct.id })
    return
  }

  console.warn(`账号 ${acct.id} 在 3 分钟内崩溃 ${count} 次，停止自动重挂`)
  emit('status', {
    id: acct.id,
    status: 'offline',
    url: acct.currentUrl
  })
}

function onConsole(acct, e) {
  const msg = e.message || ''
  if (!msg.startsWith('__MATRIX_CHAT__')) return
  try {
    const data = JSON.parse(msg.slice('__MATRIX_CHAT__'.length))
    const text = typeof data.text === 'string' ? data.text.trim().slice(0, 500) : ''
    if (!text) return
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim().slice(0, 60) : ''
    const ts = Number(data.ts)
    // kind 由注入脚本给出：live=直播间聊天区，video=视频评论区。
    // 页面可以声称自己是任何类型，但它只影响展示标签，不参与任何权限判断。
    const kind = data.kind === 'video' ? 'video' : data.kind === 'live' ? 'live' : ''
    // 强制使用当前 webview 的账号 id；页面传入的 id 一律不信任。
    emit('chat', {
      id: acct.id,
      kind,
      nickname,
      text,
      ts: Number.isFinite(ts) ? ts : Date.now()
    })
  } catch {
    // 忽略格式异常
  }
}
</script>

<template>
  <section class="pane">
    <div v-if="activeView && !isGrid" class="toolbar">
      <span class="addr" :title="activeView.currentUrl || '未加载'">
        {{ activeView.currentUrl || '未加载' }}
      </span>
      <button @click="reloadActive">刷新</button>
      <button title="只清网页缓存，保留登录状态" @click="clearCache">清缓存</button>
      <button @click="toggleMute">
        {{ manualMuted.has(activeId) ? '取消静音' : '静音' }}
      </button>
      <button @click="openDevTools">开发者工具</button>
      <button title="关闭页面但保留登录状态" @click="requestClose">关闭页面</button>
      <button class="danger" @click="requestLogout">退出登录</button>
    </div>

    <div v-if="!activeView && !isGrid" class="placeholder">
      <p v-if="activeId">该账号尚未打开，请先点击“批量扫码登录”或“打开链接”。</p>
      <p v-else>从左侧选择一个账号，或勾选后点“批量扫码登录”。</p>
    </div>

    <!--
      所有已打开账号的 webview 都常驻并叠在同一位置，绝不因为切换视图而重新挂载。
      不用 v-show / display:none：那会让隐藏的 webview 整片停止渲染，切回来要重排。
      也不用容器滚动定位：webview 在挂载瞬间 offsetHeight 常为 0，量出来就失效。
      单页模式用绝对定位堆叠 + visibility；分屏模式只改同一批元素的 grid 定位，
      元素本身不换父节点，所以切布局不会触发任何页面重载。
    -->
    <div
      class="stack"
      :class="{ grid: isGrid }"
      :style="isGrid ? { gridTemplateColumns: `repeat(${shape.cols}, 1fr)` } : null"
    >
      <webview
        v-for="a in accounts"
        :key="a.id + ':' + a.navSeq"
        :ref="(el) => bindView(el, a.id)"
        :partition="`persist:acct-${a.id}`"
        :src="a.url"
        class="view"
        :class="{ current: isVisible(a.id), cell: isGrid }"
        @did-start-loading="onStartLoading(a, $event)"
        @did-finish-load="onLoad(a, $event)"
        @did-fail-load="onFail(a, $event)"
        @did-navigate="onNavigate(a, $event)"
        @did-navigate-in-page="onNavigateInPage(a, $event)"
        @render-process-gone="onCrash(a, $event)"
        @console-message="onConsole(a, $event)"
      />
      <!--
        分屏时每格右下角贴一条账号条，点一下把该账号放大成单页。
        单独一层覆盖：用同一套列数铺在 webview 之上，pointer-events 只在条自身上开启，
        不挡页面本身的点击。webview 是独立元素，不能当容器塞子节点。
      -->
      <div
        v-if="isGrid"
        class="labels"
        :style="{ gridTemplateColumns: `repeat(${shape.cols}, 1fr)` }"
      >
        <div
          v-for="a in wallAccounts"
          :key="'label-' + a.id"
          class="cell-label"
          :class="{ active: a.id === activeId, picked: a.id === publishTarget }"
          :title="`点一下把「${a.nickname}」设为发布目标`"
          @click="emit('pick', a.id)"
        >
          <span class="dot" :class="a.status" />
          <span class="name">{{ a.nickname }}</span>
          <span
            class="zoom"
            title="放大成单页"
            @click.stop="emit('focus', a.id)"
          >⤢</span>
        </div>
      </div>

      <!--
        每格底部叠最近几条评论。分屏时页面缩略到一个格子里，
        评论本身小到看不清，把最新几条摘出来单独排在上面才有用。
        覆盖层和 labels 一样只用 pointer-events: none 的容器包着，
        不挡页面本身的点击。
      -->
      <div
        v-if="isGrid"
        class="wall-chats"
        :style="{ gridTemplateColumns: `repeat(${shape.cols}, 1fr)` }"
      >
        <div v-for="a in wallAccounts" :key="'chat-' + a.id" class="wall-chat">
          <div
            v-if="wallChats(a.id).length"
            :ref="(el) => bindLines(a.id, el)"
            class="lines"
            :data-wall-chat="a.id"
            @scroll="onLinesScroll(a.id, $event)"
          >
            <div v-for="(m, i) in wallChats(a.id)" :key="m.ts + '-' + i" class="line">
              <span v-if="m.nickname" class="nick">{{ m.nickname }}：</span>{{ m.text }}
            </div>
          </div>
          <p v-else class="none">暂无评论</p>
        </div>
      </div>
    </div>

    <p v-if="isGrid && shape.hidden > 0" class="wall-note">
      还有 {{ shape.hidden }} 个账号未上墙（最多同时监看 {{ MAX_CELLS }} 个），它们仍在后台运行。
    </p>
  </section>
</template>

<style scoped>
.pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #f5f6f7;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  flex: none;
  align-items: center;
  gap: 8px;
  row-gap: 6px;
  padding: 6px 10px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.addr {
  flex: 1 1 180px;
  min-width: 0;
  overflow: hidden;
  color: #646a73;
  font-size: 12px;
  text-overflow: ellipsis;
  user-select: text;
  white-space: nowrap;
}
.toolbar button {
  flex: none;
  padding: 4px 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  color: #1f2329;
  font-size: 12px;
  white-space: nowrap;
}
.toolbar button:hover {
  border-color: #c9cdd4;
  background: #f8f9fa;
}
.toolbar button.danger {
  border-color: #f3c6c3;
  color: #d92d20;
}
/*
  绝对定位堆叠：所有账号页占满同一块区域，只有 .current 可见且接收事件。
  隐藏页用 visibility:hidden 而不是 display:none，保证它仍在正常渲染
  （直播间心跳、评论流采集都不会因为切走而中断）。
*/
.stack {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.view {
  position: absolute;
  inset: 0;
  display: flex;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
  visibility: hidden;
  pointer-events: none;
}
.view.current {
  visibility: visible;
  pointer-events: auto;
}

/*
  分屏模式：同一批 webview 从绝对定位改成 grid 单元。
  它们仍然是 visibility:hidden 的默认值，只有 .current（上墙的那些）可见，
  所以这里不需要为「上墙但非 active」单独开一条规则——isVisible() 已经把
  所有上墙账号都算成 current。
*/
.stack.grid {
  display: grid;
  gap: 1px;
  background: var(--line);
}
.stack.grid .view {
  position: relative;
  inset: auto;
}

/* 账号条覆盖层：和 webview 同一套栅格，逐格对齐，只让条本身可点。 */
.labels {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 1px;
  pointer-events: none;
}
.cell-label {
  display: flex;
  align-items: center;
  align-self: start;
  justify-self: start;
  gap: 5px;
  max-width: 100%;
  margin: 6px 0 0 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(20, 22, 26, 0.62);
  color: #fff;
  font-size: 11px;
  line-height: 1.6;
  pointer-events: auto;
  cursor: pointer;
}
.cell-label:hover {
  background: rgba(20, 22, 26, 0.82);
}
.cell-label.active {
  background: var(--brand);
}
/* 被选为发布目标的那一格。用一圈亮边而不是换底色：
   底色已经被 active（当前单页账号）占用了，两个信号得能同时看清。 */
.cell-label.picked {
  box-shadow: 0 0 0 2px #ffd666, 0 0 0 4px rgba(0, 0, 0, 0.35);
}
.cell-label.picked .name::after {
  content: ' 发布到';
  color: #ffd666;
  font-size: 10px;
}
.cell-label .zoom {
  flex: none;
  padding: 0 2px;
  opacity: 0.72;
  font-size: 12px;
}
.cell-label .zoom:hover {
  opacity: 1;
}
.cell-label .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #b0b6bf;
}
.dot.online {
  background: #3ecf8e;
}
.dot.watching {
  background: #6aa8ff;
}
.dot.loading,
.dot.qr {
  background: #ffb648;
}
.dot.offline {
  background: #ff6b5e;
}
.wall-note {
  flex: none;
  margin: 0;
  padding: 5px 10px;
  background: #fff4e5;
  color: #b76e00;
  font-size: 11px;
  border-top: 1px solid var(--line);
}

/* 每格底部的评论条：只占下方一小块，不吃掉整格的可视面积。 */
.wall-chats {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 1px;
  pointer-events: none;
}
.wall-chat {
  display: flex;
  align-self: end;
  flex-direction: column;
  justify-content: flex-end;
  max-height: 62%;
  min-height: 0;
  padding: 0 6px 6px;
  overflow: hidden;
}
/*
  评论条自己接滚轮：默认滚到最新一条，往上滚可以看更早的。
  pointer-events 只为这一层重新打开——否则整条覆盖层会挡住页面点击。
  滚动条收窄到 4px，九宫格里不给它抢地方。
*/
.lines {
  max-height: 100%;
  padding: 5px 7px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 6px;
  background: rgba(20, 22, 26, 0.62);
  color: #fff;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: auto;
  scrollbar-width: thin;
}
.lines::-webkit-scrollbar {
  width: 4px;
}
.lines::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.35);
}
.line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.line .nick {
  margin-right: 2px;
  color: #b8c4d4;
  font-weight: 600;
}
.none {
  margin: 0;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(20, 22, 26, 0.42);
  color: #d5dae2;
  font-size: 11px;
  line-height: 1.5;
}
.placeholder {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 24px;
  color: #8a919f;
  text-align: center;
}
</style>
