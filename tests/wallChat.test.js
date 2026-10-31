import test from 'node:test'
import assert from 'node:assert/strict'
import { STICK_SLACK, isNearBottom, wallChatsFor } from '../src/wallChat.js'

test('wallChatsFor takes the tail, not the head', () => {
  const chats = { a: [{ text: '1' }, { text: '2' }, { text: '3' }] }
  // 监看墙要的是此刻最新，所以取尾部。
  assert.deepEqual(
    wallChatsFor(chats, 'a', 2).map((m) => m.text),
    ['2', '3']
  )
})

test('wallChatsFor returns everything when the limit exceeds the length', () => {
  const chats = { a: [{ text: 'only' }] }
  assert.equal(wallChatsFor(chats, 'a', 20).length, 1)
})

test('wallChatsFor handles missing account and junk input', () => {
  assert.deepEqual(wallChatsFor({}, 'nope'), [])
  assert.deepEqual(wallChatsFor(null, 'a'), [])
  assert.deepEqual(wallChatsFor({ a: null }, 'a'), [])
  assert.deepEqual(wallChatsFor({ a: 'not-an-array' }, 'a'), [])
  assert.deepEqual(wallChatsFor({ a: [] }, 'a'), [])
})

test('wallChatsFor tolerates a zero or negative limit', () => {
  const chats = { a: [{ text: '1' }] }
  // 负数 slice 会从尾部反着切，得到意料之外的条数，必须挡掉。
  assert.deepEqual(wallChatsFor(chats, 'a', 0), [])
  assert.deepEqual(wallChatsFor(chats, 'a', -3), [])
})

test('wallChatsFor keeps accounts independent', () => {
  const chats = { a: [{ text: 'a1' }], b: [{ text: 'b1' }, { text: 'b2' }] }
  assert.equal(wallChatsFor(chats, 'a').length, 1)
  assert.equal(wallChatsFor(chats, 'b').length, 2)
})

test('isNearBottom treats the very bottom as sticky', () => {
  assert.equal(isNearBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }), true)
})

test('isNearBottom honours the slack window', () => {
  // 距底 5px，在 12px 容差内。
  assert.equal(isNearBottom({ scrollTop: 895, scrollHeight: 1000, clientHeight: 100 }), true)
  // 距底 13px，超出容差，算在翻历史。
  assert.equal(isNearBottom({ scrollTop: 887, scrollHeight: 1000, clientHeight: 100 }), false)
  assert.equal(STICK_SLACK, 12)
})

test('isNearBottom treats short content as sticky', () => {
  // 内容没撑满视口时没有滚动条，贴底判断应该恒真，
  // 否则一有内容就会判定成「在翻历史」，新评论不再自动跟上。
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 40, clientHeight: 100 }), true)
})

test('isNearBottom defaults to sticky on junk metrics', () => {
  // 元素刚挂载时读到的是 undefined/NaN，这时候宁可贴底也不要卡住。
  assert.equal(isNearBottom({}), true)
  assert.equal(isNearBottom({ scrollTop: NaN, scrollHeight: 1000, clientHeight: 100 }), true)
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 'x', clientHeight: 100 }), true)
})
