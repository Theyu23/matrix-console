import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HEALTH_MIN_INTERVAL,
  HEALTH_PROBE_SCRIPT,
  isProfileUrl,
  parseHealthOutcome,
  pickTargets,
  shouldCheck,
  summarizeHealth
} from '../src/health.js'

// 探测脚本要真的能在页面里跑，语法错误必须在这里暴露。
function runProbe(dom) {
  const fn = new Function('location', 'document', 'return (' + HEALTH_PROBE_SCRIPT + ')')
  return fn({ href: dom.href }, {
    readyState: 'complete',
    querySelectorAll: (selector) => {
      if (/avatar/i.test(selector)) return new Array(dom.avatar || 0).fill({})
      return (dom.texts || []).map((t) => ({ innerText: t }))
    }
  })
}

const PROFILE = 'https://www.douyin.com/user/self'

test('probe script detects a logged out profile page', () => {
  const raw = runProbe({ href: PROFILE, texts: ['首页', '登录', '扫码登录', '推荐'], avatar: 0 })
  assert.equal(raw.loginBtn, 2)
  assert.equal(raw.avatar, 0)
  assert.equal(parseHealthOutcome(raw).state, 'expired')
})

test('probe script detects a logged in profile page', () => {
  const raw = runProbe({ href: PROFILE, texts: ['首页', '推荐', '我的'], avatar: 3 })
  assert.equal(raw.loginBtn, 0)
  assert.equal(parseHealthOutcome(raw).state, 'ok')
})

test('isProfileUrl only accepts the two account pages', () => {
  assert.equal(isProfileUrl(PROFILE), true)
  assert.equal(isProfileUrl('https://www.douyin.com/user/self/'), true)
  assert.equal(isProfileUrl('https://channels.weixin.qq.com/platform'), true)
  // 别人的页面不是「个人页」，头像代表的是别人。
  assert.equal(isProfileUrl('https://www.douyin.com/video/7530000000000000000'), false)
  assert.equal(isProfileUrl('https://live.douyin.com/'), false)
  assert.equal(isProfileUrl('https://www.douyin.com/jingxuan'), false)
  assert.equal(isProfileUrl(''), false)
  assert.equal(isProfileUrl('not a url'), false)
})

test('a video page is never called logged in just because it shows avatars', () => {
  // 实测视频页能数到 3 个作者头像。按头像判定就会误判成已登录。
  const outcome = parseHealthOutcome({
    href: 'https://www.douyin.com/video/7530000000000000000',
    loginBtn: 0,
    avatar: 3
  })
  assert.equal(outcome.state, 'unknown')
  assert.match(outcome.detail, /不在个人页/)
})

test('avatar plus a login entry is inconclusive', () => {
  const outcome = parseHealthOutcome({ href: PROFILE, loginBtn: 1, avatar: 2 })
  assert.equal(outcome.state, 'unknown')
})

test('neither avatar nor login entry is unknown, not healthy', () => {
  const outcome = parseHealthOutcome({ href: PROFILE, loginBtn: 0, avatar: 0 })
  assert.equal(outcome.state, 'unknown')
  assert.match(outcome.detail, /既无头像/)
})

test('non-platform pages cannot be judged', () => {
  for (const href of ['about:blank', 'https://example.com/', '']) {
    const outcome = parseHealthOutcome({ href, loginBtn: 0, avatar: 5 })
    assert.equal(outcome.state, 'unknown', href)
    assert.match(outcome.detail, /未就绪/)
  }
})

test('probe errors and junk become unknown', () => {
  assert.equal(parseHealthOutcome({ error: '页面无法执行脚本' }).state, 'unknown')
  assert.equal(parseHealthOutcome(null).state, 'unknown')
  assert.equal(parseHealthOutcome(undefined).state, 'unknown')
})

test('channels profile page is judged by the same signals', () => {
  const outcome = parseHealthOutcome({
    href: 'https://channels.weixin.qq.com/platform',
    loginBtn: 1,
    avatar: 0,
    loginText: '登录'
  })
  assert.equal(outcome.state, 'expired')
})

test('expired detail names the login entry text', () => {
  const outcome = parseHealthOutcome({
    href: PROFILE,
    loginBtn: 1,
    avatar: 0,
    loginText: '扫码登录'
  })
  assert.match(outcome.detail, /扫码登录/)
})

test('pickTargets only takes opened and mounted accounts', () => {
  const accounts = [
    { id: 'a', opened: true },
    { id: 'b', opened: false },
    { id: 'c', opened: true }
  ]
  // b 没打开，c 没挂载（在另一个平台下），都不该被探。
  assert.deepEqual(pickTargets(accounts, ['a']).map((a) => a.id), ['a'])
})

test('shouldCheck honours the minimum interval', () => {
  const now = 10_000_000
  assert.equal(shouldCheck({ now, lastRun: NaN }), true)
  // 传一个很小的间隔也要被抬到下限以上，别把请求打密。
  assert.equal(shouldCheck({ now, lastRun: now - 1000, intervalMs: 1000 }), false)
  assert.equal(
    shouldCheck({ now, lastRun: now - HEALTH_MIN_INTERVAL, intervalMs: HEALTH_MIN_INTERVAL }),
    true
  )
  // 默认间隔比下限长，5 分钟前刚跑过就不该再跑。
  assert.equal(shouldCheck({ now, lastRun: now - HEALTH_MIN_INTERVAL }), false)
})

test('summarizeHealth counts each state', () => {
  const summary = summarizeHealth([
    { state: 'ok' },
    { state: 'ok' },
    { state: 'expired' },
    { state: 'unknown' },
    null
  ])
  assert.deepEqual(summary, { total: 4, ok: 2, expired: 1, unknown: 1 })
})

test('summarizeHealth handles an empty run', () => {
  assert.deepEqual(summarizeHealth([]), { total: 0, ok: 0, expired: 0, unknown: 0 })
  assert.deepEqual(summarizeHealth(null), { total: 0, ok: 0, expired: 0, unknown: 0 })
})
