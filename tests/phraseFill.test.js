import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildContext,
  createRotator,
  nextGroupName,
  periodOf,
  renderPhrase
} from '../src/phraseFill.js'

test('periodOf maps hours to natural labels', () => {
  assert.equal(periodOf(2), '凌晨')
  assert.equal(periodOf(7), '早上')
  assert.equal(periodOf(10), '上午')
  assert.equal(periodOf(13), '中午')
  assert.equal(periodOf(16), '下午')
  assert.equal(periodOf(20), '晚上')
  assert.equal(periodOf(23), '深夜')
  // 边界：区间左闭右开，9 点属于上午而不是早上。
  assert.equal(periodOf(9), '上午')
  assert.equal(periodOf(0), '凌晨')
})

test('periodOf tolerates junk', () => {
  for (const v of [-1, 24, NaN, 'x', null]) {
    assert.equal(periodOf(v), '此刻')
  }
})

test('renderPhrase fills nickname, period, date and random', () => {
  const ctx = buildContext({
    nickname: '小王',
    now: new Date(2026, 2, 14, 20, 5),
    random: () => 0.5
  })
  const out = renderPhrase('{昵称}{时段}好，{日期}第{随机数}条', ctx)
  assert.equal(out, '小王晚上好，3月14日第51条')
})

test('missing nickname leaves no dangling comma', () => {
  const ctx = buildContext({ nickname: '', now: new Date(2026, 2, 14, 20, 5) })
  // 昵称空掉后前面的标点要跟着收拾干净。
  const out = renderPhrase('{昵称}，晚上好', ctx)
  assert.equal(out, '晚上好')
})

test('two random placeholders in one phrase differ', () => {
  let n = 0
  const ctx = buildContext({ random: () => (n += 0.3) % 1 })
  const out = renderPhrase('{随机数}-{随机数}', ctx)
  const parts = out.split('-')
  assert.equal(parts.length, 2)
  // 同一句里两个随机位不该永远是同一个值（这里靠递增的伪随机验证）。
  assert.notEqual(parts[0], parts[1])
})

test('unknown placeholders are left intact', () => {
  const ctx = buildContext({})
  // 不认识的占位符不能悄悄吞掉，留着才能让用户看见自己打错了。
  assert.equal(renderPhrase('你好{未知}', ctx), '你好{未知}')
})

test('renderPhrase handles empty input', () => {
  assert.equal(renderPhrase('', buildContext()), '')
  assert.equal(renderPhrase(null, buildContext()), '')
  assert.equal(renderPhrase('   ', buildContext()), '')
})

test('renderPhrase works without an explicit context', () => {
  // 不传上下文时也要能跑，不能抛。
  const out = renderPhrase('{时段}')
  assert.ok(out.length > 0)
  assert.ok(!out.includes('{'))
})

test('rotator walks a group in order then wraps', () => {
  const r = createRotator()
  const items = ['a', 'b', 'c']
  assert.equal(r.next('g', items), 'a')
  assert.equal(r.next('g', items), 'b')
  assert.equal(r.next('g', items), 'c')
  // 走完一轮再从头，不随机。
  assert.equal(r.next('g', items), 'a')
})

test('rotator keeps独立 cursors per group', () => {
  const r = createRotator()
  assert.equal(r.next('甲', ['1', '2']), '1')
  assert.equal(r.next('乙', ['x', 'y']), 'x')
  // 甲走了两步，乙不该被带着一起走。
  assert.equal(r.next('甲', ['1', '2']), '2')
  assert.equal(r.next('乙', ['x', 'y']), 'y')
})

test('rotator skips empty items and handles empty groups', () => {
  const r = createRotator()
  assert.equal(r.next('g', []), '')
  assert.equal(r.next('g', null), '')
  assert.equal(r.next('g', ['', '  ', 'ok']), 'ok')
})

test('rotator reset zeroes a single group or everything', () => {
  const r = createRotator()
  r.next('g', ['a', 'b'])
  r.next('g', ['a', 'b'])
  assert.equal(r.cursorOf('g'), 0)
  r.reset('g')
  assert.equal(r.next('g', ['a', 'b']), 'a')

  r.next('h', ['x', 'y', 'z'])
  r.next('h', ['x', 'y', 'z'])
  r.reset()
  assert.equal(r.cursorOf('h'), 0)
})

test('rotator cursor stays in range when the group shrinks', () => {
  const r = createRotator()
  r.next('g', ['a', 'b', 'c'])
  r.next('g', ['a', 'b', 'c'])
  r.next('g', ['a', 'b', 'c'])
  // 游标回到 0 之后把列表缩短，取用不应该越界。
  const value = r.next('g', ['only'])
  assert.equal(value, 'only')
})

test('nextGroupName rotates groups in order', () => {
  const groups = [
    { name: '开场', items: ['1'] },
    { name: '互动', items: ['2'] },
    { name: '收尾', items: ['3'] }
  ]
  assert.equal(nextGroupName(groups, { groupCursor: 0 }), '开场')
  assert.equal(nextGroupName(groups, { groupCursor: 1 }), '互动')
  assert.equal(nextGroupName(groups, { groupCursor: 2 }), '收尾')
  assert.equal(nextGroupName(groups, { groupCursor: 3 }), '开场')
})

test('nextGroupName skips empty groups', () => {
  const groups = [
    { name: '空', items: [] },
    { name: '有', items: ['x'] }
  ]
  assert.equal(nextGroupName(groups, { groupCursor: 0 }), '有')
  assert.equal(nextGroupName([], {}), '')
  assert.equal(nextGroupName(null, {}), '')
})
