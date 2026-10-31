import test from 'node:test'
import assert from 'node:assert/strict'
import { pageKindLabel, resolveTarget } from '../src/publishTarget.js'

const A = { id: 'a', nickname: '甲' }
const B = { id: 'b', nickname: '乙' }

test('单页模式发当前账号', () => {
  assert.equal(
    resolveTarget({ accounts: [A, B], activeId: 'b', wallTarget: 'a', gridMode: false }),
    'b'
  )
})

test('单页模式没有 activeId 时不猜', () => {
  // 猜一个账号发出去比什么都不发更糟。
  assert.equal(
    resolveTarget({ accounts: [A, B], activeId: null, wallTarget: 'a', gridMode: false }),
    ''
  )
})

test('监看墙发点选的那一格', () => {
  assert.equal(
    resolveTarget({ accounts: [A, B], activeId: 'a', wallTarget: 'b', gridMode: true }),
    'b'
  )
})

test('监看墙用 wallTarget 而不是 activeId', () => {
  // activeId 是「上次单页看的那个」，和「此刻想发给谁」是两件事。
  assert.equal(
    resolveTarget({ accounts: [A, B], activeId: 'a', wallTarget: 'b', gridMode: true }),
    'b'
  )
})

test('监看墙还没点过格子时退回第一个', () => {
  assert.equal(
    resolveTarget({ accounts: [A, B], activeId: 'b', wallTarget: '', gridMode: true }),
    'a'
  )
})

test('点过的那格被关掉后退回第一个可见账号', () => {
  // 不能沿用失效 id：确认框写着甲、实际发到别处。
  assert.equal(
    resolveTarget({ accounts: [A], activeId: 'a', wallTarget: 'gone', gridMode: true }),
    'a'
  )
})

test('墙上没有账号时返回空', () => {
  assert.equal(resolveTarget({ accounts: [], activeId: 'a', wallTarget: 'a', gridMode: true }), '')
  assert.equal(resolveTarget({ accounts: null, activeId: 'a', wallTarget: 'a', gridMode: true }), '')
})

test('accounts 里的空元素被跳过', () => {
  assert.equal(
    resolveTarget({ accounts: [null, A, undefined, B], activeId: 'x', wallTarget: '', gridMode: true }),
    'a'
  )
})

test('识别出抖音直播间和视频页', () => {
  assert.equal(pageKindLabel({ platform: 'douyin', currentUrl: 'https://live.douyin.com/123' }), '直播')
  assert.equal(pageKindLabel({ platform: 'douyin', currentUrl: 'https://www.douyin.com/video/456' }), '视频')
})

test('currentUrl 优先于配置的 url', () => {
  // 用户可能在页面里点了跳转，配置的 url 已经过时。
  assert.equal(
    pageKindLabel({ platform: 'douyin', url: 'https://live.douyin.com/1', currentUrl: 'https://www.douyin.com/video/9' }),
    '视频'
  )
})

test('平台页但类型未知时不说成非评论页', () => {
  // 视频号直播间同样有评论框，只是观察器没覆盖。
  // 标成「非评论页」会让人以为发不出去。
  assert.equal(
    pageKindLabel({ platform: 'channels', currentUrl: 'https://channels.weixin.qq.com/platform' }),
    '平台页'
  )
})

test('非平台页才算非评论页', () => {
  assert.equal(pageKindLabel({ platform: 'douyin', currentUrl: 'https://example.com/x' }), '非评论页')
  assert.equal(pageKindLabel({ platform: 'douyin', currentUrl: '' }), '非评论页')
})

test('没有账号时返回空字符串', () => {
  assert.equal(pageKindLabel(null), '')
  assert.equal(pageKindLabel(undefined), '')
})
