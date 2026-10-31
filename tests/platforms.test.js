import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeUrl,
  isLiveRoom,
  isLoginUrl,
  isLoginSuccess,
  isPlatformUrl,
  statusFor
} from '../src/platforms.js'

test('normalizeUrl adds https and canonicalizes', () => {
  assert.equal(normalizeUrl('www.douyin.com'), 'https://www.douyin.com/')
  assert.equal(normalizeUrl('  https://live.douyin.com/123  '), 'https://live.douyin.com/123')
  assert.equal(normalizeUrl('http://example.com/a'), 'http://example.com/a')
})

test('normalizeUrl rejects dangerous or incomplete values', () => {
  assert.equal(normalizeUrl(''), '')
  assert.equal(normalizeUrl('javascript:alert(1)'), '')
  assert.equal(normalizeUrl('file:///C:/Windows/win.ini'), '')
  assert.equal(normalizeUrl('https://'), '')
  assert.equal(normalizeUrl('not a url'), '')
})

test('live room detection is restricted to Douyin live URLs', () => {
  assert.equal(isLiveRoom('https://live.douyin.com/123456'), true)
  assert.equal(isLiveRoom('https://live.douyin.com/123456?foo=1'), true)
  assert.equal(isLiveRoom('https://www.douyin.com/'), false)
  assert.equal(isLiveRoom('https://live.douyin.com/room/123'), false)
})

test('login and platform URL detection', () => {
  assert.equal(isLoginUrl('https://www.douyin.com/passport/web/login/'), true)
  assert.equal(isLoginUrl('https://channels.weixin.qq.com/login.html'), true)
  assert.equal(isLoginSuccess('https://www.douyin.com/user/self', 'douyin'), true)
  assert.equal(isLoginSuccess('https://channels.weixin.qq.com/platform', 'channels'), true)
  assert.equal(isPlatformUrl('https://www.douyin.com/user/self', 'douyin'), true)
  assert.equal(isPlatformUrl('https://evil-douyin.com/', 'douyin'), false)
})

test('statusFor does not call a live room logged in', () => {
  assert.equal(statusFor({ platform: 'douyin' }, 'https://live.douyin.com/123'), 'watching')
  assert.equal(statusFor({ platform: 'douyin' }, 'https://www.douyin.com/passport/web/login/'), 'qr')
  assert.equal(statusFor({ platform: 'douyin' }, 'https://www.douyin.com/user/self'), 'online')
  assert.equal(statusFor({ platform: 'douyin' }, 'https://example.com/'), 'ready')
})

test('statusFor only reports online on a confirmed login page', () => {
  // 早期实现用 loginPending 兜底，批量登录后停在首页也会显示「已登录」。
  // 现在只有真正落在 /user/self 才算在线，loginPending 不再参与判定。
  assert.equal(
    statusFor({ platform: 'douyin', loginPending: true }, 'https://www.douyin.com/'),
    'ready'
  )
  assert.equal(
    statusFor({ platform: 'douyin', loginPending: true }, 'https://www.douyin.com/user/self'),
    'online'
  )
  assert.equal(
    statusFor({ platform: 'douyin', loginPending: true }, 'https://channels.weixin.qq.com/platform'),
    'ready'
  )
})
