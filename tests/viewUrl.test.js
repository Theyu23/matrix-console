// safeViewUrl 的单元测试。
//
// 起因：did-start-loading 里直接调 e.target.getURL()，而 Electron 的
// WebViewElement 在「还没挂到 DOM / dom-ready 还没发出」时会同步抛
// "The WebView must be attached to the DOM and the dom-ready event
//  emitted before this method can be called."（不是返回空串，是抛异常）。
// 抛在事件回调里会打断整个回调：状态不更新、观察器不注入，看起来像页面卡住。
//
// 所以读 URL 一律走 safeViewUrl，读不到退回调用方已知的 currentUrl。
import test from 'node:test'
import assert from 'node:assert/strict'
import { safeViewUrl } from '../src/viewUrl.js'

test('正常读到 url 时原样返回', () => {
  const el = { getURL: () => 'https://www.douyin.com/user/self' }
  assert.equal(safeViewUrl(el, 'https://fallback'), 'https://www.douyin.com/user/self')
})

test('getURL 抛异常（webview 未 attach）时退回 fallback', () => {
  const el = {
    getURL: () => {
      throw new Error('The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.')
    }
  }
  assert.equal(safeViewUrl(el, 'https://fallback'), 'https://fallback')
})

test('getURL 返回空串时退回 fallback', () => {
  assert.equal(safeViewUrl({ getURL: () => '' }, 'https://fallback'), 'https://fallback')
})

test('没有 getURL 方法时退回 fallback', () => {
  assert.equal(safeViewUrl({}, 'https://fallback'), 'https://fallback')
  assert.equal(safeViewUrl(null, 'https://fallback'), 'https://fallback')
  assert.equal(safeViewUrl(undefined, 'https://fallback'), 'https://fallback')
})

test('没有 fallback 时统一返回空串，不返回 undefined', () => {
  // 事件处理里会把它拿去 statusFor / isProfileUrl，undefined 会让判断出岔。
  assert.equal(safeViewUrl({ getURL: () => '' }), '')
  assert.equal(safeViewUrl(null), '')
  assert.equal(
    safeViewUrl({ getURL: () => { throw new Error('x') } }),
    ''
  )
})
