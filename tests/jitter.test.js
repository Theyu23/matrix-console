import test from 'node:test'
import assert from 'node:assert/strict'
import { jitter, staggerDelay } from '../src/jitter.js'

test('jitter keeps the average around the base', () => {
  // 用一串均匀分布的伪随机值，均值应该回到 base。
  const base = 1_800_000
  let sum = 0
  const N = 1000
  for (let i = 0; i < N; i++) sum += jitter(base, { ratio: 0.25, random: () => i / N, min: 0 })
  const avg = sum / N
  assert.ok(Math.abs(avg - base) < base * 0.01, `均值偏离过大：${avg}`)
})

test('jitter spreads within the configured ratio', () => {
  const base = 100_000
  const lo = jitter(base, { ratio: 0.2, random: () => 0, min: 0 })
  const hi = jitter(base, { ratio: 0.2, random: () => 1, min: 0 })
  // random=0 → 下界，random=1 → 上界。
  assert.equal(lo, Math.round(base * 0.8))
  assert.equal(hi, Math.round(base * 1.2))
})

test('jitter never returns a negative or零 value', () => {
  // ratio 给到 1 时下界是 0，不能让定时器变成忙等。
  const v = jitter(1000, { ratio: 1, random: () => 0, min: 500 })
  assert.equal(v, 500)
  assert.ok(jitter(10, { ratio: 1, random: () => 0 }) >= 1000)
})

test('jitter handles bad input', () => {
  assert.equal(jitter(0), 1000)
  assert.equal(jitter(-5), 1000)
  assert.equal(jitter(NaN), 1000)
  assert.equal(jitter('x'), 1000)
})

test('jitter clamps ratio to 0..1', () => {
  // ratio 超过 1 会把下界推到负数，必须夹住。
  const v = jitter(10_000, { ratio: 5, random: () => 0, min: 0 })
  assert.ok(v >= 0)
  assert.equal(jitter(10_000, { ratio: -1, random: () => 0.5, min: 0 }), 10_000)
})

test('staggerDelay grows with index then caps', () => {
  const a = staggerDelay(0, { baseMs: 500, maxMs: 5000, random: () => 0.5 })
  const b = staggerDelay(3, { baseMs: 500, maxMs: 5000, random: () => 0.5 })
  const z = staggerDelay(100, { baseMs: 500, maxMs: 5000, random: () => 1 })
  assert.ok(b > a, `序号越大延迟应更长：${a} vs ${b}`)
  // 超过上限必须夹住，否则二十几个号会拖几分钟才开完。
  assert.ok(z <= 5000, `超上限：${z}`)
})

test('staggerDelay tolerates bad input', () => {
  const v = staggerDelay(NaN, { baseMs: 100, maxMs: 100, random: () => 0 })
  assert.ok(Number.isFinite(v))
  assert.ok(v >= 0)
})

test('staggerDelay stays random enough to not form a pattern', () => {
  // 同一个序号连续两次取值应该可能不同，否则序号和延迟一一对应，又成了规律。
  const x = staggerDelay(2, { baseMs: 500, maxMs: 5000, random: () => 0.1 })
  const y = staggerDelay(2, { baseMs: 500, maxMs: 5000, random: () => 0.9 })
  assert.notEqual(x, y)
})
