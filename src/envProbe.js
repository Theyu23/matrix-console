// 多开一致性自检：在多个账号分区里各跑一次只读探测，把结果并排比较。
//
// 这里不做任何伪装注入。它的唯一用途是让「哪些信号在所有账号之间完全一致」
// 这件事变得可见——一致的字段就是账号之间的关联面，看见它，才有可能决定要不要处理。
// 探测项全部来自页面自述，不修改任何值。

export const ENV_PROBE_SCRIPT = String.raw`(() => {
  function safe(fn, fallback) {
    try {
      var v = fn()
      return v === undefined || v === null ? fallback : v
    } catch (e) {
      return fallback
    }
  }
  var nav = window.navigator || {}
  var scr = window.screen || {}
  var vendor = ''
  var renderer = ''
  var glVersion = ''
  try {
    var canvas = document.createElement('canvas')
    var ctx = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    if (ctx) {
      var dbg = ctx.getExtension('WEBGL_debug_renderer_info')
      if (dbg) {
        vendor = String(ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '')
        renderer = String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
      }
      glVersion = String(ctx.getParameter(ctx.VERSION) || '')
    }
  } catch (e) {}
  var uaData = null
  try {
    uaData = nav.userAgentData || null
  } catch (e) {}
  // ── 覆写是否露馅 ──
  // 原生 getter/method 的 toString 是 'function x() { [native code] }'。
  // 被脚本改过的项如果不做 native 化，这里就能读出来——对平台也是同理，
  // 所以这项要单独暴露出来，让「改了但露馅」变成可见的问题。
  var nativeLike = function (fn) {
    try {
      return /\\{\\s*\\[native code\\]\\s*\\}$/.test(Function.prototype.toString.call(fn))
    } catch (e) {
      return false
    }
  }
  var disguised = function (obj, key) {
    try {
      var d = Object.getOwnPropertyDescriptor(obj, key)
      if (!d) return null
      var fn = d.get || d.value
      return typeof fn === 'function' ? nativeLike(fn) : null
    } catch (e) {
      return null
    }
  }
  var glProto = window.WebGLRenderingContext && WebGLRenderingContext.prototype
  return {
    ua: String(nav.userAgent || ''),
    platform: String(nav.platform || ''),
    uaPlatform: uaData && uaData.platform ? String(uaData.platform) : '',
    mobile: uaData && typeof uaData.mobile === 'boolean' ? uaData.mobile : null,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 0,
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 0,
    language: String(nav.language || ''),
    languages: Array.isArray(nav.languages) ? nav.languages.slice(0, 4).join(',') : '',
    webdriver: nav.webdriver === true,
    tz: safe(function () {
      return String(Intl.DateTimeFormat().resolvedOptions().timeZone || '')
    }, ''),
    screen: [scr.width || 0, scr.height || 0, scr.colorDepth || 0].join('x'),
    dpr: typeof window.devicePixelRatio === 'number'
      ? Math.round(window.devicePixelRatio * 100) / 100
      : 0,
    touch: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    glVendor: vendor,
    glRenderer: renderer,
    glVersion: glVersion,
    // 每项是 true（像原生）/ false（露馅）/ null（没读到，无从判断）。
    nativePlatform: disguised(nav, 'platform'),
    nativeCores: disguised(nav, 'hardwareConcurrency'),
    nativeMemory: disguised(nav, 'deviceMemory'),
    nativeLanguages: disguised(nav, 'languages'),
    nativeGetParameter: glProto ? disguised(glProto, 'getParameter') : null
  }
})()`

// 展示顺序即表格行顺序。第一列是字段说明，不是页面里的属性名。
export const ENV_FIELDS = [
  { key: 'ua', label: 'User-Agent' },
  { key: 'platform', label: 'navigator.platform' },
  { key: 'uaPlatform', label: 'UA-CH platform' },
  { key: 'cores', label: 'CPU 核心数' },
  { key: 'memory', label: 'deviceMemory' },
  { key: 'language', label: '语言' },
  { key: 'languages', label: '语言列表' },
  { key: 'tz', label: '时区' },
  { key: 'screen', label: '屏幕（宽×高×位深）' },
  { key: 'dpr', label: '像素比' },
  { key: 'touch', label: '触点数量' },
  { key: 'glVendor', label: 'WebGL 厂商' },
  { key: 'glRenderer', label: 'WebGL 渲染器' }
]

function osFromUa(ua) {
  const s = String(ua || '')
  if (/Windows NT/i.test(s)) return 'windows'
  if (/Android/i.test(s)) return 'android'
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios'
  if (/CrOS/i.test(s)) return 'chromeos'
  if (/Macintosh|Mac OS X/i.test(s)) return 'mac'
  if (/Linux/i.test(s)) return 'linux'
  return ''
}

function osFromPlatform(platform) {
  const s = String(platform || '')
  if (/^Win/i.test(s)) return 'windows'
  if (/^Mac/i.test(s)) return 'mac'
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios'
  // Android 的 navigator.platform 也是 Linux 开头，UA 里有 Android 才算 android。
  if (/^Linux/i.test(s)) return 'linux'
  return ''
}

function osFromUaPlatform(value) {
  const s = String(value || '')
  if (/Windows/i.test(s)) return 'windows'
  if (/Android/i.test(s)) return 'android'
  if (/iOS|iPadOS/i.test(s)) return 'ios'
  if (/macOS|Mac OS/i.test(s)) return 'mac'
  if (/Chrome OS|Chromium OS/i.test(s)) return 'chromeos'
  if (/Linux/i.test(s)) return 'linux'
  return ''
}

const OS_TEXT = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
  chromeos: 'ChromeOS'
}

function osText(key) {
  return OS_TEXT[key] || key
}

// 这些字段取 0 只可能是「浏览器没提供」，没有 0 台核心或 0 倍像素比这回事。
// touch 不在其中：桌面环境下 maxTouchPoints 就是 0，那是有意义的真实值，
// 当成缺失会让所有桌面账号的「触点数量」都变成不可比。
const ZERO_MEANS_MISSING = new Set(['cores', 'memory', 'dpr'])

// 把原始值规整成表格里显示的样子。
function displayValue(key, raw) {
  if (raw === undefined || raw === null || raw === '') return '未提供'
  if (raw === 0 && ZERO_MEANS_MISSING.has(key)) return '未提供'
  return String(raw)
}

// 单账号内部的自相矛盾。这类问题和技术手段无关：一个自相矛盾的环境本身就可疑。
function accountWarnings(env) {
  const warnings = []
  if (!env) return warnings
  if (/HeadlessChrome/i.test(String(env.ua || ''))) {
    warnings.push({ field: 'ua', message: 'UA 里带 HeadlessChrome 标记' })
  }
  if (env.webdriver === true) {
    warnings.push({ field: 'webdriver', message: 'navigator.webdriver 为 true' })
  }
  // 覆写露馅：值改过了，但 toString 不是原生形态。
  // 这比不改更糟——不改读到的是真实值、自洽；改了露馅等于主动告诉对方「这项被动过」。
  const stealthFields = [
    ['nativePlatform', 'navigator.platform'],
    ['nativeCores', 'hardwareConcurrency'],
    ['nativeMemory', 'deviceMemory'],
    ['nativeLanguages', 'navigator.languages'],
    ['nativeGetParameter', 'WebGL getParameter']
  ]
  for (const [key, label] of stealthFields) {
    if (env[key] === false) {
      warnings.push({ field: key, message: `${label} 被覆写但 toString 不是原生形态（露馅）` })
    }
  }
  const fromUa = osFromUa(env.ua)
  const fromPlatform = osFromPlatform(env.platform)
  // Android 的 platform 就是 Linux 开头，这两者不算冲突。
  const platformOk =
    !fromUa || !fromPlatform || fromUa === fromPlatform || (fromUa === 'android' && fromPlatform === 'linux')
  if (!platformOk) {
    warnings.push({
      field: 'platform',
      message: `UA 说是 ${osText(fromUa)}，navigator.platform 却是 ${env.platform}`
    })
  }
  const fromClientHints = osFromUaPlatform(env.uaPlatform)
  if (fromClientHints && fromUa && fromClientHints !== fromUa) {
    warnings.push({
      field: 'uaPlatform',
      message: `UA 说是 ${osText(fromUa)}，UA-CH 却声明 ${osText(fromClientHints)}`
    })
  }
  if (typeof env.cores === 'number' && env.cores > 0 && (env.cores < 1 || env.cores > 256)) {
    warnings.push({ field: 'cores', message: `核心数 ${env.cores} 不在合理范围` })
  }
  return warnings
}

// rows: [{ id, nickname, env?, error? }]
// 返回逐字段的对比结果 + 每个账号的告警。
export function summarizeEnv(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.id) : []
  const usable = list.filter((r) => r.env)
  const warnings = []
  for (const row of list) {
    if (row.error) {
      warnings.push({
        id: row.id,
        nickname: row.nickname || '',
        field: '',
        message: `采集失败：${row.error}`
      })
      continue
    }
    for (const w of accountWarnings(row.env)) {
      warnings.push({ id: row.id, nickname: row.nickname || '', ...w })
    }
  }

  const fields = ENV_FIELDS.map(({ key, label }) => {
    const values = list.map((row) => displayValue(key, row.env ? row.env[key] : undefined))
    const distinct = [...new Set(values)]
    const provided = values.filter((v) => v !== '未提供')
    // 「相同」只在至少两个账号都有值时才成立：一个账号谈不上一致。
    const same = provided.length >= 2 && provided.length === values.length && distinct.length === 1
    return { key, label, values, distinct, same }
  })

  // 所有账号完全一致的字段就是关联面；有差异的字段是区分点。
  // 只统计成功采集到至少两台的账号。
  const shared = usable.length >= 2 ? fields.filter((f) => f.same) : []
  const varied = usable.length >= 2 ? fields.filter((f) => !f.same) : []

  // 把每行的环境漂移一起带出去，面板直接读得到，不用自己再找一遍。
  const drifts = list
    .map((row) => ({
      id: row.id,
      nickname: row.nickname || '',
      changed: Array.isArray(row.drift?.changed) ? row.drift.changed : []
    }))
    .filter((d) => d.changed.length)

  return { fields, warnings, shared, varied, drifts, accountCount: usable.length }
}
