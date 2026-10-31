<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import Sidebar from './components/Sidebar.vue'
import ActionBar from './components/ActionBar.vue'
import AccountList from './components/AccountList.vue'
import BrowserPane from './components/BrowserPane.vue'
import ChatPanel from './components/ChatPanel.vue'
import EnvPanel from './components/EnvPanel.vue'
import Splitter from './components/Splitter.vue'
import {
  MIN_STAGE,
  SPLITS,
  fitWidth,
  loadLayout,
  saveLayout
} from './splitter.js'

// 三条分隔条各 7px 的固定占位，算可用宽度时要扣掉。
const SPLITTER_TOTAL = 3 * 7
import { PLATFORMS, STORAGE_KEY, normalizeUrl } from './platforms.js'
import { OPEN_SLOT_TIMEOUT, createOpenQueue } from './openQueue.js'
import { jitter, sleep, staggerDelay } from './jitter.js'
import { summarizeEnv } from './envProbe.js'
import { lastSpeakerOf, mergeChats, pickScope, streamTargets, summarizeSources } from './mergedChat.js'
import { resolveTarget, pageKindLabel } from './publishTarget.js'
import {
  appendSnapshot,
  compareWithLatest,
  loadSnapshots,
  saveSnapshots
} from './envSnapshot.js'
import {
  HEALTH_DEFAULT_INTERVAL,
  parseHealthOutcome,
  pickTargets,
  shouldCheck,
  summarizeHealth
} from './health.js'
import {
  includeInBatch,
  intervalFor,
  nextTier,
  normalizeTier,
  summarizeTiers,
  TIER_INTERVAL
} from './tiers.js'
import {
  buildProfile,
  loadProfiles,
  parseProxy,
  presetByKey,
  refreshProfile,
  saveProfiles,
  summarizeEgress
} from './isolation.js'
import { summarizeMeasured, measuredVerdict } from './egress.js'

// 访问 localStorage 可能抛（隐私模式、配额满）。快照不是关键数据，取不到就用空的。
function safeStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// ── 分栏宽度 ──────────────────────────────────────────────
// 三块侧栏都可拖动，宽度落盘，下次打开还是你拖好的样子。
const layout = reactive(loadLayout(safeStorage()))
const workspaceRef = ref(null)

// 把某一块的宽度夹到当前窗口放得下的范围。拖动时窗口可能同时被缩，
// 不夹回来就会出现「分栏总宽 > 可用宽度」，中间的网页区被挤成 0。
function applySplit(key, width) {
  const spec = SPLITS[key]
  const avail = workspaceRef.value ? workspaceRef.value.clientWidth : window.innerWidth
  const others = Object.entries(SPLITS)
    .filter(([k]) => k !== key)
    .reduce((sum, [k, s]) => {
      // 只有显示了的面板才占宽度，没开的不算。
      if (k === 'chat' && !showChat.value) return sum
      if (k === 'env' && !showEnv.value) return sum
      return sum + (layout[k] ?? s.def)
    }, 0)
  layout[key] = fitWidth(width, spec, avail, others + SPLITTER_TOTAL, MIN_STAGE)
}

function commitLayout() {
  saveLayout(safeStorage(), layout)
}

// 开关面板、窗口缩放后都要重新夹一次，否则会留下放不下的旧宽度。
function refitAll() {
  for (const key of Object.keys(SPLITS)) {
    if (key === 'chat' && !showChat.value) continue
    if (key === 'env' && !showEnv.value) continue
    applySplit(key, layout[key])
  }
}

let resizeTimer = null
function onWindowResize() {
  // 窗口拖动会连发大量事件，节流到停手后再算，避免每帧都触发重排。
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(refitAll, 120)
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  refitAll()
})

onBeforeUnmount(() => {
  clearTimeout(resizeTimer)
  window.removeEventListener('resize', onWindowResize)
})

const accounts = reactive(loadAccounts())
const activeTab = ref('douyin')

// ── 隔离状态 ──────────────────────────────────────────────
// 浏览器版本从 UA 里取，取不到就用 Electron 给的运行时版本。
// 画像里的 UA 必须和实际运行时一致，否则 sec-ch-ua 会露出矛盾。
const CHROME_VERSION = (() => {
  const fromUA = /Chrome\/([\d.]+)/.exec(navigator.userAgent || '')
  return fromUA ? fromUA[1] : ''
})()

const profiles = reactive(loadProfiles(safeStorage()))
const envError = ref('')
const selected = reactive(new Set())
const activeId = ref(null)
const syncFollow = ref(false)
const showChat = ref(false)
const showEnv = ref(false)
// wall=分屏监看墙，single=单页。切墙不销毁 webview，只改 CSS 布局。
const viewMode = ref('single')

// 面板开关会改变占宽，重算一次（必须在 showChat/showEnv 之后注册）。
watch([showChat, showEnv], async () => {
  await nextTick()
  refitAll()
})
const envProbing = ref(false)
const envRows = ref([])
// 每个账号的环境快照历史。用途是对照「掉线前环境变过没有」，不改任何值。
const envSnapshots = reactive(loadSnapshots(safeStorage()))
// 巡检：每个账号最近一次结果，以及上一次巡检的时间。
const health = reactive({})
const healthRunning = ref(false)
let healthLastRun = 0
let healthTimer = null
// 定时器的最低间隔取两档里更勤的那个，保证主力账号的间隔能真正生效。
const HEALTH_TIER_FLOOR = Math.min(TIER_INTERVAL.main, TIER_INTERVAL.spare)
const search = ref('')
const chats = reactive({})
const browserPane = ref(null)
const publishing = ref(false)
const fillHint = ref('')
// 批量打开的并发闸门：同时最多 3 个页面在加载，其余排队。
// openPending 只用于界面显示进度，真正按 id 占位的是队列内部状态。
const openQueue = createOpenQueue({ onDispatch: dispatchOpen })
const openPending = ref(0)
const slotTimers = new Map()
let fillHintTimer = null

const activeAccount = computed(() => accounts.find((a) => a.id === activeId.value) || null)

const tabAccounts = computed(() => accounts.filter((a) => a.platform === activeTab.value))
const visibleAccounts = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return tabAccounts.value
  return tabAccounts.value.filter((a) => String(a.nickname || '').toLowerCase().includes(q))
})
// 所有平台已打开的页面都保留，切 tab 只切换可见性，不销毁登录/直播状态。
// 但只有当前平台的账号挂 webview：跨平台实例同时常驻会把内存吃满，
// 抖音和视频号的会话本来就不通用，切 tab 时另一个平台的页面重新加载代价可接受。
const paneAccounts = computed(() => accounts.filter((a) => a.opened && a.platform === activeTab.value))

// ── 评论流：单页看一路，监看墙看多路 ────────────────────
// 墙上同时开着一堆视频时，逐个盯格子里的评论条看不清。
// 这里把墙上所有账号的评论按时间合并成一条流，每条标出来源。
const streamAccounts = computed(() =>
  streamTargets({
    accounts: paneAccounts.value,
    activeId: activeId.value,
    gridMode: viewMode.value === 'wall'
  })
)
// 点某个来源标签可以只看那一路；再点一次回到全看。
// 只影响这个面板，不动账号列表的勾选——勾选归批量操作管。
const streamFocus = ref('')
const focusedStream = computed(() => pickScope(streamAccounts.value, streamFocus.value))
// 头部来源标签。用账号 id 而不是名字标识，重名账号也能分辨。
const streamSources = computed(() =>
  streamAccounts.value.map((a) => ({ id: a.id, name: String(a.nickname || '账号') }))
)
// 各账号的页面类型，用于在发布目标里标出「直播 / 视频 / 平台页 / 非评论页」。
// 用 currentUrl 判定而不是配置的 url：用户可能在页面里点了跳转。
const streamPageKinds = computed(() => {
  const out = {}
  for (const a of streamAccounts.value) out[a.id] = pageKindLabel(a)
  return out
})

// ── 发布目标 ────────────────────────────────────────────
// 墙上被点选的那一格就是发布对象。空表示还没点过，退回第一个可见账号。
// 不直接用 activeId：监看墙里 activeId 是「上次单页看的那个」，
// 和「此刻想发给谁」是两件事。
const wallTarget = ref('')
const publishTargetId = computed(() =>
  resolveTarget({
    accounts: streamAccounts.value,
    activeId: activeId.value,
    wallTarget: wallTarget.value,
    gridMode: viewMode.value === 'wall'
  })
)
// 墙上那一格被关掉或换掉后必须放弃它：否则确认框里写着甲的名字、
// 实际发到别处。清空后由 resolveTarget 退回第一个可见账号。
watch(streamAccounts, (list) => {
  if (wallTarget.value && !list.some((a) => a.id === wallTarget.value)) wallTarget.value = ''
})
function pickPublishTarget(id) {
  if (!id) return
  wallTarget.value = id
  // 单页模式下也让 activeId 跟上，避免「下拉选了 A 却发给 B」。
  if (viewMode.value !== 'wall') activeId.value = id
}
function focusStream(id) {
  if (!id || !streamAccounts.value.some((a) => a.id === id)) return
  streamFocus.value = streamFocus.value === id ? '' : id
}
// 关掉页面 / 切平台后 focus 可能指向不存在的账号，清掉避免面板空着。
watch(streamAccounts, (list) => {
  if (streamFocus.value && !list.some((a) => a.id === streamFocus.value)) streamFocus.value = ''
})
const activeChats = computed(() => mergeChats(chats, focusedStream.value))
const streamLabel = computed(() => summarizeSources(focusedStream.value))
// 评论流里最近一个有昵称的发言者，给话术的 {昵称} 用。
const lastSpeaker = computed(() => lastSpeakerOf(activeChats.value))

const platformLabel = computed(() => PLATFORMS.find((p) => p.key === activeTab.value)?.label ?? '')
const loginUrl = computed(() => PLATFORMS.find((p) => p.key === activeTab.value)?.loginUrl ?? '')

function loadAccounts() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(saved)) return []
    return saved
      .filter((a) => a && typeof a.id === 'string' && PLATFORMS.some((p) => p.key === a.platform))
      .map((a) => ({
        id: a.id,
        platform: a.platform,
        nickname: typeof a.nickname === 'string' ? a.nickname : '账号',
        // 老数据没有 tier，归一成 spare，别留 undefined。
        tier: normalizeTier(a.tier),
        // 出口代理，未配则为空。这是隔离里最有效的一层。
        proxy: typeof a.proxy === 'string' ? a.proxy : '',
        status: 'idle',
        opened: false,
        url: '',
        currentUrl: '',
        navSeq: 0,
        loginPending: false
      }))
  } catch {
    return []
  }
}

// 只持久化身份信息。用序列化后的身份字段做比较，避免 status/currentUrl
// 每次变化都把整个账号列表重新写一遍 localStorage。
watch(
  () =>
    JSON.stringify(
      accounts.map(({ id, platform, nickname, tier, proxy }) => ({
        id,
        platform,
        nickname,
        tier,
        proxy
      }))
    ),
  (value) => localStorage.setItem(STORAGE_KEY, value)
)

function addAccount() {
  const platform = activeTab.value
  const n = accounts.filter((a) => a.platform === platform).length + 1
  accounts.push({
    id: crypto.randomUUID(),
    platform,
    nickname: `账号 ${n}`,
    tier: 'spare',
    proxy: '',
    status: 'idle',
    opened: false,
    url: '',
    currentUrl: '',
    navSeq: 0,
    loginPending: false
  })
}

function switchTab(key) {
  activeTab.value = key
  search.value = ''
  selected.clear()
  const first = accounts.find((a) => a.platform === key && a.opened)
  activeId.value = first?.id ?? null
}

function setSearch(value) {
  search.value = String(value || '')
  // 搜索会改变可见账号集合，清空选择避免误删被过滤掉的账号。
  selected.clear()
}

function addMultiple(count) {
  const n = Math.floor(Number(count))
  if (!Number.isFinite(n) || n < 1 || n > 50) {
    window.alert('请输入 1 到 50 之间的数字。')
    return
  }
  search.value = ''
  for (let i = 0; i < n; i++) addAccount()
}

function toggleSelect(id) {
  selected.has(id) ? selected.delete(id) : selected.add(id)
}

function selectAll() {
  visibleAccounts.value.forEach((a) => selected.add(a.id))
}

function renameAccount({ id, value }) {
  const a = accounts.find((x) => x.id === id)
  if (a) a.nickname = String(value)
}

// 批量打开：所有目标先入队，只有拿到名额的才真正设 url。
// 之前是一次性把 20 个 url 全设上，主进程和渲染进程一起被打满。
// id → { url, login }：排队期间目标信息暂存这里，派发时才写进账号对象。
const pendingTargets = new Map()

// 真正把一个账号的页面挂上去。由队列在拿到名额后调用，不直接对外的入口。
function dispatchOpen(id) {
  const a = accounts.find((x) => x.id === id)
  if (!a) {
    releaseSlot(id)
    return
  }
  const target = pendingTargets.get(id)
  pendingTargets.delete(id)
  if (!target) {
    releaseSlot(id)
    return
  }
  // 先把画像和代理交出去，等主进程确认落到分区上，再挂 webview。
  //
  // 顺序不能反，而且必须真的等：webview 一挂载，主进程的
  // web-contents-created 立刻就要读画像缓存放进 CDP 注入脚本。
  // 如果这里不等（早先是 void applyAccountEnv），IPC 还在路上，
  // 主进程只能用 buildProfile(id) 现算一份顶上，而现算的那份不带
  // 账号的 profilePreset，档位对不上——表现是 UA 是画像值、
  // hardwareConcurrency 等硬件项却是另一档（实测 12 核的账号读到 24）。
  //
  // 等失败也要继续打开：页面打不开比指纹不对更影响使用。
  void (async () => {
    try {
      await applyAccountEnv(a)
    } catch {
      // applyAccountEnv 内部已经报错，不阻塞打开。
    }
    a.opened = true
    a.url = target.url
    a.currentUrl = target.url
    a.navSeq += 1
    a.status = 'loading'
    a.loginPending = target.login
    openPending.value = openQueue.total
  })()
  // 卡住的页面不会回 status，超时后强制放行，否则整条队列停在这里。
  clearTimeout(slotTimers.get(id))
  slotTimers.set(
    id,
    setTimeout(() => {
      slotTimers.delete(id)
      releaseSlot(id)
    }, OPEN_SLOT_TIMEOUT)
  )
}

function releaseSlot(id) {
  const timer = slotTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    slotTimers.delete(id)
  }
  if (openQueue.done(id)) openPending.value = openQueue.total
}

// 崩溃自愈：换 key 强制重挂 webview。崩溃的实例已经不可用，在上面 reload 没有意义。
// 重挂会重新加载当前页；登录态在分区里，不会因此掉线。
function onRestart({ id }) {
  const a = accounts.find((x) => x.id === id)
  if (!a || !a.opened) return
  const target = a.currentUrl || a.url
  if (!target) return
  a.url = target
  a.navSeq += 1
  a.status = 'loading'
}

// 批量打开：所有目标先入队，只有拿到名额的才真正设 url。
// 之前是一次性把 20 个 url 全设上，主进程和渲染进程一起被打满。
// 现在再加一层错开：入队本身带递增延迟，避免所有请求挤在同一秒。
function openFor(ids, url, { login = false } = {}) {
  if (!ids.length || !url) return
  ids.forEach((id, i) => {
    pendingTargets.set(id, { url, login })
    if (!i) {
      openQueue.enqueue([id])
      return
    }
    // 按序号逐步拉开，而不是等一个固定间隔——固定间隔本身就是可测的节拍。
    setTimeout(() => openQueue.enqueue([id]), staggerDelay(i))
  })
  openPending.value = openQueue.total
  activeId.value = ids[0]
}

// 把一个账号的画像和代理交给主进程。这是隔离的落地点：
//   profile  该账号固定的 UA / 语言 / 硬件项，长期不变
//   proxy    该账号专属出口，未配则清回直连
// 失败不阻塞打开——页面打不开比指纹不对更影响使用。
async function applyAccountEnv(a) {
  if (!window.matrix?.setAccountEnv) return null
  try {
    // 必须先把画像抹成普通对象再发。
    // profiles 是 reactive() 的，profileFor 返回的是 Proxy；ipcRenderer.invoke
    // 走结构化克隆，遇到 Proxy 会抛 "An object could not be cloned."，
    // 整个环境下发就静默失败了（envError 在界面上没渲染，看都看不见）。
    // 后果是主进程永远收不到真画像，只能用 will-attach-webview 里现算的
    // 兜底画像，页面硬件项和账号画像对不上。
    const profile = JSON.parse(JSON.stringify(profileFor(a) || null))
    const res = await window.matrix.setAccountEnv({
      partition: `persist:acct-${a.id}`,
      profile,
      proxy: a.proxy || null
    })
    if (res && !res.ok) envError.value = `${a.nickname}：${res.error}`
    else if (envError.value.startsWith(`${a.nickname}：`)) envError.value = ''
    return res
  } catch (error) {
    envError.value = `${a.nickname}：环境下发失败 ${error.message}`
    return null
  }
}

// 取（必要时生成）某账号的画像，并存回 localStorage。
// 生成一次就固定：真实设备的指纹不会每次刷新都变。
function profileFor(a) {
  const existing = profiles[a.id]
  const refreshed = refreshProfile(existing, { chromeVersion: CHROME_VERSION })
  if (refreshed) {
    // refreshProfile 可能改了字段（比如把越界的 memory 收回到 8）。
    // 不写回的话每次都只在内存里修，下次读到的还是旧值。
    if (refreshed !== existing) {
      profiles[a.id] = refreshed
      saveProfiles(safeStorage(), profiles)
    }
    return refreshed
  }
  const created = buildProfile(a.id, {
    chromeVersion: CHROME_VERSION,
    preset: a.profilePreset ? presetByKey(a.profilePreset) : undefined
  })
  profiles[a.id] = created
  saveProfiles(safeStorage(), profiles)
  return created
}

function batchLogin() {
  // 批量登录默认跳过主力号：这类动作一次作用于很多账号，形态最整齐。
  const ids = [...selected].filter((id) => includeInBatch(accounts.find((a) => a.id === id)))
  openFor(ids, loginUrl.value, { login: true })
}

function openLive(url) {
  const target = normalizeUrl(url)
  if (!target) return
  const ids = [...selected].filter((id) => includeInBatch(accounts.find((a) => a.id === id)))
  openFor(ids, target)
}

// 点击切换主力/备用。
function toggleTier(id) {
  const a = accounts.find((x) => x.id === id)
  if (a) a.tier = nextTier(a)
}

// 设置某账号的出口代理。留空即清回直连。
// 改完必须重新载入页面才会走新出口——代理是分区级配置，
// 已经建立好的连接不会自己切回去。
async function setAccountProxy(id) {
  const a = accounts.find((x) => x.id === id)
  if (!a) return
  const input = window.prompt(
    `为「${a.nickname}」设置出口代理\n留空 = 直连\n支持 http:// / https:// / socks4:// / socks5://\n带认证：socks5://user:pass@host:port`,
    a.proxy || ''
  )
  if (input === null) return
  const parsed = parseProxy(input)
  if (!parsed.ok) {
    window.alert(parsed.error)
    return
  }
  a.proxy = String(input || '').trim()
  await applyAccountEnv(a)
  // 已打开的页面重载一次，让新出口立刻生效。
  if (a.opened && a.currentUrl) {
    a.url = a.currentUrl
    a.navSeq += 1
    a.status = 'loading'
  }
}

// 出口概况：多少个账号真的分开了、多少个还在共用同一条出口。
// 这一行数的是**配置**：有几个账号配了互不相同的代理。
// 配置不等于事实，真正的结论看下面实测那一份。
const egressSummary = computed(() => summarizeEgress(tabAccounts.value))

// ── 出口实测 ──────────────────────────────────────────────
// 配置说「五条独立出口」，实际可能五条都指向同一个 IP，或者全是失效代理
// 走的本机直连。所以再测一份：从每个账号自己的分区发请求，看对方看到的 IP。
const egressProbes = reactive({}) // accountId → { ok, ip, error }
const probing = ref(false)
const probedAt = ref('')
// 本机直连的出口 IP，用来判断「配了代理却还是本机 IP」。
const ownProbeIp = ref('')

const measuredEgress = computed(() => {
  const ownIp = ownProbeIp.value
  return summarizeMeasured(tabAccounts.value, egressProbes, ownIp)
})

const egressMeasuredText = computed(() => measuredVerdict(measuredEgress.value))

// 账号列表用：accountId → 判定。summary.rows 已经有这个形状，
// 但列表要按 id 查，所以转成映射。
const egressVerdicts = computed(() => {
  const out = {}
  for (const row of measuredEgress.value.rows || []) {
    out[row.id] = { state: row.state, ip: row.ip, hasProxy: row.hasProxy }
  }
  return out
})

async function probeEgress() {
  if (!window.matrix?.probeEgress) return
  const list = tabAccounts.value.filter(Boolean)
  if (!list.length) return
  probing.value = true
  try {
    const partitions = list.map((a) => `persist:acct-${a.id}`)
    const res = await window.matrix.probeEgress(partitions)
    if (res && typeof res === 'object') {
      for (const [id, probe] of Object.entries(res)) {
        egressProbes[id] = probe
      }
      probedAt.value = new Date().toLocaleTimeString()
    }
    // 本机基准：取第一个未配代理的账号实测到的 IP。
    // 有了它才能认出「配了代理、出口却还是本机」这种失效情况。
    // 全都配了代理时没有基准，proxy-dead 就判不出来——这种情况宁可不报，
    // 也好过把一个正常代理误报成失效。
    const direct = list.find((a) => !String(a.proxy || '').trim())
    const directProbe = direct ? egressProbes[direct.id] : null
    ownProbeIp.value = directProbe && directProbe.ok ? directProbe.ip : ''
  } finally {
    probing.value = false
  }
}

// 当前平台的账号分级构成，给操作栏显示一行「主力 3 / 备用 7」。
// 用 tabAccounts 而不是 paneAccounts：刚添加还没打开的账号也要算进去，
// 否则刚点完「添加账号」看到的是 0 / 0，像是没生效。
const tierSummary = computed(() => summarizeTiers(tabAccounts.value))

async function clearAccountSession(id) {
  if (!window.matrix?.clearSession) return false
  try {
    await window.matrix.clearSession(`persist:acct-${id}`)
    return true
  } catch (error) {
    console.warn('clear session failed', id, error)
    return false
  }
}

async function removeSelected() {
  const ids = [...selected]
  if (!ids.length) return
  const ok = window.confirm(
    `确定移除 ${ids.length} 个账号？\n对应分区的 Cookie、缓存和登录状态也会被清除。`
  )
  if (!ok) return

  await Promise.all(ids.map((id) => clearAccountSession(id)))

  for (let i = accounts.length - 1; i >= 0; i--) {
    if (!selected.has(accounts[i].id)) continue
    const removedId = accounts[i].id
    delete chats[removedId]
    // 移除的账号可能还在队列里等着，不清掉会让它占着名额永远不放。
    pendingTargets.delete(removedId)
    releaseSlot(removedId)
    if (activeId.value === removedId) activeId.value = null
    selected.delete(removedId)
    accounts.splice(i, 1)
  }
  openPending.value = openQueue.total

  if (!activeId.value) {
    activeId.value = accounts.find((a) => a.platform === activeTab.value && a.opened)?.id ?? null
  }
}

async function logoutActive(id) {
  const a = accounts.find((x) => x.id === id)
  if (!a) return
  if (!window.confirm(`退出「${a.nickname}」并清除本地登录状态？`)) return
  const ok = await clearAccountSession(id)
  if (!ok) {
    window.alert('清除本地会话失败，请重试。')
    return
  }
  a.opened = false
  a.url = ''
  a.currentUrl = ''
  a.status = 'idle'
  a.loginPending = false
  delete chats[id]
  if (activeId.value === id) {
    activeId.value = accounts.find((x) => x.platform === activeTab.value && x.opened)?.id ?? null
  }
}

function closeActive(id) {
  const a = accounts.find((x) => x.id === id)
  if (!a) return
  // 只关闭页面，不清理分区；下次打开仍是已登录状态。
  a.opened = false
  a.url = ''
  a.currentUrl = ''
  a.status = 'idle'
  a.loginPending = false
  if (activeId.value === id) {
    activeId.value = accounts.find((x) => x.platform === activeTab.value && x.opened)?.id ?? null
  }
}

// 只更新状态位，不再顺手清 loginPending：清除与否由状态本身决定。
// 原来在 status === 'online' 时清，但 online 现在只由登录成功页给出，
// 批量登录后停在扫码页的账号会一直挂着登录标记。
// 同时这里是并发闸门的放行点：哪个账号的页面有了结果，就还回一个名额。
function onStatus({ id, status, url }) {
  const a = accounts.find((x) => x.id === id)
  if (!a) return
  a.status = status
  if (url) a.currentUrl = url
  if (status === 'online' || status === 'qr' || status === 'offline') a.loginPending = false
  // loading 不算结束；其余状态都代表这一页已经有结果了。
  if (status !== 'loading') releaseSlot(id)
}

function setFillHint(value) {
  fillHint.value = value
  clearTimeout(fillHintTimer)
  fillHintTimer = setTimeout(() => {
    fillHint.value = ''
  }, 3500)
}

async function onFill(text) {
  const id = publishTargetId.value
  if (!id) {
    setFillHint('请先选择一个账号')
    return
  }
  const result = await browserPane.value?.fillActive(id, text)
  if (result === 'filled') setFillHint(`已填入「${nameOf(id)}」，请到页面点击发送`)
  else if (result === 'no-input') setFillHint(`「${nameOf(id)}」上没有找到评论框——确认当前是直播或视频页`)
  else if (result === 'no-view') setFillHint('该账号页面尚未打开')
  else setFillHint('填入失败，请重试')
}

function nameOf(id) {
  const a = accounts.find((x) => x.id === id)
  return a ? a.nickname : '账号'
}

async function onPublish(text) {
  if (publishing.value) return
  const id = publishTargetId.value
  if (!id) {
    setFillHint('请先选择一个账号')
    return
  }
  const account = accounts.find((a) => a.id === id)
  if (!account) return
  // 说清发到哪种页面：直播间和视频页的评论区是两个地方，
  // 确认时看不出区别就容易发到自己没想到的那一处。
  const where = pageKindLabel(account)
  const preview = String(text).slice(0, 200)
  const warn = where === '直播' || where === '视频' ? '' : `\n注意：当前页面不是直播/视频页，可能找不到评论框。`
  if (!window.confirm(`确认用「${account.nickname}」发布这条评论？\n发到：${where || '当前页面'}${warn}\n\n${preview}`)) return

  publishing.value = true
  try {
    const result = await browserPane.value?.publishActive(id, text)
    if (result === 'sent') setFillHint(`已发布到「${account.nickname}」`)
    else if (result === 'no-input') setFillHint(`「${account.nickname}」上没有找到评论框——确认当前是直播或视频页`)
    else if (result === 'empty-input') setFillHint('输入框被页面清空了，请重试')
    else if (result === 'fill-mismatch') setFillHint('内容没写进输入框，请手动输入')
    else if (result === 'no-button') setFillHint('没有找到发送按钮，请手动点击')
    else if (result === 'button-disabled') setFillHint('发送按钮不可用')
    else if (result === 'no-view') setFillHint('该账号页面尚未打开')
    else setFillHint('发布失败，请重试')
  } finally {
    publishing.value = false
  }
}

// 只导出账号身份信息；Cookie、分区数据、登录态一律不进文件。
function exportAccounts() {
  const data = accounts.map(({ id, platform, nickname, tier }) => ({ id, platform, nickname, tier }))
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = 'matrix-accounts.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function toggleWall() {
  viewMode.value = viewMode.value === 'wall' ? 'single' : 'wall'
}

// 从墙上某一格点进单页：让那一格变成当前账号，同时退出分屏。
function focusFromWall(id) {
  activeId.value = id
  wallTarget.value = id
  viewMode.value = 'single'
}

// 在监看墙里点某一格：只把它设为发布目标，不退出分屏。
// 「放大看」和「发到这里」是两个动作，共用一次点击会互相打架。
function pickFromWall(id) {
  if (!id) return
  wallTarget.value = id
}

// 环境自检：只能探当前平台里已经挂载的 webview。
// 这里逐台串行执行，避免和批量打开的并发闸门抢渲染资源。
// 每次探测顺手存一条快照：账号哪天掉线时，能对照出是不是环境先变了。
async function probeEnv() {
  if (envProbing.value) return
  envProbing.value = true
  try {
    const mounted = new Set(browserPane.value?.listMounted?.() ?? [])
    const targets = paneAccounts.value.filter((a) => mounted.has(a.id))
    const rows = []
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i]
      if (i > 0) await sleep(staggerDelay(i))
      const res = (await browserPane.value?.probeActive?.(a.id)) || { error: '无响应' }
      const env = res.env || null
      let drift = null
      if (env) {
        const before = envSnapshots[a.id] || []
        drift = compareWithLatest(before, env)
        envSnapshots[a.id] = appendSnapshot(before, { ts: Date.now(), ...env })
      }
      rows.push({ id: a.id, nickname: a.nickname, ...res, drift })
      // 让出一次事件循环，界面上的「探测中…」才不会全程冻住。
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    saveSnapshots(safeStorage(), envSnapshots)
    envRows.value = rows
  } finally {
    envProbing.value = false
  }
}

// 巡检一轮：逐台先切到个人页，再数登录入口和头像。
// 必须在个人页上判定——其他页面上的头像是别人的。
// 间隔按账号分级算：主力更勤，备用更疏。全局 healthLastRun 只用来
// 兜住「刚跑完一轮」的重复触发，真正决定哪个账号该探的是它自己的 at。
async function runHealthCheck({ force = false } = {}) {
  if (healthRunning.value) return
  const now = Date.now()
  if (!force && !shouldCheck({ now, lastRun: healthLastRun })) return
  healthRunning.value = true
  try {
    const mounted = browserPane.value?.listMounted?.() ?? []
    const all = pickTargets(paneAccounts.value, mounted)
    // 只探到了自己间隔的账号：主力 20 分钟，备用 45 分钟。
    // 强制的（用户手点）全部探一遍，不看间隔。
    const targets = force
      ? all
      : all.filter((a) => {
          const last = health[a.id]?.at
          return !Number.isFinite(last) || now - last >= intervalFor(a)
        })
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i]
      // 账号之间错开：二十几个号挨个访问个人页，这个密集程度本身就是信号。
      if (i > 0) await sleep(staggerDelay(i))
      const raw = await browserPane.value?.probeHealth?.(a.id, a.platform)
      const outcome = parseHealthOutcome(raw)
      health[a.id] = { ...outcome, at: Date.now() }
      // 让出一次事件循环，界面上的「巡检中…」才不会全程冻住。
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    healthLastRun = Date.now()
  } finally {
    healthRunning.value = false
  }
}

function healthOf(id) {
  return health[id] || null
}

// 操作栏上的总览：只统计当前平台已打开的账号。
const healthSummary = computed(() => {
  const results = paneAccounts.value.map((a) => health[a.id]).filter(Boolean)
  return summarizeHealth(results)
})

// 定时巡检。窗口失焦时不跑——用户不在看的时候没必要制造请求。
// 定时器走最短的那档间隔（主力 20 分钟），每轮由 runHealthCheck 自己
// 挑出「到点了」的账号；否则定时器比主力间隔还疏，主力的勤巡检等于没配。
// 不用固定 setInterval，改成「跑完再排下一次」并带抖动。
function startHealthTimer() {
  clearTimeout(healthTimer)
  const wait = jitter(HEALTH_TIER_FLOOR)
  healthTimer = setTimeout(async () => {
    if (!document.hidden) {
      try {
        await runHealthCheck()
      } catch {
        // 巡检失败不该让定时器停掉，下一轮照常排。
      }
    }
    startHealthTimer()
  }, wait)
}
startHealthTimer()

function toggleEnv() {
  showEnv.value = !showEnv.value
  if (showEnv.value) probeEnv()
}

function onChat({ id, kind, nickname, text, ts }) {
  if (!id || !text) return
  if (!accounts.some((a) => a.id === id)) return
  if (!chats[id]) chats[id] = []
  const last = chats[id][chats[id].length - 1]
  // 同一元素可能被不同层级各上报一次；只有同昵称 + 同文 + 1.5s 内才算重复，
  // 避免把不同用户同时发的“666”误删。
  if (
    last &&
    last.text === text &&
    last.nickname === nickname &&
    Math.abs(Number(ts) - Number(last.ts)) < 1500
  ) {
    return
  }
  chats[id].push({
    kind: kind === 'video' ? 'video' : 'live',
    nickname: String(nickname || '').slice(0, 60),
    text: String(text).slice(0, 500),
    ts: Number(ts) || Date.now()
  })
  if (chats[id].length > 200) chats[id].splice(0, chats[id].length - 200)
}

// 只有当前选中账号的导航会外发，目标账号的 did-navigate 不会再触发，天然防环。
// 源账号只更新 currentUrl，不改 src，避免把当前地址写回 src 触发整页重载。
function onNavigate({ id, url }) {
  const source = accounts.find((a) => a.id === id)
  if (!source) return
  source.currentUrl = url
  if (!syncFollow.value || id !== activeId.value) return

  const targets = selected.size
    ? accounts.filter((a) => selected.has(a.id))
    : accounts.filter((a) => a.platform === source.platform && a.opened)
  for (const a of targets) {
    if (a.id === id || !a.opened || a.platform !== source.platform) continue
    if (a.url === url || a.currentUrl === url) continue
    a.url = url
    a.currentUrl = url
    a.status = 'loading'
    a.loginPending = false
  }
}
</script>

<template>
  <div class="app">
    <Sidebar :platforms="PLATFORMS" :active="activeTab" @switch="switchTab" />
    <main class="main">
      <ActionBar
        :platform-label="platformLabel"
        :account-count="visibleAccounts.length"
        :selected-count="selected.size"
        :sync-enabled="syncFollow"
        :chat-open="showChat"
        :env-open="showEnv"
        :wall-open="viewMode === 'wall'"
        :health-running="healthRunning"
        :health-summary="healthSummary"
        :tier-summary="tierSummary"
        :egress-summary="egressSummary"
        :measured-egress="measuredEgress"
        :egress-measured-text="egressMeasuredText"
        :probing="probing"
        :probed-at="probedAt"
        :open-pending="openPending"
        :last-speaker="lastSpeaker"
        @add="addAccount"
        @login="batchLogin"
        @select-all="selectAll"
        @clear="selected.clear()"
        @open-live="openLive"
        @remove="removeSelected"
        @toggle-sync="syncFollow = $event"
        @toggle-chat="showChat = !showChat"
        @toggle-env="toggleEnv"
        @toggle-wall="toggleWall"
        @check-health="runHealthCheck({ force: true })"
        @probe-egress="probeEgress"
        @export="exportAccounts"
      />
      <div ref="workspaceRef" class="workspace">
        <AccountList
          :accounts="visibleAccounts"
          :selected="selected"
          :active-id="activeId"
          :search="search"
          :health="health"
          :egress-verdicts="egressVerdicts"
          :style="{ width: layout.list + 'px' }"
          @select="activeId = $event"
          @toggle="toggleSelect"
          @rename="renameAccount"
          @search="setSearch"
          @add-many="addMultiple"
          @toggle-tier="toggleTier"
          @set-proxy="setAccountProxy"
        />
        <Splitter
          :spec="SPLITS.list"
          :width="layout.list"
          label="调整账号列表宽度"
          @resize="applySplit('list', $event)"
          @commit="commitLayout"
        />
        <BrowserPane
          ref="browserPane"
          :accounts="paneAccounts"
          :active-id="activeId"
          :mode="viewMode === 'wall' ? 'grid' : 'none'"
          :chats="chats"
          :publish-target="publishTargetId"
          @status="onStatus"
          @navigate="onNavigate"
          @chat="onChat"
          @restart="onRestart"
          @focus="focusFromWall"
          @pick="pickFromWall"
          @logout="logoutActive"
          @close="closeActive"
        />
        <Splitter
          v-if="showChat"
          :spec="SPLITS.chat"
          :width="layout.chat"
          invert
          label="调整话术面板宽度"
          @resize="applySplit('chat', $event)"
          @commit="commitLayout"
        />
        <ChatPanel
          v-if="showChat"
          :style="{ width: layout.chat + 'px' }"
          :messages="activeChats"
          :account-name="streamLabel"
          :multi="streamAccounts.length > 1"
          :sources="streamSources"
          :focused-id="streamFocus"
          :publish-to="publishTargetId"
          :page-kinds="streamPageKinds"
          :hint="fillHint"
          :publishing="publishing"
          @fill="onFill"
          @focus-source="focusStream"
          @pick-target="pickPublishTarget"
          @publish="onPublish"
        />
        <Splitter
          v-if="showEnv"
          :spec="SPLITS.env"
          :width="layout.env"
          invert
          label="调整环境面板宽度"
          @resize="applySplit('env', $event)"
          @commit="commitLayout"
        />
        <EnvPanel
          v-if="showEnv"
          :style="{ width: layout.env + 'px' }"
          :accounts="paneAccounts"
          :probing="envProbing"
          :snapshots="envSnapshots"
          :result="envRows.length ? summarizeEnv(envRows) : null"
          @probe="probeEnv"
          @close="showEnv = false"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
}
.main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  /* 分栏宽度由分隔条控制，容器只负责排布。 */
  overflow: hidden;
}
/* 账号列表与两块的宽度改由内联 style 给出（可在界面上拖动），
   这里不再写死宽度，否则会和拖动结果打架。 */
.workspace :deep(.list) {
  flex: none;
  min-width: 0;
  overflow-y: auto;
  background: #fff;
}
</style>
