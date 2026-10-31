import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TIER,
  TIERS,
  TIER_INTERVAL,
  includeInBatch,
  intervalFor,
  isMain,
  nextTier,
  normalizeTier,
  summarizeTiers,
  tierOf
} from '../src/tiers.js'

test('tierOf defaults to spare', () => {
  assert.equal(tierOf({}), DEFAULT_TIER)
  assert.equal(tierOf(null), DEFAULT_TIER)
  assert.equal(tierOf({ tier: 'boss' }), 'spare')
  assert.equal(tierOf({ tier: 'main' }), 'main')
})

test('isMain only accepts the main tier', () => {
  assert.equal(isMain({ tier: 'main' }), true)
  assert.equal(isMain({ tier: 'spare' }), false)
  assert.equal(isMain(undefined), false)
})

test('main accounts get a shorter check interval', () => {
  // 主力被踢下线要尽早知道，间隔必须比备用短。
  assert.ok(intervalFor({ tier: 'main' }) < intervalFor({ tier: 'spare' }))
  assert.equal(intervalFor({ tier: 'main' }), TIER_INTERVAL.main)
  assert.equal(intervalFor({ tier: 'spare' }), TIER_INTERVAL.spare)
})

test('intervalFor falls back to spare for junk input', () => {
  assert.equal(intervalFor(null), TIER_INTERVAL.spare)
  assert.equal(intervalFor({ tier: 'x' }), TIER_INTERVAL.spare)
})

test('includeInBatch skips main accounts by default', () => {
  // 批量动作形态最整齐，主力不该承担这种曝光。
  assert.equal(includeInBatch({ tier: 'main' }), false)
  assert.equal(includeInBatch({ tier: 'spare' }), true)
})

test('includeInBatch can be told to include main', () => {
  assert.equal(includeInBatch({ tier: 'main' }, { includeMain: true }), true)
})

test('includeInBatch rejects nothing-ish for a missing account', () => {
  assert.equal(includeInBatch(null), false)
  assert.equal(includeInBatch(undefined), false)
})

test('summarizeTiers counts both groups', () => {
  const accounts = [{ tier: 'main' }, { tier: 'spare' }, { tier: 'main' }, {}]
  assert.deepEqual(summarizeTiers(accounts), { total: 4, main: 2, spare: 2 })
  assert.deepEqual(summarizeTiers([]), { total: 0, main: 0, spare: 0 })
  assert.deepEqual(summarizeTiers(null), { total: 0, main: 0, spare: 0 })
})

test('summarizeTiers drops holes in the array', () => {
  assert.deepEqual(summarizeTiers([null, { tier: 'main' }, undefined]), {
    total: 1,
    main: 1,
    spare: 0
  })
})

test('nextTier toggles both ways', () => {
  assert.equal(nextTier({ tier: 'main' }), 'spare')
  assert.equal(nextTier({ tier: 'spare' }), 'main')
  assert.equal(nextTier({}), 'main')
})

test('normalizeTier maps everything unknown to spare', () => {
  // 老数据没有 tier 字段，读出来必须是 spare 而不是 undefined，
  // 否则上墙排序会把它们排错位置。
  assert.equal(normalizeTier(undefined), 'spare')
  assert.equal(normalizeTier(null), 'spare')
  assert.equal(normalizeTier(''), 'spare')
  assert.equal(normalizeTier('MAIN'), 'spare')
  assert.equal(normalizeTier('main'), 'main')
})

test('every declared tier has an interval', () => {
  for (const t of TIERS) {
    assert.ok(Number.isFinite(TIER_INTERVAL[t]), `${t} 缺间隔配置`)
    assert.ok(TIER_INTERVAL[t] > 0)
  }
})
