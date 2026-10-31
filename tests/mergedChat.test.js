import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MERGED_LIMIT,
  lastSpeakerOf,
  mergeChats,
  pickScope,
  streamTargets,
  summarizeSources
} from '../src/mergedChat.js'

const A = { id: 'a', nickname: '账号A' }
const B = { id: 'b', nickname: '账号B' }
const C = { id: 'c', nickname: '账号C' }

function chats(...pairs) {
  const out = {}
  for (const [id, list] of pairs) out[id] = list
  return out
}

test('单页模式只取当前账号', () => {
  const got = streamTargets({ accounts: [A, B], activeId: 'a', gridMode: false })
  assert.deepEqual(got.map((x) => x.id), ['a'])
})

test('单页模式没有选中账号时返回空', () => {
  const got = streamTargets({ accounts: [A], activeId: null, gridMode: false })
  assert.deepEqual(got, [])
})

test('监看墙看全部，与列表勾选无关', () => {
  // 勾选是批量打开/移除的入口，不能兼任评论流筛选：
  // 为了给某个号开直播勾上它，评论流不该因此只剩那一路。
  const got = streamTargets({ accounts: [A, B, C], activeId: 'a', gridMode: true })
  assert.deepEqual(got.map((x) => x.id), ['a', 'b', 'c'])
})

test('监看墙不按 MAX_CELLS 截断，上不了墙的也在流里', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ id: 'x' + i, nickname: '号' + i }))
  const got = streamTargets({ accounts: many, activeId: 'x0', gridMode: true })
  assert.equal(got.length, 15)
})

test('监看墙对空列表安全', () => {
  assert.deepEqual(streamTargets({ accounts: [], activeId: 'a', gridMode: true }), [])
  assert.deepEqual(streamTargets({ accounts: null, activeId: 'a', gridMode: true }), [])
})

test('mergeChats 按时间升序合并多路', () => {
  const c = chats(
    ['a', [
      { nickname: '甲', text: 'a1', ts: 100 },
      { nickname: '乙', text: 'a2', ts: 300 }
    ]],
    ['b', [
      { nickname: '丙', text: 'b1', ts: 200 },
      { nickname: '丁', text: 'b2', ts: 400 }
    ]]
  )
  const got = mergeChats(c, [A, B])
  assert.deepEqual(got.map((m) => m.text), ['a1', 'b1', 'a2', 'b2'])
  assert.deepEqual(got.map((m) => m.srcName), ['账号A', '账号B', '账号A', '账号B'])
})

test('mergeChats 时间相同也按来源顺序稳定', () => {
  const c = chats(
    ['a', [{ text: '同1', ts: 100 }]],
    ['b', [{ text: '同2', ts: 100 }]]
  )
  assert.deepEqual(mergeChats(c, [A, B]).map((m) => m.text), ['同1', '同2'])
  // 换来源顺序，输出顺序随之改变，但同一组输入结果恒定
  assert.deepEqual(mergeChats(c, [B, A]).map((m) => m.text), ['同2', '同1'])
})

test('mergeChats 跨来源同名同文不去重', () => {
  // 两个视频下不同观众同时打「666」是真实情况，去重会吞掉真实消息。
  const c = chats(
    ['a', [{ nickname: '路人', text: '666', ts: 100 }]],
    ['b', [{ nickname: '路人', text: '666', ts: 101 }]]
  )
  const got = mergeChats(c, [A, B])
  assert.equal(got.length, 2)
})

test('mergeChats 只保留尾部 limit 条', () => {
  const list = Array.from({ length: 50 }, (_, i) => ({ text: 't' + i, ts: i }))
  const c = chats(['a', list])
  const got = mergeChats(c, [A], 10)
  assert.equal(got.length, 10)
  assert.equal(got[0].text, 't40')
  assert.equal(got[9].text, 't49')
})

test('mergeChats 对缺失/异常输入安全', () => {
  assert.deepEqual(mergeChats(null, [A]), [])
  assert.deepEqual(mergeChats({}, [A]), [])
  assert.deepEqual(mergeChats(chats(), []), [])
  assert.deepEqual(mergeChats({ a: 'not-array' }, [A]), [])
  // limit 为 0 或非法时返回空，而不是整条列表
  const c = chats(['a', [{ text: 'x', ts: 1 }]])
  assert.deepEqual(mergeChats(c, [A], 0), [])
  assert.deepEqual(mergeChats(c, [A], NaN), [])
})

test('mergeChats 归一 kind，缺字段不出 undefined', () => {
  const c = chats(['a', [{ text: 'x', ts: 1 }]])
  const [m] = mergeChats(c, [A])
  assert.equal(m.kind, 'live')
  assert.equal(m.nickname, '')
  assert.equal(m.srcId, 'a')
})

test('mergeChats 不把内部排序键漏出去', () => {
  const c = chats(['a', [{ text: 'x', ts: 1 }]])
  const [m] = mergeChats(c, [A])
  assert.equal('_ord' in m, false)
})

test('合并结果规模不超上限', () => {
  const big = Array.from({ length: 200 }, (_, i) => ({ text: 't' + i, ts: i }))
  const c = chats(['a', big], ['b', big], ['c', big])
  const got = mergeChats(c, [A, B, C])
  assert.equal(got.length, MERGED_LIMIT)
})

test('lastSpeakerOf 取最近一个有昵称的', () => {
  assert.equal(
    lastSpeakerOf([
      { nickname: '甲', text: '1' },
      { nickname: '', text: '2' },
      { nickname: '丙', text: '3' },
      { nickname: '', text: '4' }
    ]),
    '丙'
  )
  assert.equal(lastSpeakerOf([]), '')
  assert.equal(lastSpeakerOf(null), '')
  assert.equal(lastSpeakerOf([{ text: '无昵称' }]), '')
})

test('pickScope 无筛选时返回全部', () => {
  assert.deepEqual(pickScope([A, B], '').map((x) => x.id), ['a', 'b'])
  assert.deepEqual(pickScope([A, B], null).map((x) => x.id), ['a', 'b'])
})

test('pickScope 按 id 收窄到一路', () => {
  assert.deepEqual(pickScope([A, B, C], 'b').map((x) => x.id), ['b'])
})

test('pickScope 指向已不存在的账号时退回全部', () => {
  // 那一格被关掉后 focus 还留着，不能把面板清空。
  assert.deepEqual(pickScope([A, B], 'gone').map((x) => x.id), ['a', 'b'])
})

test('pickScope 对空输入安全', () => {
  assert.deepEqual(pickScope(null, 'a'), [])
  assert.deepEqual(pickScope([], 'a'), [])
})

test('summarizeSources 超过上限时收尾', () => {  assert.equal(summarizeSources([]), '')
  assert.equal(summarizeSources([A]), '账号A')
  assert.equal(summarizeSources([A, B]), '账号A、账号B')
  assert.equal(summarizeSources([A, B, C]), '账号A、账号B 等 3 个')
  assert.equal(summarizeSources([A, B, C], 3), '账号A、账号B、账号C')
})

test('source 昵称缺失时用 id 前几位兜底', () => {
  const noName = { id: 'abcdefgh' }
  const c = chats(['abcdefgh', [{ text: 'x', ts: 1 }]])
  const [m] = mergeChats(c, [noName])
  assert.equal(m.srcName, 'abcdef')
})
