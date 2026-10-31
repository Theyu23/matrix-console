import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenQueue } from '../src/openQueue.js'
import { decideCrashRetry } from '../src/crashGuard.js'

test('open queue respects the concurrency limit', () => {
  const dispatched = []
  const queue = createOpenQueue({ limit: 3, onDispatch: (id) => dispatched.push(id) })
  queue.enqueue(['a', 'b', 'c', 'd', 'e'])
  // 只放行前 3 个，其余排队等名额。
  assert.deepEqual(dispatched, ['a', 'b', 'c'])
  assert.equal(queue.running, 3)
  assert.equal(queue.pending, 2)

  queue.done('a')
  assert.deepEqual(dispatched, ['a', 'b', 'c', 'd'])
  assert.equal(queue.running, 3)
})

test('open queue ignores duplicate ids and late done calls', () => {
  const dispatched = []
  const queue = createOpenQueue({ limit: 2, onDispatch: (id) => dispatched.push(id) })
  queue.enqueue(['a', 'b'])
  // 连点两次「打开」不应把同一个账号又排一遍。
  queue.enqueue(['a', 'c'])
  assert.deepEqual(dispatched, ['a', 'b'])
  assert.equal(queue.pending, 1)

  // 迟到的 done（页面已释放过名额）不应再放行一条。
  assert.equal(queue.done('a'), true)
  assert.equal(queue.done('a'), false)
  assert.deepEqual(dispatched, ['a', 'b', 'c'])
  assert.equal(queue.running, 2)
})

test('open queue frees the slot even when dispatch throws', () => {
  const dispatched = []
  const queue = createOpenQueue({
    limit: 1,
    onDispatch: (id) => {
      if (id === 'boom') throw new Error('dispatch failed')
      dispatched.push(id)
    }
  })
  queue.enqueue(['boom', 'ok'])
  // 抛错的 id 不能把队列堵死，后面那条要能被放出来。
  assert.deepEqual(dispatched, ['ok'])
  assert.equal(queue.running, 1)
})

test('crash guard retries once inside the window then gives up', () => {
  const now = 1_000_000
  const first = decideCrashRetry([], now)
  assert.equal(first.retry, true)
  assert.equal(first.count, 1)

  // 同一窗口内第二次崩溃：不再自动重挂，避免和同一个崩溃死循环。
  const second = decideCrashRetry(first.recent, now + 5000)
  assert.equal(second.retry, false)
  assert.equal(second.count, 2)
})

test('crash guard forgets crashes older than the window', () => {
  const now = 1_000_000
  const first = decideCrashRetry([], now)
  // 4 分钟前的那次不算进窗口，这次应该重新给一次机会。
  const later = decideCrashRetry(first.recent, now + 4 * 60 * 1000)
  assert.equal(later.retry, true)
  assert.equal(later.count, 1)
})

test('crash guard tolerates junk history', () => {
  const decided = decideCrashRetry([null, undefined, NaN, 'x', -Infinity], 1000)
  assert.equal(decided.retry, true)
  assert.equal(decided.count, 1)
})
