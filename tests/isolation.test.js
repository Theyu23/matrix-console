import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEVICE_MEMORY_CAP,
  PROFILE_PRESETS,
  buildProfile,
  buildProfileUserAgent,
  deviceMemoryFor,
  loadProfiles,
  parseProxy,
  pickPreset,
  pickTimezone,
  profileScript,
  proxyConfigFor,
  proxyCredentials,
  proxyKey,
  mergeProxyCredential,
  releaseProxyCredential,
  proxyRules,
  refreshProfile,
  saveProfiles,
  sharedEgress,
  summarizeEgress,
  validateProfile
} from '../src/isolation.js'

const CHROME = '140.0.0.0'

test('profile carries a timezone for per-account override', () => {
  // 时区是唯一能按账号真正分开的一项系统属性（走 CDP Emulation），
  // 所以画像里必须带上它，否则注入等于少了一环。
  const p = buildProfile('x', { chromeVersion: CHROME })
  assert.ok(p.timezone, '画像缺 timezone')
  assert.ok(p.timezone.startsWith('Asia/'))
})

test('profile does not claim window-level attributes it cannot control', () => {
  // screen / dpr 是窗口级属性，一个窗口里所有 webview 共用。
  // 画像里声明了却改不动，实际值和声明值冲突，比不声明更糟。
  const p = buildProfile('x', { chromeVersion: CHROME })
  assert.equal(p.dpr, undefined)
  assert.equal(p.screen, undefined)
})

test('profileScript leaves devicePixelRatio alone', () => {
  const src = profileScript(buildProfile('x', { chromeVersion: CHROME }))
  assert.ok(!src.includes('devicePixelRatio'))
})

test('same account id always yields the same profile', () => {
  // 这是环境层最重要的性质：画像必须长期固定，不能每次算都不一样。
  const a = buildProfile('acct-1', { chromeVersion: CHROME })
  const b = buildProfile('acct-1', { chromeVersion: CHROME })
  assert.deepEqual(a, b)
})

test('different accounts can land on different presets', () => {
  const keys = new Set()
  for (let i = 0; i < 20; i++) keys.add(buildProfile(`id-${i}`, { chromeVersion: CHROME }).preset)
  assert.ok(keys.size > 1, '二十个账号不该全落在同一个档位')
})

test('profile presets are all Windows and self-consistent', () => {
  // 跨平台伪装会和 WebGL 渲染器、UA 全部矛盾，这里只允许 Windows。
  for (const p of PROFILE_PRESETS) {
    assert.equal(p.platform, 'Win32', `${p.key} 不是 Win32`)
    assert.ok(p.cores > 0 && p.memory > 0)
    assert.equal(p.languages[0], 'zh-CN', `${p.key} 首选语言不是中文`)
  }
})

test('buildProfile fills every field the injector needs', () => {
  const p = buildProfile('x', { chromeVersion: CHROME })
  for (const key of ['platform', 'cores', 'memory', 'languages', 'timezone', 'ua', 'preset']) {
    assert.ok(p[key], `缺字段 ${key}`)
  }
  assert.ok(p.ua.includes('Chrome/' + CHROME))
})

test('UA version follows the runtime, never hardcoded', () => {
  const a = buildProfileUserAgent(PROFILE_PRESETS[0], '141.0.1.2')
  const b = buildProfileUserAgent(PROFILE_PRESETS[0], '142.0.0.0')
  assert.ok(a.includes('141.0.1.2'))
  assert.ok(b.includes('142.0.0.0'))
  assert.notEqual(a, b)
})

test('UA is Windows-shaped regardless of preset', () => {
  for (const p of PROFILE_PRESETS) {
    assert.match(buildProfileUserAgent(p, CHROME), /^Mozilla\/5\.0 \(Windows NT/)
  }
})

test('pickPreset falls back safely', () => {
  assert.ok(pickPreset('anything'))
  assert.ok(pickPreset('', []))
  assert.ok(pickPreset(null, null))
})

test('timezone stays in the domestic set', () => {
  for (let i = 0; i < 30; i++) {
    assert.ok(['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Urumqi'].includes(pickTimezone(`id-${i}`)))
  }
})

test('validateProfile accepts generated profiles', () => {
  for (let i = 0; i < 10; i++) {
    const issues = validateProfile(buildProfile(`v-${i}`, { chromeVersion: CHROME }))
    assert.deepEqual(issues, [], `id-${i} 画像自相矛盾：${issues.join('，')}`)
  }
})

test('validateProfile reports real contradictions', () => {
  const good = buildProfile('x', { chromeVersion: CHROME })
  assert.ok(validateProfile({ ...good, platform: 'MacIntel' }).length > 0)
  assert.ok(validateProfile({ ...good, languages: ['en-US'] }).length > 0)
  assert.ok(validateProfile({ ...good, languages: [] }).length > 0)
  assert.ok(validateProfile({ ...good, ua: 'curl/8' }).length > 0)
  assert.ok(validateProfile(null).length > 0)
})

test('refreshProfile rebuilds the UA when the runtime upgrades', () => {
  // 浏览器升级后旧 UA 的版本号必须跟着换，否则和 sec-ch-ua 对不上。
  const old = buildProfile('x', { chromeVersion: '130.0.0.0' })
  const next = refreshProfile(old, { chromeVersion: '141.0.0.0' })
  assert.ok(next.ua.includes('141.0.0.0'))
  assert.equal(next.preset, old.preset)
  assert.equal(next.cores, old.cores)
})

test('refreshProfile returns the same object when nothing changed', () => {
  const p = buildProfile('x', { chromeVersion: CHROME })
  assert.equal(refreshProfile(p, { chromeVersion: CHROME }), p)
})

test('refreshProfile rejects unusable input', () => {
  assert.equal(refreshProfile(null, { chromeVersion: CHROME }), null)
  assert.equal(refreshProfile({}, { chromeVersion: CHROME }), null)
  assert.equal(refreshProfile({ preset: 'no-such-preset' }, { chromeVersion: CHROME }), null)
})

test('profileScript embeds the profile values', () => {
  const p = buildProfile('x', { chromeVersion: CHROME })
  const src = profileScript(p)
  assert.ok(src.includes('hardwareConcurrency'))
  assert.ok(src.includes('37445'))
  assert.ok(src.includes('37446'))
  // 脚本必须是自执行的，否则注入后不会跑。
  assert.ok(src.trim().startsWith('(() =>') || src.includes('(() =>'))
})

test('profileScript does not break on quotes in values', () => {
  // 用 JSON 序列化而不是拼字符串，值里有引号也不会把脚本拼坏。
  const src = profileScript({ languages: ['zh"CN'], platform: 'Win32' })
  assert.ok(src.includes('(() =>'))
})

// ── native 化 ──
//
// 覆写不做 native 化，页面一句 toString 就知道被改过；那比不改更糟。
// 这几条钉住注入脚本里的关键做法，防止以后被简化回去。

test('profileScript disguises patched functions as native', () => {
  const src = profileScript(buildProfile('x', { chromeVersion: CHROME }))
  // 必须伪造原生文本，否则 toString 一眼看穿。
  assert.ok(src.includes('[native code]'), '没有伪造 native 文本')
  // 必须接管 Function.prototype.toString，否则读 getter 的源码就露馅。
  assert.ok(src.includes('Function.prototype'), '没有接管 toString')
  // 也要防「检测 toString 自己的 toString」这条路。
  assert.ok(src.includes('toStringPatch'), 'toString 自身没做伪装')
})

test('profileScript patches the Navigator prototype, not the instance', () => {
  const src = profileScript(buildProfile('x', { chromeVersion: CHROME }))
  // 定义在实例上会留下 navigator.hasOwnProperty('platform') === true，一眼可查。
  assert.ok(src.includes('Navigator.prototype'), '没有落在原型上')
  // 只看代码行，注释里提到 def(navigator, ...) 是在解释原因，不算。
  const codeLines = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|$)/.test(l))
    .join('\n')
  assert.ok(!/def\(navigator,/.test(codeLines), '仍然直接改实例')
})

test('profileScript leaves no enumerable own property behind', () => {
  const src = profileScript(buildProfile('x', { chromeVersion: CHROME }))
  // 原生 getter 在原型上不可枚举；定义成可枚举是另一种痕迹。
  assert.ok(!/enumerable:\s*true/.test(src), '留下了可枚举属性')
})

test('profileScript only defines deviceMemory when the browser exposes it', () => {
  const src = profileScript(buildProfile('x', { chromeVersion: CHROME }))
  // deviceMemory 只在安全上下文里存在；凭空造出来本身就可检测。
  assert.ok(src.includes('deviceMemory'), '没有处理 deviceMemory')
  assert.ok(
    /getOwnPropertyDescriptor[\s\S]{0,200}deviceMemory|\bhasOwn\b/.test(src),
    '没有先判断 deviceMemory 是否本来就存在'
  )
})

test('parseProxy accepts the supported schemes', () => {
  for (const raw of [
    'http://1.2.3.4:8080',
    'https://1.2.3.4:8080',
    'socks4://1.2.3.4:1080',
    'socks5://1.2.3.4:1080'
  ]) {
    const r = parseProxy(raw)
    assert.equal(r.ok, true, `${raw} 应被接受`)
    assert.ok(r.proxy.host)
  }
})

test('parseProxy extracts credentials', () => {
  const r = parseProxy('socks5://user:p%40ss@1.2.3.4:1080')
  assert.equal(r.ok, true)
  assert.equal(r.proxy.username, 'user')
  // p%40ss 是 p@ss 的 URL 编码。这里必须是解码后的原文：
  // 拿 %40 去认证只会得到 407。
  assert.equal(r.proxy.password, 'p@ss')
})

test('parseProxy treats empty as direct connection', () => {
  for (const raw of ['', '   ', null, undefined]) {
    assert.deepEqual(parseProxy(raw), { ok: true, proxy: null })
  }
})

test('parseProxy rejects junk', () => {
  for (const raw of ['1.2.3.4:8080', 'ftp://1.2.3.4:21', 'http://', 'http://host', 'http://host:99999']) {
    assert.equal(parseProxy(raw).ok, false, `${raw} 应被拒绝`)
  }
})

test('proxyRules renders an Electron proxy string', () => {
  const { proxy } = parseProxy('socks5://1.2.3.4:1080')
  assert.equal(proxyRules(proxy), 'socks5://1.2.3.4:1080')
  assert.equal(proxyRules(null), '')
})

test('proxyConfigFor builds a fixed_servers config', () => {
  const { proxy } = parseProxy('http://1.2.3.4:8080')
  const cfg = proxyConfigFor(proxy)
  assert.equal(cfg.mode, 'fixed_servers')
  assert.equal(cfg.proxyRules, 'http://1.2.3.4:8080')
  assert.ok(cfg.proxyBypassRules)
  assert.equal(proxyConfigFor(null), null)
})

// 带认证的代理：凭据不能进 proxyRules，必须单独走 login 事件。
// Chromium 的 proxyRules 只认 scheme://host:port，内嵌 user:pass 会被丢掉，
// 结果就是所有带认证的代理一律 407——账号根本打不开。

test('proxyRules never carries credentials', () => {
  const { proxy } = parseProxy('http://user123:pass456@gate.example.com:8000')
  const rules = proxyRules(proxy)
  assert.equal(rules, 'http://gate.example.com:8000')
  // 凭据泄漏到 URL 里也不行，日志和报错会把它们带出去。
  assert.ok(!rules.includes('user123'))
  assert.ok(!rules.includes('pass456'))
})

test('proxyCredentials extracts credentials for the login event', () => {
  const { proxy } = parseProxy('http://user123:pass456@gate.example.com:8000')
  assert.deepEqual(proxyCredentials(proxy), { username: 'user123', password: 'pass456' })
})

test('proxyCredentials returns null when there is nothing to send', () => {
  const anon = parseProxy('http://gate.example.com:8000')
  assert.equal(proxyCredentials(anon.proxy), null, '无认证代理不该产生凭据')
  assert.equal(proxyCredentials(null), null)
})

test('proxyCredentials decodes percent-encoded secrets', () => {
  // 密码里的 @ : / 在 URL 里必须转义，取回来要是原文，否则代理认证必然失败。
  const { proxy } = parseProxy('socks5://user:p%40ss%3Aword@1.2.3.4:1080')
  assert.deepEqual(proxyCredentials(proxy), { username: 'user', password: 'p@ss:word' })
})

// 出口兜底凭据表。
//
// login 事件只给得到 host:port，拿不到分区，所以需要一张按出口地址索引的表。
// 这里验的是它的记账规则：共用出口怎么处理、账号消失后怎么回收。

test('proxyKey identifies an endpoint without credentials', () => {
  const { proxy } = parseProxy('http://u:p@gw.example.com:8000')
  assert.equal(proxyKey(proxy), 'gw.example.com:8000')
  assert.equal(proxyKey(null), '')
})

test('mergeProxyCredential stores a single account credential', () => {
  const table = new Map()
  const { proxy } = parseProxy('http://u1:p1@gw.example.com:8000')
  mergeProxyCredential(table, proxy, proxyCredentials(proxy))
  assert.deepEqual(table.get('gw.example.com:8000'), { username: 'u1', password: 'p1' })
})

test('mergeProxyCredential marks a conflict when passwords differ', () => {
  const table = new Map()
  const a = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  const b = parseProxy('http://u2:p2@gw.example.com:8000').proxy
  mergeProxyCredential(table, a, proxyCredentials(a))
  mergeProxyCredential(table, b, proxyCredentials(b))
  // 同一个出口上出现两套密码：只能记冲突，宁可不在兜底路径上回复，
  // 也不能把 A 的密码发给只该由 B 用的出口。
  assert.deepEqual(table.get('gw.example.com:8000'), { conflicted: true })
})

test('mergeProxyCredential keeps the value when credentials match', () => {
  const table = new Map()
  const a = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  const b = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  mergeProxyCredential(table, a, proxyCredentials(a))
  mergeProxyCredential(table, b, proxyCredentials(b))
  assert.deepEqual(table.get('gw.example.com:8000'), { username: 'u1', password: 'p1' })
})

test('mergeProxyCredential leaves a conflict unresolved', () => {
  const table = new Map()
  const a = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  const b = parseProxy('http://u2:p2@gw.example.com:8000').proxy
  mergeProxyCredential(table, a, proxyCredentials(a))
  mergeProxyCredential(table, b, proxyCredentials(b))
  // 冲突之后再来第三个账号，不能把标记覆盖掉。
  const c = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  mergeProxyCredential(table, c, proxyCredentials(c))
  assert.deepEqual(table.get('gw.example.com:8000'), { conflicted: true })
})

test('releaseProxyCredential keeps the entry while others still use it', () => {
  const table = new Map()
  const gw = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  mergeProxyCredential(table, gw, proxyCredentials(gw))
  // 另一个账号还挂着这个出口，条目不能删，否则它失去兜底凭据。
  releaseProxyCredential(table, [gw], gw)
  assert.deepEqual(table.get('gw.example.com:8000'), { username: 'u1', password: 'p1' })
})

test('releaseProxyCredential drops the entry once nobody uses it', () => {
  const table = new Map()
  const gw = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  mergeProxyCredential(table, gw, proxyCredentials(gw))
  releaseProxyCredential(table, [], gw)
  assert.equal(table.has('gw.example.com:8000'), false)
})

test('releaseProxyCredential does not touch other endpoints', () => {
  const table = new Map()
  const a = parseProxy('http://u1:p1@gw.example.com:8000').proxy
  const b = parseProxy('http://u9:p9@other.example.com:9000').proxy
  mergeProxyCredential(table, a, proxyCredentials(a))
  mergeProxyCredential(table, b, proxyCredentials(b))
  releaseProxyCredential(table, [b], a)
  assert.equal(table.has('gw.example.com:8000'), false)
  assert.deepEqual(table.get('other.example.com:9000'), { username: 'u9', password: 'p9' })
})

test('summarizeEgress counts unconfigured accounts', () => {
  const s = summarizeEgress([{ proxy: '' }, {}, { proxy: 'http://1.1.1.1:1' }])
  assert.equal(s.total, 3)
  assert.equal(s.unconfigured, 2)
  assert.equal(s.isolated, 1)
})

test('summarizeEgress treats one account per proxy as isolated', () => {
  const s = summarizeEgress([
    { proxy: 'http://1.1.1.1:1' },
    { proxy: 'http://2.2.2.2:2' },
    { proxy: 'http://3.3.3.3:3' }
  ])
  assert.equal(s.isolated, 3)
  assert.equal(s.shared, 0)
  assert.equal(s.egressCount, 3)
})

test('summarizeEgress flags a proxy shared by several accounts', () => {
  // 同一个代理挂多个账号等于没隔离，必须能被识别出来。
  const s = summarizeEgress([
    { proxy: 'http://1.1.1.1:1' },
    { proxy: 'http://1.1.1.1:1' },
    { proxy: 'http://2.2.2.2:2' }
  ])
  assert.equal(s.isolated, 1)
  assert.equal(s.shared, 1)
  assert.equal(s.egressCount, 2)
})

test('summarizeEgress tolerates junk', () => {
  assert.deepEqual(summarizeEgress(null), {
    total: 0,
    unconfigured: 0,
    isolated: 0,
    shared: 0,
    egressCount: 0
  })
})

test('sharedEgress lists only proxies used more than once', () => {
  const shared = sharedEgress([
    { proxy: 'http://1.1.1.1:1' },
    { proxy: 'http://1.1.1.1:1' },
    { proxy: 'http://2.2.2.2:2' }
  ])
  assert.equal(shared.length, 1)
  assert.equal(shared[0].rule, 'http://1.1.1.1:1')
  assert.equal(shared[0].count, 2)
})

test('profile storage round-trips and survives corruption', () => {
  const store = new Map()
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  }
  const p = buildProfile('x', { chromeVersion: CHROME })
  assert.equal(saveProfiles(storage, { x: p }), true)
  assert.deepEqual(loadProfiles(storage), { x: p })

  // 坏数据不能让整个画像表丢掉。
  store.set('matrix.profiles', 'not json')
  assert.deepEqual(loadProfiles(storage), {})
  store.set('matrix.profiles', '[1,2,3]')
  assert.deepEqual(loadProfiles(storage), {})
  store.set('matrix.profiles', JSON.stringify({ a: { preset: 'x' }, b: null }))
  assert.deepEqual(Object.keys(loadProfiles(storage)), ['a'])
})

test('profile storage never throws on a hostile storage', () => {
  const boom = {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('quota')
    }
  }
  assert.deepEqual(loadProfiles(boom), {})
  assert.equal(saveProfiles(boom, {}), false)
  assert.deepEqual(loadProfiles(null), {})
  assert.equal(saveProfiles(null, {}), false)
})

// ── deviceMemory 上限 ────────────────────────────────────
// 真实 Chrome 对 8G 及以上的机器一律报 8。报 16 / 32 是规范里
// 不可能出现的值，等于自曝这一项是编的。

test('deviceMemory never exceeds the spec cap of 8', () => {
  for (const p of PROFILE_PRESETS) {
    const built = buildProfile('x', { chromeVersion: CHROME, preset: p })
    assert.ok(
      built.memory <= DEVICE_MEMORY_CAP,
      `${p.key} 的 memory=${built.memory} 超过上限 ${DEVICE_MEMORY_CAP}`
    )
  }
})

test('deviceMemoryFor clamps oversized values instead of passing them through', () => {
  assert.equal(deviceMemoryFor(16), 8)
  assert.equal(deviceMemoryFor(32), 8)
  assert.equal(deviceMemoryFor(64), 8)
})

test('deviceMemoryFor keeps in-range values and rejects garbage', () => {
  assert.equal(deviceMemoryFor(4), 4)
  assert.equal(deviceMemoryFor(8), 8)
  assert.equal(deviceMemoryFor(1), 1)
  // 非数字、0、负数、NaN 都退回上限值，不能注入成 undefined 让页面读到真实值。
  assert.equal(deviceMemoryFor(0), 8)
  assert.equal(deviceMemoryFor(-2), 8)
  assert.equal(deviceMemoryFor(NaN), 8)
  assert.equal(deviceMemoryFor(undefined), 8)
  assert.equal(deviceMemoryFor('16'), 8)
})

test('profileScript injects a capped deviceMemory, never the raw preset value', () => {
  // 直接用一份越界的画像去生成脚本，注入出来的也必须是 8。
  const bad = { ...buildProfile('x', { chromeVersion: CHROME }), memory: 32 }
  const src = profileScript(bad)
  assert.ok(!src.includes('"memory":32'), '注入脚本里还是 32')
  assert.ok(src.includes('"memory":8'), '注入脚本没有收口到 8')
})

test('refreshProfile repairs an already-stored out-of-range memory', () => {
  // 存量画像里存着 16 / 32，不回退就会一直读到越界数字。
  const stored = { ...buildProfile('x', { chromeVersion: CHROME }), memory: 32 }
  const fixed = refreshProfile(stored, { chromeVersion: CHROME })
  assert.equal(fixed.memory, 8)
})

test('refreshProfile keeps memory when it is already valid', () => {
  const p = buildProfile('x', { chromeVersion: CHROME })
  const same = refreshProfile(p, { chromeVersion: CHROME })
  // 没有需要修的地方就原样返回，避免每次启动都重写 localStorage。
  assert.equal(same, p)
})

// ── 档位区分度 ────────────────────────────────────────────
// pickPreset 按账号 id 取模分档。档位不足时，账号会共用完全相同的
// 「核心数 × 内存 × 显卡」三元组，这是经典强指纹。

test('preset fingerprints are unique', () => {
  const prints = PROFILE_PRESETS.map((p) => `${p.cores}/${p.memory}/${p.renderer}`)
  assert.equal(new Set(prints).size, prints.length, '有档位的核心数+内存+显卡组合重复')
})

test('presets give a dozen accounts enough distinct fingerprints', () => {
  // 十来个账号是常见规模，撞档率要低到可以接受。
  const prints = new Set()
  for (let i = 0; i < 12; i++) {
    const p = buildProfile(`acct-${i}`, { chromeVersion: CHROME })
    prints.add(`${p.cores}/${p.memory}/${p.renderer}`)
  }
  assert.ok(prints.size >= 8, `12 个账号只分到了 ${prints.size} 种指纹`)
})

test('every preset has a unique key and a Windows UA', () => {
  const keys = PROFILE_PRESETS.map((p) => p.key)
  assert.equal(new Set(keys).size, keys.length, '档位 key 有重复')
  for (const p of PROFILE_PRESETS) {
    assert.equal(p.platform, 'Win32', `${p.key} 不是 Win32`)
    assert.ok(p.cores > 0 && p.memory > 0, `${p.key} 核心数或内存不合法`)
    assert.ok(buildProfileUserAgent(p, CHROME).includes('Windows NT'))
  }
})
