import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LAYOUT_KEY,
  MIN_STAGE,
  SPLITS,
  clamp,
  fitWidth,
  limitMax,
  loadLayout,
  nextWidth,
  normalizeLayout,
  saveLayout,
  stepWidth
} from '../src/splitter.js'

test('clamp 挡住越界与非法值', () => {
  assert.equal(clamp(300, 240, 560), 300)
  assert.equal(clamp(100, 240, 560), 240)
  assert.equal(clamp(9999, 240, 560), 560)
  // NaN / 空值不能变成 NaN 宽度，否则 style 会失效、分栏塌掉。
  assert.equal(clamp(NaN, 240, 560), 240)
  assert.equal(clamp(undefined, 240, 560), 240)
  assert.equal(clamp('abc', 240, 560), 240)
  // 字符串数字要能用（持久化读回来的值可能被当成字符串）。
  assert.equal(clamp('400', 240, 560), 400)
})

test('nextWidth 按增量换算宽度', () => {
  const spec = SPLITS.list
  assert.equal(nextWidth(320, 40, spec), 360)
  assert.equal(nextWidth(320, -40, spec), 280)
  // 越界封顶
  assert.equal(nextWidth(320, 9999, spec), spec.max)
  assert.equal(nextWidth(320, -9999, spec), spec.min)
})

test('nextWidth 的 invert 用于右侧分栏', () => {
  const spec = SPLITS.chat
  // 右侧面板：往左拖（负 dx）才是变宽
  assert.equal(nextWidth(280, -40, spec, true), 320)
  assert.equal(nextWidth(280, 40, spec, true), 240)
})

test('stepWidth 支持方向键与 Shift 大步', () => {
  const spec = SPLITS.list
  assert.equal(stepWidth(320, 'ArrowRight', spec), 336)
  assert.equal(stepWidth(320, 'ArrowLeft', spec), 304)
  assert.equal(stepWidth(320, 'ArrowRight', spec, { big: true }), 384)
  // 其它按键不改变宽度
  assert.equal(stepWidth(320, 'Enter', spec), 320)
  // invert 时方向相反
  assert.equal(stepWidth(280, 'ArrowLeft', SPLITS.chat, { invert: true }), 296)
})

test('limitMax 保证中间区域还有空间', () => {
  // 可用 1200，其它固定占 280，至少留 320 给中间 → 上限 600
  assert.equal(limitMax(SPLITS.env, 1200, 280), 600)
  // 但不低于 min
  assert.equal(limitMax(SPLITS.env, 400, 280), SPLITS.env.min)
  // 窗口极窄时返回 min，调用方拿到的也是 min，不会出现负数
  assert.equal(limitMax(SPLITS.env, 100, 0), SPLITS.env.min)
})

test('fitWidth 把过大的宽度压回可放下', () => {
  // 720 想要，但只放得下 600，压到 600
  assert.equal(fitWidth(720, SPLITS.env, 1200, 280), 600)
  // 正常范围内保持原值
  assert.equal(fitWidth(500, SPLITS.env, 1200, 280), 500)
  // 过小抬到 min
  assert.equal(fitWidth(10, SPLITS.env, 1200, 280), SPLITS.env.min)
})

test('MIN_STAGE 至少留得住网页区', () => {
  // 常见窗口宽度下，三块都拖到最大也不能把中间挤没。
  const available = 1600
  const others = SPLITS.list.def + SPLITS.chat.def
  const max = limitMax(SPLITS.env, available, others)
  assert.ok(others + max + MIN_STAGE <= available, '三块之和加最小中间宽度应放得下')
  assert.equal(max, 1600 - others - MIN_STAGE)
})

test('窗口极窄时宽度仍非负，不会算出无效值', () => {
  // 三个面板的最小宽度之和已经超过 1000px，这种窗口本来就放不下全部面板，
  // 但无论如何不能算出负数或 NaN——那会让 style 失效、整栏塌掉。
  for (const avail of [1000, 700, 400, 0, -50]) {
    for (const key of Object.keys(SPLITS)) {
      const w = fitWidth(9999, SPLITS[key], avail, 600)
      assert.ok(Number.isFinite(w), `${key}@${avail} 得到 ${w}`)
      assert.ok(w >= SPLITS[key].min, `${key}@${avail} 低于最小值`)
    }
  }
})

test('normalizeLayout 补齐缺失字段并夹范围', () => {
  const l = normalizeLayout(null)
  assert.equal(l.list, SPLITS.list.def)
  assert.equal(l.chat, SPLITS.chat.def)
  assert.equal(l.env, SPLITS.env.def)

  const messy = normalizeLayout({ list: 9999, chat: 'x', env: null })
  assert.equal(messy.list, SPLITS.list.max)
  assert.equal(messy.chat, SPLITS.chat.min)
  assert.equal(messy.env, SPLITS.env.def)

  // 非对象输入不能抛
  assert.deepEqual(normalizeLayout(42), normalizeLayout(null))
})

test('存读往返一致', () => {
  const store = new Map()
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  }
  const layout = { list: 400, chat: 300, env: 500 }
  assert.equal(saveLayout(storage, layout), true)
  assert.ok(store.get(LAYOUT_KEY))
  assert.deepEqual(loadLayout(storage), layout)
})

test('没有存储时返回默认值而不是抛错', () => {
  assert.deepEqual(loadLayout(null), normalizeLayout(null))
  assert.deepEqual(loadLayout(undefined), normalizeLayout(null))
  // 存储不可写时要如实返回 false，不能因为可选链静默失败还报成功
  assert.equal(saveLayout(null, { list: 300 }), false)
  assert.equal(saveLayout({}, { list: 300 }), false)
})

test('存坏的数据回落到默认值', () => {
  const storage = {
    getItem: () => '{not json',
    setItem: () => {}
  }
  assert.deepEqual(loadLayout(storage), normalizeLayout(null))
})

test('setItem 抛错时不崩', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded')
    }
  }
  assert.equal(saveLayout(storage, { list: 300 }), false)
})
