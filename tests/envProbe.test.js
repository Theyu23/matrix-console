import test from 'node:test'
import assert from 'node:assert/strict'
import { ENV_PROBE_SCRIPT, ENV_FIELDS, summarizeEnv } from '../src/envProbe.js'

// 探测脚本要在页面里真跑，语法错误必须在这里暴露。
function runProbe() {
  // 探测脚本引用的是全局 Intl，不是 window.Intl；把 mock 作为函数参数注入，
  // 否则测试会读到运行机器的真实时区，CI（UTC）与本地（Asia/Shanghai）结果不同。
  const fn = new Function('window', 'document', 'Intl', 'return (' + ENV_PROBE_SCRIPT + ')')
  return fn(
    {
      navigator: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0',
        platform: 'Win32',
        hardwareConcurrency: 8,
        deviceMemory: 8,
        language: 'zh-CN',
        languages: ['zh-CN', 'zh'],
        webdriver: false,
        maxTouchPoints: 0,
        userAgentData: { platform: 'Windows', mobile: false }
      },
      screen: { width: 1920, height: 1080, colorDepth: 24 },
      devicePixelRatio: 1.25
    },
    {
      createElement: () => ({
        getContext: () => ({
          getExtension: () => null,
          getParameter: () => ''
        })
      })
    },
    { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Shanghai' }) }) }
  )
}

function env(overrides = {}) {
  return {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0',
    platform: 'Win32',
    uaPlatform: 'Windows',
    cores: 8,
    memory: 8,
    language: 'zh-CN',
    languages: 'zh-CN,zh',
    tz: 'Asia/Shanghai',
    screen: '1920x1080x24',
    dpr: 1.25,
    touch: 0,
    glVendor: 'Google Inc.',
    glRenderer: 'ANGLE (NVIDIA)',
    webdriver: false,
    ...overrides
  }
}

test('probe script runs in a page and returns every documented field', () => {
  const result = runProbe()
  for (const { key } of ENV_FIELDS) {
    assert.ok(key in result, `missing field: ${key}`)
  }
  assert.equal(result.cores, 8)
  assert.equal(result.tz, 'Asia/Shanghai')
  assert.equal(result.webdriver, false)
})

test('identical accounts are reported as shared fields', () => {
  const summary = summarizeEnv([
    { id: 'a', nickname: '甲', env: env() },
    { id: 'b', nickname: '乙', env: env() }
  ])
  assert.equal(summary.accountCount, 2)
  // 两台完全一样：所有字段都进「一致」，没有「差异」。
  assert.equal(summary.shared.length, ENV_FIELDS.length)
  assert.equal(summary.varied.length, 0)
  assert.equal(summary.warnings.length, 0)
})

test('differing fields are separated from shared ones', () => {
  const summary = summarizeEnv([
    { id: 'a', nickname: '甲', env: env({ cores: 8, screen: '1920x1080x24' }) },
    { id: 'b', nickname: '乙', env: env({ cores: 4, screen: '2560x1440x24' }) }
  ])
  const variedKeys = summary.varied.map((f) => f.key)
  assert.deepEqual(variedKeys.sort(), ['cores', 'screen'])
  const sharedKeys = summary.shared.map((f) => f.key)
  assert.ok(sharedKeys.includes('ua'))
  assert.ok(!sharedKeys.includes('cores'))
})

test('a single account cannot be called consistent', () => {
  const summary = summarizeEnv([{ id: 'a', nickname: '甲', env: env() }])
  // 一台机器谈不上「一致」——否则界面会误报一个没有意义的结论。
  assert.equal(summary.accountCount, 1)
  assert.equal(summary.shared.length, 0)
})

test('missing values are not counted as agreement', () => {
  const summary = summarizeEnv([
    { id: 'a', nickname: '甲', env: env({ memory: 0 }) },
    { id: 'b', nickname: '乙', env: env({ memory: 0 }) }
  ])
  const memoryField = summary.fields.find((f) => f.key === 'memory')
  // deviceMemory 缺失时双方都是「未提供」，不能算作一致。
  assert.equal(memoryField.same, false)
  assert.deepEqual(memoryField.values, ['未提供', '未提供'])
})

test('UA and navigator.platform mismatch is flagged', () => {
  const summary = summarizeEnv([
    { id: 'a', nickname: '甲', env: env({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/140' }) }
  ])
  const found = summary.warnings.find((w) => w.field === 'platform')
  assert.ok(found, 'should flag UA vs platform mismatch')
  assert.match(found.message, /macOS/)
})

test('Android UA with Linux platform is not a conflict', () => {
  const summary = summarizeEnv([
    {
      id: 'a',
      nickname: '甲',
      env: env({
        ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile',
        platform: 'Linux armv8l',
        uaPlatform: 'Android'
      })
    }
  ])
  assert.equal(summary.warnings.length, 0)
})

test('UA-CH platform contradicting the UA is flagged', () => {
  const summary = summarizeEnv([
    { id: 'a', nickname: '甲', env: env({ uaPlatform: 'macOS' }) }
  ])
  const found = summary.warnings.find((w) => w.field === 'uaPlatform')
  assert.ok(found, 'should flag UA-CH mismatch')
})

test('headless marker and webdriver flag are reported', () => {
  const summary = summarizeEnv([
    {
      id: 'a',
      nickname: '甲',
      env: env({ ua: 'Mozilla/5.0 HeadlessChrome/140', webdriver: true })
    }
  ])
  const fields = summary.warnings.map((w) => w.field)
  assert.ok(fields.includes('ua'))
  assert.ok(fields.includes('webdriver'))
})

test('probe failure becomes a warning instead of breaking the table', () => {
  const summary = summarizeEnv([
    { id: 'a', nickname: '甲', env: env() },
    { id: 'b', nickname: '乙', error: '页面未打开' }
  ])
  assert.equal(summary.accountCount, 1)
  assert.equal(summary.warnings.length, 1)
  assert.match(summary.warnings[0].message, /页面未打开/)
  // 失败的那台在表格里显示「未提供」，不参与一致性判断。
  const uaField = summary.fields.find((f) => f.key === 'ua')
  assert.equal(uaField.values[1], '未提供')
  assert.equal(uaField.same, false)
})

// ── 覆写是否露馅 ──
//
// 值改对了但 toString 不是原生形态，等于主动告诉对方「这项被动过」。
// 这类告警要能被报出来，否则自检面板看着全绿、实际在裸奔。

test('a patch that leaves a non-native toString is reported', () => {
  const summary = summarizeEnv([
    { id: 'a', nickname: '甲', env: env({ nativePlatform: false }) }
  ])
  const w = summary.warnings.find((x) => x.field === 'nativePlatform')
  assert.ok(w, '没有报出 platform 露馅')
  assert.match(w.message, /platform/)
  assert.match(w.message, /露馅/)
})

test('every stealth field is checked, not just platform', () => {
  const keys = ['nativePlatform', 'nativeCores', 'nativeMemory', 'nativeLanguages', 'nativeGetParameter']
  for (const key of keys) {
    const summary = summarizeEnv([{ id: 'a', nickname: '甲', env: env({ [key]: false }) }])
    assert.ok(
      summary.warnings.some((w) => w.field === key),
      `${key} 露馅了却没报警`
    )
  }
})

test('native-looking patches raise nothing', () => {
  const clean = env({
    nativePlatform: true,
    nativeCores: true,
    nativeMemory: true,
    nativeLanguages: true,
    nativeGetParameter: true
  })
  const summary = summarizeEnv([{ id: 'a', nickname: '甲', env: clean }])
  assert.equal(summary.warnings.length, 0)
})

test('unknown stealth state (null) is not treated as a leak', () => {
  // 没读到就没法判断，不能当成「露馅」——否则非安全上下文里
  // 本来就不存在的 deviceMemory 会天天误报。
  const summary = summarizeEnv([
    {
      id: 'a',
      nickname: '甲',
      env: env({
        nativePlatform: null,
        nativeCores: null,
        nativeMemory: null,
        nativeLanguages: null,
        nativeGetParameter: null
      })
    }
  ])
  assert.equal(summary.warnings.length, 0)
})
