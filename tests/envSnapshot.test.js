import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_SNAPSHOTS,
  appendSnapshot,
  compareWithLatest,
  describeSnapshot,
  diffSnapshot,
  loadSnapshots,
  pickTracked,
  saveSnapshots
} from '../src/envSnapshot.js'

const ENV = {
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140',
  platform: 'Win32',
  uaPlatform: 'Windows',
  cores: 24,
  memory: 16,
  language: 'zh-CN',
  timezone: 'Asia/Shanghai',
  screen: '1707x1067x24',
  webglVendor: 'ANGLE (NVIDIA)',
  webglRenderer: 'NVIDIA GeForce RTX 5060',
  // 这两个不参与比对：窗口缩放就会变，记进来只会制造噪声。
  dpr: 1.5,
  touch: 10
}

test('pickTracked keeps only diagnostic fields', () => {
  const t = pickTracked(ENV)
  assert.equal(t.ua, ENV.ua)
  assert.equal(t.timezone, 'Asia/Shanghai')
  // dpr 和 touch 不该进快照，否则每次缩放都被判成环境变了。
  assert.equal('dpr' in t, false)
  assert.equal('touch' in t, false)
})

test('pickTracked normalises missing values to empty string', () => {
  const t = pickTracked({ ua: null, cores: 0 })
  assert.equal(t.ua, '')
  // 0 是真实值（虽然核心数不可能是 0），不能当成缺失丢掉。
  assert.equal(t.cores, '0')
  assert.equal(pickTracked(null).ua, '')
})

test('diffSnapshot reports changed fields only', () => {
  const after = { ...ENV, ua: 'Mozilla/5.0 (Macintosh) Chrome/141', cores: 12 }
  const changed = diffSnapshot(ENV, after)
  assert.deepEqual(changed.sort(), ['cores', 'ua'])
})

test('diffSnapshot treats an empty value as no change', () => {
  // 某次没取到 WebGL 不代表浏览器变了，这种不该报漂移。
  const after = { ...ENV, webglRenderer: '' }
  assert.deepEqual(diffSnapshot(ENV, after), [])
})

test('diffSnapshot returns nothing for identical input', () => {
  assert.deepEqual(diffSnapshot(ENV, { ...ENV }), [])
})

test('appendSnapshot pushes and keeps order', () => {
  let list = []
  list = appendSnapshot(list, { ts: 1000, ...ENV })
  list = appendSnapshot(list, { ts: 2000, ...ENV })
  assert.equal(list.length, 2)
  assert.equal(list[1].ts, 2000)
  // 不该改动入参。
  assert.equal(appendSnapshot([], { ts: 1, ...ENV }).length, 1)
})

test('appendSnapshot trims to the cap keeping the newest', () => {
  let list = []
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
    list = appendSnapshot(list, { ts: i, ...ENV })
  }
  assert.equal(list.length, MAX_SNAPSHOTS)
  // 裁掉的是最旧的，最新的必须还在。
  assert.equal(list[list.length - 1].ts, MAX_SNAPSHOTS + 4)
})

test('appendSnapshot tolerates junk input', () => {
  assert.equal(appendSnapshot(null, { ts: 1, ...ENV }).length, 1)
  assert.equal(appendSnapshot('x', { ts: 1, ...ENV }).length, 1)
  assert.equal(appendSnapshot([], null).length, 1)
})

test('compareWithLatest flags the first snapshot', () => {
  assert.deepEqual(compareWithLatest([], ENV), { first: true, changed: [] })
})

test('compareWithLatest only compares against the last entry', () => {
  // 中间那条有差异不该影响判断——要回答的是「自上次以来变没变」。
  const list = [{ ts: 1, tracked: pickTracked(ENV) }]
  const r = compareWithLatest(list, { ...ENV, timezone: 'America/New_York' })
  assert.equal(r.first, false)
  assert.deepEqual(r.changed, ['timezone'])
})

test('compareWithLatest reports no drift for stable env', () => {
  const list = [{ ts: 1, tracked: pickTracked(ENV) }]
  assert.deepEqual(compareWithLatest(list, { ...ENV }).changed, [])
})

test('loadSnapshots survives junk storage', () => {
  const bad = { getItem: () => 'not json' }
  assert.deepEqual(loadSnapshots(bad), {})
  assert.deepEqual(loadSnapshots({ getItem: () => null }), {})
  assert.deepEqual(loadSnapshots(null), {})
  // 数组不是合法的账号映射。
  assert.deepEqual(loadSnapshots({ getItem: () => '[1,2]' }), {})
})

test('loadSnapshots drops malformed entries', () => {
  const store = {
    getItem: () =>
      JSON.stringify({
        a: [{ ts: 1, tracked: { ua: 'x' } }, { nope: 1 }, null],
        b: 'not-array'
      })
  }
  const out = loadSnapshots(store)
  assert.equal(out.a.length, 1)
  assert.equal('b' in out, false)
})

test('save and load round-trip', () => {
  const mem = new Map()
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v)
  }
  const all = { a: [{ ts: 1, tracked: pickTracked(ENV) }] }
  assert.equal(saveSnapshots(store, all), true)
  assert.deepEqual(loadSnapshots(store), all)
})

test('saveSnapshots reports failure instead of throwing', () => {
  // 配额满时 localStorage 会抛，档案不是关键数据，不能把整条流程带崩。
  const store = {
    setItem: () => {
      throw new Error('QuotaExceededError')
    }
  }
  assert.equal(saveSnapshots(store, {}), false)
})

test('describeSnapshot renders a readable summary', () => {
  assert.equal(describeSnapshot([]), '还没有环境快照')
  assert.equal(describeSnapshot(null), '还没有环境快照')
  const text = describeSnapshot([{ ts: new Date(2026, 2, 14, 9, 5).getTime(), tracked: {} }])
  assert.match(text, /1 条/)
  assert.match(text, /3月14日 09:05/)
})
