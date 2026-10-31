// 账号隔离画像。
//
// 隔离要解决的是三件不同的事，必须分开看：
//
//   1. 会话隔离 —— 每个账号一个分区。已经在做了，cookie/localStorage 本来就分开。
//   2. 出口隔离 —— 每个账号走自己的代理。这是真正的关联信号，也是最有效的。
//   3. 环境自洽 —— 每个账号报出去的 UA、平台、语言不互相矛盾。
//
// 第 3 条有个反直觉的地方：**不是每台设备长得不一样就更好，而是每台设备
// 必须长期保持一致**。真实用户的指纹半年不变；一个账号今天报 Windows、
// 明天报 macOS，那才是显眼的特征。所以这里的画像是「生成一次、固定下来」，
// 写进 localStorage，之后每次都用同一份。
//
// 也不做 canvas / WebGL / 音频噪声。这类噪声每次刷新都变，本身就能被聚类，
// 而且和真实硬件的稳定特征（核心数、显卡驱动）对不上，比不加更糟。
// 能自洽改掉的只有「平台 + UA + 语言 + 时区 + 屏幕」这一组，就只改这一组。

export const PROFILE_KEY = 'matrix.profiles'

// navigator.deviceMemory 的取值上限。
//
// 早先这里断言「规范把这一项截在 8、16G/32G 机器也只报 8」。**这个断言是错的**：
// 在当前 Electron 45 / Chromium 上实测（16 GB 机器），原生 deviceMemory 直接返回
// 16，并没有截断到 8。也就是说 8 并不是「唯一合法值」。
//
// 那为什么档位仍然只取 4 和 8：这是最常见的两档，落在大批真实机器的分布里，
// 谁都不会因为「内存 8G」多看一眼。取 16 同样合法，但会让「低配机型」这个
// 档位标签和数值对不上（显卡是核显、内存却报 16），反而更别扭。
//
// 上限保留 8 的实际作用变成了「防止把机器真实内存原样搬进画像」：
// 同一台机器上所有账号如果都报出本机的 16 / 32，那这批账号在内存这一项上
// 完全一致——这正是关联面。档位化之后至少按档分散开了。
export const DEVICE_MEMORY_CAP = 8

// 收口 deviceMemory。用于新画像，也用于修掉存量画像里越界的值：
// 收口 deviceMemory。用于新画像，也用于修掉存量画像里越界的值：
// 早期档位直接照搬了机器真实内存，已经存进 localStorage 的画像带着 16 / 32，
// 不收口就会让同一台机器上所有账号都报出本机真实内存。
export function deviceMemoryFor(memory) {
  const n = Number(memory)
  if (!Number.isFinite(n) || n <= 0) return DEVICE_MEMORY_CAP
  return Math.min(Math.round(n), DEVICE_MEMORY_CAP)
}

// 可选画像档位。都是真实存在且常见的机型，造出来的组合落在真实分布的中间，
// 不会因为「太整齐」或「太罕见」自己跳出来。
//
// 档位数量要跟着账号数量走：pickPreset 是按账号 id 取模分档，
// 档位比账号少，就会有账号共用完全相同的「核心数 × 内存 × 显卡」三元组——
// 这组是经典强指纹。十来个账号至少要有八档以上。
// memory 只取 4 和 8：这两档最常见，落在大批真实机器的分布里；区分度靠核心数和显卡。
// 取值理由与「8 不是唯一合法值」这件事见 DEVICE_MEMORY_CAP 的注释。
//
// 只列 Windows：当前运行环境是 Windows，改成 mac 会和 navigator.platform、
// WebGL 渲染器（ANGLE / NVIDIA）、驱动版本全部对不上。跨平台伪装骗不过
// 一致性检查，只会多出一堆矛盾点。
//
// 不含屏幕尺寸和 DPR：这两项是窗口级属性，一个窗口里所有 webview 共用，
// 按账号改不了。写进画像就会和实际读到的值冲突，所以不写。
// 也就是说同一窗口里的账号屏幕指纹仍是共享的——这是本方案的已知边界。
export const PROFILE_PRESETS = [
  {
    key: 'win-i3-1080',
    label: 'Windows / i3 / 4G / 核显',
    platform: 'Win32',
    cores: 4,
    memory: 4,
    renderer: 'Intel(R) UHD Graphics 630',
    vendor: 'Google Inc. (Intel)',
    languages: ['zh-CN', 'zh', 'en']
  },
  {
    key: 'win-i5-1080',
    label: 'Windows / i5 / 8G / 核显',
    platform: 'Win32',
    cores: 8,
    memory: 8,
    renderer: 'Intel(R) UHD Graphics 620',
    vendor: 'Google Inc. (Intel)',
    languages: ['zh-CN', 'zh', 'en']
  },
  {
    key: 'win-i5-1440',
    label: 'Windows / i5 / 8G / 独显',
    platform: 'Win32',
    cores: 6,
    memory: 8,
    renderer: 'NVIDIA GeForce GTX 1050 Ti',
    vendor: 'Google Inc. (NVIDIA)',
    languages: ['zh-CN', 'zh', 'en-US', 'en']
  },
  {
    key: 'win-r5-1440',
    label: 'Windows / R5 / 16G / 独显',
    platform: 'Win32',
    cores: 12,
    memory: 8,
    renderer: 'AMD Radeon RX 6700 XT',
    vendor: 'Google Inc. (AMD)',
    languages: ['zh-CN', 'zh', 'en-US', 'en']
  },
  {
    key: 'win-r7-1080',
    label: 'Windows / R7 / 8G / 核显',
    platform: 'Win32',
    cores: 16,
    memory: 8,
    renderer: 'AMD Radeon(TM) Graphics',
    vendor: 'Google Inc. (AMD)',
    languages: ['zh-CN', 'zh', 'en']
  },
  {
    key: 'win-i7-1080',
    label: 'Windows / i7 / 16G / 独显',
    platform: 'Win32',
    cores: 16,
    memory: 8,
    renderer: 'NVIDIA GeForce GTX 1660 SUPER',
    vendor: 'Google Inc. (NVIDIA)',
    languages: ['zh-CN', 'zh', 'en-GB', 'en']
  },
  {
    key: 'win-i7-4k',
    label: 'Windows / i7 / 32G / 独显',
    platform: 'Win32',
    cores: 20,
    memory: 8,
    renderer: 'NVIDIA GeForce RTX 3060',
    vendor: 'Google Inc. (NVIDIA)',
    languages: ['zh-CN', 'zh', 'en-US', 'en']
  },
  {
    key: 'win-i9-4k',
    label: 'Windows / i9 / 32G / 独显',
    platform: 'Win32',
    cores: 24,
    memory: 8,
    renderer: 'NVIDIA GeForce RTX 4070',
    vendor: 'Google Inc. (NVIDIA)',
    languages: ['zh-CN', 'zh', 'en-US', 'en']
  },
  {
    key: 'win-r5-1080',
    label: 'Windows / R5 / 4G / 核显',
    platform: 'Win32',
    cores: 6,
    memory: 4,
    renderer: 'AMD Radeon Vega 8 Graphics',
    vendor: 'Google Inc. (AMD)',
    languages: ['zh-CN', 'zh', 'en']
  },
  {
    key: 'win-i5-4k',
    label: 'Windows / i5 / 16G / 核显',
    platform: 'Win32',
    cores: 10,
    memory: 8,
    renderer: 'Intel(R) Iris(R) Xe Graphics',
    vendor: 'Google Inc. (Intel)',
    languages: ['zh-CN', 'zh', 'en-US', 'en']
  }
]

// 时区只放国内几个常见值。跨时区的账号配中文界面本身就不自洽，
// 除非账号设定上就在境外，那种情况这里不覆盖。
export const TIMEZONES = ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Urumqi']

// 档位扩充时刻意保留了原来 4 个档位的 key（只改内存/显卡取值，不换 key）。
// 原因：存量画像里存着 preset key，key 一改 refreshProfile 就认不出来、
// 返回 null，调用方随即按 id 重新算一份，结果是老账号的指纹整体漂移一次。
// 真实设备的指纹不该突然变，所以 key 是兼容性承诺，只增不改名。
export function presetByKey(key) {
  return PROFILE_PRESETS.find((p) => p.key === key) || null
}

// 在可复现的前提下挑一个画像。
// 用账号 id 做种，同一个账号每次算出来的结果相同——即使 localStorage 丢了、
// 或者换了机器打开，画像也不会跟着变。这一点比「随机得更散」重要得多。
export function pickPreset(accountId, presets = PROFILE_PRESETS) {
  const list = Array.isArray(presets) && presets.length ? presets : PROFILE_PRESETS
  const seed = String(accountId || '')
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return list[h % list.length]
}

export function pickTimezone(accountId, zones = TIMEZONES) {
  const list = Array.isArray(zones) && zones.length ? zones : TIMEZONES
  const seed = String(accountId || '')
  let h = 7
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0
  return list[h % list.length]
}

// 给定画像和运行时版本，拼出这个账号该用的 UA。
// Chromium 版本必须跟着实际运行时走：写死了，平台侧比对 sec-ch-ua 就会露。
export function buildProfileUserAgent(preset, chromeVersion) {
  const chrome = String(chromeVersion || '130.0.0.0')
  const base = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  const arch = 'Win64; x64'
  return `Mozilla/5.0 (Windows NT 10.0; ${arch}) ${base}`
}

// 组装一个账号的完整画像。这是要注入到页面里、也是要存下来的东西。
export function buildProfile(accountId, { chromeVersion, preset } = {}) {
  const p = preset || pickPreset(accountId)
  return {
    // 记下生成时用的账号 id，便于排查「这个画像是谁的」。
    accountId: String(accountId || ''),
    preset: p.key,
    platform: p.platform,
    cores: p.cores,
    // 过一遍收口：档位里万一写了 16 / 32，也不会注入成规范外的值。
    memory: deviceMemoryFor(p.memory),
    renderer: p.renderer,
    vendor: p.vendor,
    languages: p.languages.slice(),
    timezone: pickTimezone(accountId),
    ua: buildProfileUserAgent(p, chromeVersion)
  }
}

// 校验一份存下来的画像还能不能用。
// 浏览器升级后 Chromium 版本会变，旧 UA 里的版本号就和新运行时对不上——
// 这种情况下必须重建 UA，否则 sec-ch-ua 报的是新版本、UA 说的是旧版本。
//
// 同时收口越界的 memory：早期档位照搬了机器真实内存，存量画像里存着 16 / 32，
// 不收口的话同一台机器上所有账号都会报出本机真实内存，那是明确的关联面。
export function refreshProfile(profile, { chromeVersion } = {}) {
  if (!profile || typeof profile !== 'object' || !profile.preset) return null
  const preset = presetByKey(profile.preset)
  if (!preset) return null
  const ua = buildProfileUserAgent(preset, chromeVersion)
  const memory = deviceMemoryFor(profile.memory)
  if (profile.ua === ua && profile.memory === memory) return profile
  return { ...profile, ua, memory }
}

// 检查画像内部有没有自相矛盾的地方。
// 只查「同一个账号内部」的矛盾——这类是最容易被判死的，和是否伪装无关。
export function validateProfile(profile) {
  const issues = []
  if (!profile || typeof profile !== 'object') return ['画像缺失']
  if (!profile.preset) issues.push('没有画像档位')
  if (profile.platform !== 'Win32') {
    issues.push('platform 不是 Win32，与 Windows 版 UA 矛盾')
  }
  if (!Array.isArray(profile.languages) || !profile.languages.length) {
    issues.push('语言列表为空')
  } else if (profile.languages[0] !== 'zh-CN') {
    // navigator.language 取自第一位；第一项不是中文，但 UA 和时区都是国内的。
    issues.push('首选语言不是 zh-CN，与国内时区矛盾')
  }
  if (!/^Mozilla\/5\.0 \(Windows NT/.test(String(profile.ua || ''))) {
    issues.push('UA 不是 Windows 形态')
  }
  return issues
}

// 注入到页面里的脚本。在 document_start 就改掉，赶在页面读到之前。
// 只改能被页面直接读到、且能自洽改掉的那几项。
//
// 刻意不碰 devicePixelRatio：它是窗口级属性，一个窗口里所有 webview 共用，
// 按账号改不了。画像里留一个改不动的值，等于给自己留一个矛盾点——
// 读出来的和声明的不一样，比不声明更糟。屏幕尺寸同理，见 PROFILE_NOTES。
export function profileScript(profile) {
  const p = profile || {}
  // 用 JSON 序列化而不是拼字符串，避免语言列表里有引号时把脚本拼坏。
  return `(() => {
  const P = ${JSON.stringify({
    platform: p.platform || 'Win32',
    cores: p.cores,
    // 脚本可能直接拿到一份存量的、没走过 buildProfile 的画像，
    // 所以这里自己再收口一次，不指望上游一定干净。
    memory: deviceMemoryFor(p.memory),
    languages: p.languages || ['zh-CN'],
    renderer: p.renderer,
    vendor: p.vendor
  })}

  // ── native 化 ────────────────────────────────────────────
  // 浏览器原生函数调用 toString() 返回 'function x() { [native code] }'。
  // 覆写过的函数如果不改这一层，页面只要对它取一次 toString 就知道被改过——
  // 那比不改更糟：不改读到的是真实值、自洽；改了但露馅，等于自己贴了个标签。
  //
  // 保持 toString 本身也像原生的：先去拿真 Function.prototype.toString，
  // 再把我们改写过的 toString 也套上同一层，避免「检测 toString 的 toString」这条路。
  const nativeText = (name) => 'function ' + name + '() { [native code] }'
  const realToString = Function.prototype.toString
  const patched = new WeakMap()
  const toStringPatch = function toString() {
    // 被我们改过的东西返回伪造的原生文本，其余一律交回真的 toString。
    const fake = patched.get(this)
    if (fake) return fake
    return realToString.call(this)
  }
  // toStringPatch 自己也得像原生的。
  patched.set(toStringPatch, nativeText('toString'))
  try {
    Object.defineProperty(Function.prototype, 'toString', {
      value: toStringPatch,
      writable: true,
      configurable: true,
      enumerable: false
    })
  } catch (e) {}

  // 把一个函数的 toString 结果登记成原生文本。
  const disguise = (fn, name) => {
    try { patched.set(fn, nativeText(name)) } catch (e) {}
    // 有的检测会顺着 fn.name / fn.length 看，尽量对齐原生 getter 的形态。
    try { Object.defineProperty(fn, 'name', { value: name, configurable: true }) } catch (e) {}
    return fn
  }

  const def = (obj, key, value) => {
    try {
      // getter 自己也要伪装：'get hardwareConcurrency' 才像原生访问器。
      const getter = disguise(() => value, 'get ' + key)
      Object.defineProperty(obj, key, { get: getter, configurable: true, enumerable: false })
    } catch (e) {}
  }

  // 覆写要落在原型上，不能落在实例上。
  //
  // 原生 navigator 的这几项都在 Navigator.prototype 上，实例自身没有自有属性；
  // 直接 def(navigator, ...) 会留下 navigator.hasOwnProperty('platform') === true，
  // 一行就能查出来。所以改原型，实例的形态保持原样。
  const NAV = window.Navigator && Navigator.prototype
  const hasOwn = (obj, key) => {
    try { return !!Object.getOwnPropertyDescriptor(obj, key) } catch (e) { return false }
  }
  // navigator.platform 和硬件相关项。
  if (NAV) {
    def(NAV, 'platform', P.platform)
    def(NAV, 'hardwareConcurrency', P.cores)
    def(NAV, 'language', P.languages[0])
    def(NAV, 'languages', P.languages.slice())
    // deviceMemory 只在安全上下文里存在。原型上本来没有它，就跟着不要造出来——
    // 在一个原生没有这一项的环境里凭空多出一个属性，本身就是可检测的差异。
    if (hasOwn(NAV, 'deviceMemory')) def(NAV, 'deviceMemory', P.memory)
  }

  // WebGL 的厂商/渲染器：页面通过调试扩展取，两个都要覆盖。
  // 用 defineProperty 而不用直接赋值：赋值会留下一个可枚举的自有属性，
  // 原生方法是原型上的不可枚举属性，形状对不上。
  const patchGL = (proto) => {
    if (!proto || !proto.getParameter) return
    const orig = proto.getParameter
    const replacement = disguise(function getParameter(param) {
      // 37445=UNMASKED_VENDOR_WEBGL, 37446=UNMASKED_RENDERER_WEBGL
      if (param === 37445) return P.vendor
      if (param === 37446) return P.renderer
      return orig.call(this, param)
    }, 'getParameter')
    try {
      Object.defineProperty(proto, 'getParameter', {
        value: replacement,
        writable: true,
        configurable: true,
        enumerable: false
      })
    } catch (e) {}
  }
  patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype)
  patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype)
})()`
}

// ── 出口隔离 ──────────────────────────────────────────────
// 每个账号可以配一条自己的代理。这是隔离里最有效的一层：
// 会话和环境都分开，但都从同一个 IP 出去，平台仍然看得出是同一个来源。

export const PROXY_SCHEME_RE = /^(http|https|socks4|socks5):\/\//

// URL 里的凭据是百分号编码的，必须解码后再交给代理：
// 密码里出现 @ : / 时必然被转义，不解码等于拿着 %40 去认证，结果只有 407。
// 畸形转义（比如手抄错一个 %）会抛异常，这里退化成原文，不让一条坏配置拖垮全局。
function decodeCredentialPart(value) {
  const raw = String(value || '')
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// 解析并校验一条代理配置。
// 支持 http://host:port 与 socks5://user:pass@host:port。
export function parseProxy(raw) {
  const value = String(raw || '').trim()
  if (!value) return { ok: true, proxy: null }
  if (!PROXY_SCHEME_RE.test(value)) {
    return { ok: false, error: '只支持 http/https/socks4/socks5 代理' }
  }
  try {
    const u = new URL(value)
    if (!u.hostname) return { ok: false, error: '缺少主机名' }
    const port = Number(u.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ok: false, error: '端口无效' }
    }
    return {
      ok: true,
      proxy: {
        scheme: u.protocol.replace(':', ''),
        host: u.hostname,
        port,
        // URL 里的凭据是百分号编码的。必须解码再用：
        // 密码里出现 @ : / 时必然被转义，不解码就等于拿着一串 %40 去认证，
        // 结果只有 407。
        username: decodeCredentialPart(u.username),
        password: decodeCredentialPart(u.password)
      }
    }
  } catch {
    return { ok: false, error: '代理地址格式不对' }
  }
}

// 转成 Electron 的 proxyRules 字符串。
export function proxyRules(proxy) {
  if (!proxy || !proxy.host) return ''
  const scheme = proxy.scheme || 'http'
  // socks5 在 Chromium 里写 socks5://，socks4 同理。
  return `${scheme}://${proxy.host}:${proxy.port}`
}

// 代理凭据单独取出。
//
// proxyRules 里**不能**带 user:pass：Chromium 的 proxyRules 只认
// scheme://host:port，内嵌凭据会被丢掉，带认证的代理直接返 407。
// 住宅代理、机房代理几乎全部要认证，所以这条路必须走 login 事件回复。
export function proxyCredentials(proxy) {
  if (!proxy || !proxy.host) return null
  const username = String(proxy.username || '')
  const password = String(proxy.password || '')
  if (!username && !password) return null
  return { username, password }
}

// 出口地址的规范化 key，用作兜底表的索引。
export function proxyKey(proxy) {
  if (!proxy || !proxy.host) return ''
  return `${proxy.host}:${proxy.port}`
}

// 把一条代理写进凭据记账表。
//
// 为什么需要这张表：login 事件只给得到代理的 host:port，拿不到分区名。
// 平时靠 webContents.session 反查分区就够了，但探测窗口、后台请求这类
// 场合拿不到，只能按出口地址找凭据。
//
// 两个账号共用同一出口、密码却不同时，这张表只能记住一个值——
// 标成 conflicted，让调用方宁可不回复，也不要拿别的账号的密码去打。
// 记错了密码的后果是 407（都能发现），真正的危险是把 A 的密码发给了
// 只该由 B 用的出口。
export function mergeProxyCredential(table, proxy, creds) {
  if (!creds) return
  const key = proxyKey(proxy)
  if (!key) return
  const prev = table.get(key)
  if (prev && !prev.conflicted && (prev.username !== creds.username || prev.password !== creds.password)) {
    table.set(key, { conflicted: true })
    return
  }
  if (!prev || !prev.conflicted) table.set(key, creds)
}

// 某个账号改代理或消失后，回收它独占的出口兜底条目。
// 还有别的账号挂在这个出口上就不能删——删了会让那些账号失去兜底凭据。
export function releaseProxyCredential(table, others, proxy) {
  if (!proxy) return
  const key = proxyKey(proxy)
  if (!key) return
  const stillUsed = (Array.isArray(others) ? others : []).some((p) => p && proxyKey(p) === key)
  if (!stillUsed) table.delete(key)
}

// 代理配到哪个分区上。每个账号一个分区，所以直接按分区设。
// 这样同一个账号的所有请求（含子资源、媒体流）都从这条出口走。
export function proxyConfigFor(proxy) {
  const rules = proxyRules(proxy)
  if (!rules) return null
  return {
    mode: 'fixed_servers',
    proxyRules: rules,
    // 代理本身不走代理，否则会自己套自己。
    proxyBypassRules: '<-loopback>'
  }
}

// 出口是否真的分开。只统计配了不同代理的账号数——
// 同一个代理挂在多个账号上等于没隔离。
//
// 注意入参：账号里的 proxy 是**原始字符串**，要先解析。
// 直接丢给 proxyRules 会全部拼成空串，结果是所有账号都被算成「未配置」。
function egressKeyOf(account) {
  const raw = account?.proxy
  if (!raw) return ''
  const parsed = parseProxy(raw)
  return parsed.ok ? proxyRules(parsed.proxy) : ''
}

export function summarizeEgress(accounts) {
  const list = (Array.isArray(accounts) ? accounts : []).filter(Boolean)
  const groups = new Map()
  let unconfigured = 0
  for (const a of list) {
    const key = egressKeyOf(a)
    if (!key) {
      unconfigured++
      continue
    }
    groups.set(key, (groups.get(key) || 0) + 1)
  }
  // 一个代理只挂一个账号才算真正隔离。
  let isolated = 0
  let shared = 0
  for (const count of groups.values()) {
    if (count === 1) isolated++
    else shared++
  }
  return {
    total: list.length,
    unconfigured,
    isolated,
    shared,
    egressCount: groups.size
  }
}

// 找出「多个账号共用同一条出口」的代理地址，用于界面提示。
export function sharedEgress(accounts) {
  const counts = new Map()
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a) continue
    const key = egressKeyOf(a)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([rule, count]) => ({ rule, count }))
}

// 存储读写。
export function loadProfiles(storage) {
  try {
    const raw = storage?.getItem?.(PROFILE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [id, p] of Object.entries(parsed)) {
      if (!p || typeof p !== 'object' || !p.preset) continue
      out[id] = p
    }
    return out
  } catch {
    return {}
  }
}

export function saveProfiles(storage, all) {
  // 存储不可用时要如实返回 false，不能因为可选链不抛错就当成写成功了。
  if (!storage || typeof storage.setItem !== 'function') return false
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(all || {}))
    return true
  } catch {
    return false
  }
}
