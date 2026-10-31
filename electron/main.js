import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProfile, mergeProxyCredential, parseProxy, profileScript, proxyConfigFor, proxyCredentials, refreshProfile, releaseProxyCredential } from '../src/isolation.js'
import { PROBE_ENDPOINTS, PROBE_TIMEOUT, ipFromPayload, isIpv4 } from '../src/egress.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const ACCOUNT_PARTITION_PREFIX = 'persist:acct-'
const ACCOUNT_PARTITION_RE = /^persist:acct-[A-Za-z0-9_-]+$/

// 固定 userData 路径，避免打包后 productName 变化导致账号列表/分区“消失”。
// MATRIX_USER_DATA_DIR 主要用于测试/便携运行，不设置时仍落到 matrix-console。
try {
  const userDataDir = process.env.MATRIX_USER_DATA_DIR || path.join(app.getPath('appData'), 'matrix-console')
  app.setPath('userData', path.resolve(userDataDir))
} catch {
  // 极早期路径不可用时保持 Electron 默认值；开发态通常仍会落到 matrix-console。
}

// 不把 Electron 标识暴露给平台。平台标记必须来自真实运行环境：在 macOS/Linux 上
// 沿用 Windows 的 UA，会和 navigator.platform、sec-ch-ua-platform 互相矛盾。
// Chromium 版本取当前运行时，不写死。
function buildUserAgent() {
  const chrome = process.versions.chrome || '130.0.0.0'
  const base = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  if (process.platform === 'darwin') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${base}`
  if (process.platform === 'linux') return `Mozilla/5.0 (X11; Linux x86_64) ${base}`
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${base}`
}

const CHROME_UA = buildUserAgent()

// 只允许平台页面使用全屏/指针锁/DRM/剪贴板写入；摄像头、麦克风、通知、定位等一律拒绝。
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'pointerLock',
  'clipboard-sanitized-write',
  'mediaKeySystem'
])
const hardenedSessions = new WeakSet()
let win = null

function isTrustedOrigin(value) {
  try {
    const u = new URL(String(value || ''))
    if (u.protocol !== 'https:') return false
    const h = u.hostname
    return h === 'douyin.com' || h.endsWith('.douyin.com') ||
      h === 'weixin.qq.com' || h.endsWith('.weixin.qq.com')
  } catch {
    return false
  }
}

function isHttpUrl(value) {
  try {
    const u = new URL(String(value || ''))
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function isAccountPartition(value) {
  return typeof value === 'string' && ACCOUNT_PARTITION_RE.test(value)
}

// ── 账号隔离 ──────────────────────────────────────────────
//
// 三层，从强到弱：
//   出口隔离  每个账号一个代理分区级配置，这是最有效的关联信号
//   会话隔离  每个账号一个 persist:acct-<id> 分区，cookie 天然分开（本来就有）
//   环境自洽  每个账号的 UA / 语言 / 硬件项固定成一份画像，长期不变
//
// 环境层刻意只做「自洽」，不做「随机」：真实设备的指纹半年不变，
// 每次刷新都在变的噪声本身就是特征。所以画像按账号 id 算出来，
// 同一账号永远同一份，浏览器升级了也只在版本号上跟着走。
//
// 渲染进程通过 IPC 把每个账号的画像和代理交过来，主进程按分区落地。
const accountProfiles = new Map() // partition → profile
const accountProxies = new Map() // partition → proxy 原始串
// partition → { username, password }，供代理 407 时回复。
// 凭据不能塞进 proxyRules（那里只认 scheme://host:port），只能走 login 事件。
const accountProxyAuth = new Map()
// host:port → 凭据。login 事件在拿不到分区时按出口地址兜底查。
const proxyAuthByEndpoint = new Map()

// 分区名 → session 对象的反查表。
// will-attach-webview 拿到的是分区名，web-contents-created 里的 guest
// 拿到的是 webContents，中间要靠 session 对象把两者接起来。
// login 事件也靠它找回是哪个账号。
const sessionPartitions = new Map()

// 分区名 → 当前挂着的 guest webContents。
// 用途只有一个：真画像比兜底画像晚到时（见 matrix:set-account-env），
// 得找得回已经注入过的那个页面，把它重做一遍。
const partitionGuests = new Map()

// 用新画像重做某个分区上已经开着的页面。
function reinjectForPartition(partition, profile) {
  const guest = partitionGuests.get(partition)
  if (!guest || guest.isDestroyed?.()) return
  applyProfileToWebContents(guest, profile)
}

// 把画像注入 guest 页面。
//
// Page.enable 之后 addScriptToEvaluateOnNewDocument 才对「之后的」导航生效，
// 所以理想时序是抢在首个导航之前注册。但 guest 的 src 是随 <webview> 一起
// 给的，attach + Page.enable + addScript 这几趟 IPC 走完时首屏往往已经跑起来了
// （实测 setup 完成时 URL 已经是目标页），注册的脚本就赶不上这一屏——
// 表现是 UA 是画像值（那条走 will-attach-webview），而 hardwareConcurrency
// 等硬件项全是真实值，且 Navigator.prototype 上的描述符仍是原生形态
// （enumerable: true，注入后应为 false）。
//
// 因此注册完主动重载一次，让脚本落到新文档上。首屏本来就是空白，
// 重载的代价远小于整页用真实指纹打开。
function applyProfileToWebContents(contents, profile) {
  if (!contents || contents.isDestroyed?.()) return
  const source = profileScript(profile)
  const rearm = () => {
    if (!contents.isDestroyed?.()) {
      try { contents.reload() } catch {}
    }
  }
  try {
    const dbg = contents.debugger
    const setup = async () => {
      await dbg.sendCommand('Page.enable')
      await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source })
      // 时区必须走 CDP 的 Emulation 命令：它作用在单个 target 上，
      // 所以同一个窗口里的不同账号可以有不同时区。
      // 这个覆盖对当前文档立即生效，不需要重新加载。
      if (profile.timezone) {
        await dbg.sendCommand('Emulation.setTimezoneOverride', { timezoneId: profile.timezone })
      }
    }
    if (dbg.isAttached()) {
      setup().then(rearm).catch(() => {})
      return
    }
    dbg.attach('1.3')
    setup().then(rearm).catch(() => {})
  } catch {
    // 注入失败不能让页面打不开：宁可没有画像，也要能登录。
  }
}

// 把一个账号从主进程的几张表里摘掉，并回收它独占的出口兜底条目。
//
// 两处复用：改代理前先清旧的、账号被删后清全部。
function forgetAccountEnv(partition) {
  const prevRaw = accountProxies.get(partition)
  accountProxies.delete(partition)
  accountProxyAuth.delete(partition)

  const parsed = parseProxy(prevRaw)
  if (!parsed.ok || !parsed.proxy) return
  // 还有别的账号挂在这个出口上就不能删。
  const others = [...accountProxies.values()]
    .map((raw) => parseProxy(raw))
    .filter((p) => p.ok && p.proxy)
    .map((p) => p.proxy)
  releaseProxyCredential(proxyAuthByEndpoint, others, parsed.proxy)
}

// 渲染进程把账号的画像和代理交过来。每次打开页面都会调一次，
// 幂等：重复调用只会覆盖同一份配置。
ipcMain.handle('matrix:set-account-env', async (_event, payload) => {
  const partition = String(payload?.partition || '')
  if (!isAccountPartition(partition)) throw new Error('invalid account partition')

  // 画像：先用渲染进程给的，没有就按 id 现算一份，保证一定是自洽的。
  const id = partition.replace(ACCOUNT_PARTITION_PREFIX, '')
  const profile =
    refreshProfile(payload?.profile, { chromeVersion: process.versions.chrome }) ||
    buildProfile(id, { chromeVersion: process.versions.chrome })
  // 缓存里可能已经有一份「现算」的兜底画像——will-attach-webview 为了
  // 赶在首个请求前设 UA，会先调 profileForPartition，那时这条 IPC 还没到。
  // 兜底画像不带账号的 preset，档位和真画像可能不同（实测 12 核的账号
  // 现算出 24 核），所以两边不一样时必须把已注入的页面重新做一遍，
  // 否则页面就停在那份错误的画像上。
  const previous = accountProfiles.get(partition)
  accountProfiles.set(partition, profile)
  if (previous && previous.cores !== profile.cores) {
    reinjectForPartition(partition, profile)
  }
  const ses = session.fromPartition(partition)
  ses.setUserAgent(profile.ua)
  // 语言跟着画像走：navigator.languages 的注入和这里要保持一致，
  // 否则请求头 Accept-Language 和页面里读到的对不上。
  try {
    ses.setSpellCheckerLanguages([])
  } catch {}

  // 代理：给了就设，没给就清回直连，避免上一个账号的配置残留。
  const proxy = proxyConfigFor(payload?.proxy)
  // 先把旧配置连同它的出口兜底条目一起回收，再写入新值。
  // 顺序反了的话读到的就是新值，旧凭据永远清不掉。
  forgetAccountEnv(partition)
  accountProxies.set(partition, payload?.proxy || null)
  // 凭据按分区记下来，登录挑战来的时候按发起请求的分区回。
  // 不能放进 proxyRules——那里只认 scheme://host:port。
  const rawParsed = parseProxy(payload?.proxy)
  const creds = rawParsed.ok ? proxyCredentials(rawParsed.proxy) : null
  accountProxyAuth.set(partition, creds)

  // login 事件平时靠分区查凭据，这张按出口地址的表只是拿不到分区时的兜底。
  // 同一个出口被多个账号共用、而且密码不同时会被标记成冲突，宁可不回复。
  mergeProxyCredential(proxyAuthByEndpoint, rawParsed.proxy, creds)
  try {
    if (proxy) await ses.setProxy(proxy)
    else await ses.setProxy({ mode: 'direct' })
  } catch (error) {
    return { ok: false, error: `代理设置失败：${error.message}` }
  }

  return { ok: true, profile }
})

// 设置完代理后，已挂载的页面需要重新载入才会走新出口。
// 渲染进程据此决定要不要 reload。
ipcMain.handle('matrix:reload-partition', async (_event, partition) => {
  if (!isAccountPartition(partition)) throw new Error('invalid account partition')
  return true
})

function hardenSession(ses) {
  if (!ses || hardenedSessions.has(ses)) return
  hardenedSessions.add(ses)
  // UA 不在这里统一设死：每个账号有自己的画像，UA 跟着画像走。
  // 分区第一次加固时先给一个默认值，真正的画像在 set-account-env 里落地。
  ses.setUserAgent(CHROME_UA)
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details?.requestingUrl || webContents?.getURL() || ''
    callback(isTrustedOrigin(origin) && ALLOWED_PERMISSIONS.has(permission))
  })
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return isTrustedOrigin(requestingOrigin) && ALLOWED_PERMISSIONS.has(permission)
  })
  // HID/USB/串口等设备选择一律拒绝；页面不需要这些能力。
  ses.setDevicePermissionHandler(() => false)
}

// 拿到（必要时现算）某个分区的画像。
//
// 「现算」只在一种情况下成立：调用方（渲染进程）确实没带画像过来。
// 但现算的 buildProfile(id) 不带账号的 profilePreset，档位和渲染层
// 存下来的那份可能不同——所以它只能当兜底，不能顶替真实画像。
// 真画像由 matrix:set-account-env 写入缓存，正常路径下一定先到。
function profileForPartition(partition) {
  const cached = accountProfiles.get(partition)
  if (cached) return cached
  const id = partition.replace(ACCOUNT_PARTITION_PREFIX, '')
  const profile = buildProfile(id, { chromeVersion: process.versions.chrome })
  accountProfiles.set(partition, profile)
  return profile
}

ipcMain.handle('matrix:clear-session', async (_event, partition) => {
  if (!isAccountPartition(partition)) throw new Error('invalid account partition')
  const ses = session.fromPartition(partition)
  await ses.clearStorageData()
  await ses.clearCache()
  await ses.clearAuthCache()
  await ses.flushStorageData()
  // 账号被删掉后，主进程里的这几张表不能继续留着它：
  // accountProxies 残留会让「这个出口还有没有别人在用」算错，
  // 进而清不掉已经没人用的凭据。
  forgetAccountEnv(partition)
  return true
})

// 代理认证。
//
// Chromium 的 proxyRules 只认 scheme://host:port，内嵌的 user:pass 会被丢掉，
// 带认证的代理一律返 407。住宅代理、机房代理几乎全部要认证，所以这一步不是
// 可选项：不回复凭据，账号就是打不开的。
//
// 凭据按发起请求的 webContents 所属分区来取，而不是按代理地址：
// 两个账号可能共用同一个代理出口、但账号密码不同，按地址查会串号。
// 只在 isProxy 时回复——网站自己的 Basic Auth 不归这里管，
// 冒然回复等于把代理密码送给站点。
app.on('login', (event, webContents, details, authInfo, callback) => {
  if (!authInfo || !authInfo.isProxy) return
  event.preventDefault()

  // webContents → 分区名。sessionPartitions 在 will-attach-webview 里登记。
  let partition = ''
  try {
    const ses = webContents && webContents.session
    if (ses) partition = sessionPartitions.get(ses) || ''
  } catch {}

  let creds = partition ? accountProxyAuth.get(partition) : null
  // 拿不到分区（比如探测请求、后台请求）时退回按出口地址查。
  // conflicted 表示这个出口被多个账号共用且密码不一致，宁可不回复。
  if (!creds) {
    const byEndpoint = proxyAuthByEndpoint.get(`${authInfo.host}:${authInfo.port}`)
    if (byEndpoint && !byEndpoint.conflicted) creds = byEndpoint
  }
  if (!creds) {
    // 没有可用凭据就把挑战交回 Chromium：该弹框就弹框，不要静默吞掉。
    callback()
    return
  }
  callback(creds.username, creds.password)
})

// 只清网页缓存，保留 Cookie/登录态。用户只是想释放空间或修页面异常时用。
ipcMain.handle('matrix:clear-cache', async (_event, partition) => {
  if (!isAccountPartition(partition)) throw new Error('invalid account partition')
  await session.fromPartition(partition).clearCache()
  return true
})

// 带超时的 fetch 竞速。
//
// 实测出口本来就该有耐心上限，所以用 Promise.race 硬切断，
// 不让任何一步把整个按钮拖在「实测中…」。
function fetchWithTimeout(ses, url, { timeout, signal }) {
  const work = ses.fetch(url, {
    method: 'GET',
    cache: 'no-store',
    signal,
    headers: { accept: 'application/json, text/plain, */*' }
  })
  // 超时之后底层 fetch 仍会继续挂着，早晚可能 reject 一次。
  // 先挂个空 catch，避免变成 unhandledRejection 把主进程日志刷满。
  work.catch(() => {})
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('__probe_timeout__')), timeout)
  })
  return Promise.race([work, timeoutPromise]).finally(() => clearTimeout(timer))
}

// 用隐藏窗口加载探测端点，从页面文本里取 IP。
//
// 为什么需要这条备用路：session.fetch 撞上「代理要认证」时**不触发 login**，
// app 级和 session 级都不会被调用，直接把 407 返回来。也就是说，
// 带认证的代理（住宅代理基本都带）用 fetch 永远测不到出口。
// 真实页面加载会触发 app.on('login')，凭据能回上去，这是唯一走得通的路。
//
// 窗口不显示：实测出口是后台动作，闪一下窗口会打断用户正在做的事。
async function probeViaPage(partition, endpoint, timeout) {
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      // 探测页不需要任何特权能力。
      sandbox: true
    }
  })
  // 必须登记分区：login 事件靠 sessionPartitions 认出这是哪个账号。
  // 探测窗口不是 webview，不会经过 will-attach-webview，漏了这一行
  // 就只能退回按出口地址查凭据——两个账号共用同一出口、密码不同时，
  // 会把别的账号的密码发出去。
  try {
    sessionPartitions.set(win.webContents.session, partition)
  } catch {}
  try {
    const loaded = new Promise((resolve) => {
      const finish = (v) => resolve(v)
      win.webContents.once('did-finish-load', () => finish('ok'))
      win.webContents.once('did-fail-load', (_e, code, desc) => finish(`fail ${code} ${desc}`))
      setTimeout(() => finish('timeout'), timeout)
    })
    win.loadURL(endpoint, { httpReferrer: '' })
    const state = await loaded
    if (state !== 'ok') return { ok: false, error: `${endpoint} → ${state}` }

    // 两种读法都试：JSON 端点看 pre 里的文本，普通页面看 body。
    const text = await Promise.race([
      win.webContents.executeJavaScript(
        'document.body ? document.body.innerText : ""'
      ),
      new Promise((r) => setTimeout(() => r(''), 4000))
    ])
    const ip = ipFromPayload(String(text || ''))
    if (ip) return { ok: true, ip, endpoint }
    return { ok: false, error: `${endpoint} → 页面里没有 IP` }
  } catch (error) {
    return { ok: false, error: `${endpoint} → ${error.message}` }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

// 从某个账号自己的分区发一个请求出去，问对方「你看到的 IP 是多少」。
//
// 必须走这个分区：配了代理不等于流量走了代理。地址填错、密码过期、
// 或者代理规则压根没落到分区上，都会表现成「配置正常、出口还是本机」。
// 只有从分区里发请求，测到的才是这个账号真实的出口。
//
// 两条路：先 fetch（快、无窗口），失败或撞 407 再退回页面加载
// （慢一点，但能带代理凭据出去）。配了带认证代理的账号全靠后者。
//
// 双栈网络下，同一台机器可能同时有 IPv4 和 IPv6 出口，各探测站给的形态不一样。
// 同一个来源报出两种地址，汇总时会变成「两个独立出口」；那是个假结论，
// 比不测更糟。所以这里优先采用 IPv4：v4 地址在代理和 NAT 场景下更稳定。
async function probeOne(partition) {
  const found = []
  let lastError = ''

  const ses = session.fromPartition(partition)
  for (const endpoint of PROBE_ENDPOINTS) {
    const controller = new AbortController()
    try {
      const res = await fetchWithTimeout(ses, endpoint, {
        timeout: PROBE_TIMEOUT,
        signal: controller.signal
      })
      if (!res.ok) {
        // 407 就是代理在要认证而 fetch 拿不到——后面所有端点都会一样，
        // 直接切到页面路径，不用把每家都试一遍。
        if (res.status === 407) {
          lastError = `${endpoint} → HTTP 407（代理要认证，走页面通道）`
          break
        }
        lastError = `${endpoint} → HTTP ${res.status}`
        continue
      }
      const text = await res.text()
      const ip = ipFromPayload(text)
      if (ip) {
        found.push({ ip, endpoint })
        // 已经拿到 IPv4 就不必再问后面几家了。
        if (isIpv4(ip)) break
      } else {
        lastError = `${endpoint} → 返回里没有 IP`
      }
    } catch (error) {
      const msg = String(error && error.message)
      if (msg === '__probe_timeout__' || (error && error.name === 'AbortError') || /abort/i.test(msg)) {
        lastError = `${endpoint} → 超时`
      } else {
        lastError = `${endpoint} → ${msg}`
      }
      // 超时往往意味着代理在要认证或线路挂了，后面几家很可能一样结果。
      // 但不同探测站走的路由可能不同，继续试，靠总时长兜底。
    } finally {
      controller.abort()
    }
  }

  // fetch 那条路没拿到 IP（常见于带认证的代理），换页面通道再试。
  if (!found.length) {
    for (const endpoint of PROBE_ENDPOINTS) {
      const r = await probeViaPage(partition, endpoint, PROBE_TIMEOUT)
      if (r.ok) {
        found.push({ ip: r.ip, endpoint })
        if (isIpv4(r.ip)) break
      } else {
        lastError = r.error
      }
    }
  }

  if (found.length) {
    const v4 = found.find((f) => isIpv4(f.ip))
    const pick = v4 || found[0]
    return { ok: true, ip: pick.ip, endpoint: pick.endpoint }
  }
  return { ok: false, ip: '', error: lastError || '全部探测地址都失败' }
}

// 批量实测。串行发，不并发：一批请求同时打出同一台机器，
// 本身就是一个很显眼的形态，而且容易触发探测站的频率限制。
ipcMain.handle('matrix:probe-egress', async (_event, partitions) => {
  const list = Array.isArray(partitions) ? partitions : []
  const out = {}
  for (const partition of list) {
    const name = String(partition || '')
    if (!isAccountPartition(name)) continue
    const id = name.replace(ACCOUNT_PARTITION_PREFIX, '')
    out[id] = await probeOne(name)
  }
  return out
})

// 不在 session-created 上做全局加固：那会把默认 session（控制台自己的页面）也一起改掉。
// 账号会话在 will-attach-webview 里确认分区名合法后单独加固。

// 整个 app 只接受 persist:acct-<uuid> 分区，guest 页面不带 preload / Node。
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event, prefs, params) => {
    const partition = String(params.partition || '')
    if (!partition.startsWith(ACCOUNT_PARTITION_PREFIX) || !isAccountPartition(partition)) {
      event.preventDefault()
      return
    }
    if (params.src && !isHttpUrl(params.src)) {
      event.preventDefault()
      return
    }

    const ses = session.fromPartition(partition)
    sessionPartitions.set(ses, partition)
    hardenSession(ses)
    // UA 必须在 webview 挂载前就落到分区上：挂载后再改，
    // 首个请求已经带着旧 UA 发出去了。
    //
    // 注意这里可能先于 matrix:set-account-env 到达，profileForPartition 会
    // 现算一份兜底画像写进缓存（不带账号的 preset，档位可能不同）。
    // 真画像到达后 set-account-env 会覆盖缓存并重新注入，见那里的注释。
    ses.setUserAgent(profileForPartition(partition).ua)
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.webSecurity = true
    prefs.allowRunningInsecureContent = false
    prefs.plugins = false
    prefs.disablePopups = true
  })

  // window.open 只对账号页开放，且目标必须是平台自己的域名：视频号扫码有走弹窗的分支，
  // 一律 deny 会一直卡在「待扫码」。弹窗不注入 preload，也不给 Node。
  contents.setWindowOpenHandler(({ url }) => {
    if (contents.getType() === 'webview' && isTrustedOrigin(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            // preload 明确置空：弹窗是无 preload、无 Node、沙箱化的纯浏览窗口。
            preload: '',
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            webviewTag: false
          }
        }
      }
    }
    return { action: 'deny' }
  })

  // 画像注入。
  //
  // 走 web-contents-created 里对 guest 的直接监听，而不是宿主上的 did-attach：
  // 后者在 Electron 45 的 <webview> 下不触发（实测宿主 type 是 window，
  // 拿不到 guest），而 guest 自己的创建事件一定会有。
  //
  // 注意这不是「首屏之前」：guest 创建时 getURL() 还是空串，但紧接着
  // <webview> 的 src 就开始导航，attach + Page.enable + addScript 走完时
  // 首屏往往已经跑起来了。applyProfileToWebContents 里注册完会主动重载一次
  // 兜住这一点，否则注入了也赶不上这一屏。
  if (contents.getType() === 'webview') {
    const partition = sessionPartitions.get(contents.session)
    const profile = partition ? profileForPartition(partition) : null
    if (partition) {
      partitionGuests.set(partition, contents)
      contents.once('destroyed', () => {
        // 只在这个分区还指着自己的时候清，避免重开新页面后被旧回调误删。
        if (partitionGuests.get(partition) === contents) partitionGuests.delete(partition)
      })
    }
    if (profile) applyProfileToWebContents(contents, profile)

    contents.on('will-navigate', (event, url) => {
      if (!isHttpUrl(url)) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!isHttpUrl(url)) event.preventDefault()
    })
  }
})

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f5f6f7',
    webPreferences: {
      preload: path.join(dir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  })

  if (app.isPackaged) win.removeMenu()
  win.on('closed', () => {
    win = null
  })
  win.loadFile(path.join(dir, '../dist/index.html')).catch((error) => {
    dialog.showErrorBox('矩阵控制台启动失败', `无法加载页面：${error.message}\n请先执行 npm run build。`)
    app.quit()
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
