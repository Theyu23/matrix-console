// 账号登录态巡检。
//
// 现状的问题：statusFor 只在页面跳转时算一次，登录态过期了不会自己更新，
// 得等用户点进那个账号才发现被踢回扫码页。多开时最贵的就是这种「发现得太晚」
// 的重新扫码。
//
// 判定依据不是 HTTP 状态码。实测未登录访问抖音 /user/self 仍然返回 200
// 和正常的页面外壳，URL 也停在 /user/self——状态码和最终地址都看不出会话是否有效。
// 真正的信号在页面上：未登录时顶部有明确的「登录」入口且没有头像，
// 登录后头像出现、登录入口消失。这里用的就是这一对信号。

import { isPlatformUrl } from './platforms.js'

export const HEALTH_MIN_INTERVAL = 5 * 60 * 1000
export const HEALTH_DEFAULT_INTERVAL = 30 * 60 * 1000

// 在账号当前页面里跑的一次只读探测：数「登录入口」和「头像」。
// 只读 DOM，不点任何东西、不改任何值。
export const HEALTH_PROBE_SCRIPT = String.raw`(() => {
  var nodes = document.querySelectorAll('button, [role="button"], a, div, span')
  var loginBtn = 0
  var loginText = ''
  for (var i = 0; i < nodes.length; i++) {
    var t = (nodes[i].innerText || '').trim()
    if (t === '登录' || t === '登录/注册' || t === '扫码登录' || t === '立即登录') {
      loginBtn++
      loginText = t
    }
  }
  var avatar = document.querySelectorAll(
    'img[class*="avatar" i], [class*="avatar" i] img, [data-e2e*="avatar" i]'
  ).length
  return {
    href: String(location.href || ''),
    loginBtn: loginBtn,
    loginText: loginText,
    avatar: avatar,
    ready: document.readyState === 'complete'
  }
})()`

// 只有「个人页」上的头像代表登录用户本人。
// 视频页、直播间、精选页上的头像是别人的（作者、主播、推荐用户），
// 在那里数头像会把任何页面都判成已登录 —— 实测视频页能数到 3 个作者头像。
// 所以登录态只在个人页上判定，其余页面一律「当前页面无法判断」。
export function isProfileUrl(url) {
  try {
    const u = new URL(String(url || ''))
    if (u.protocol !== 'https:') return false
    if (u.hostname === 'www.douyin.com') return /^\/user\/self\/?$/.test(u.pathname)
    if (u.hostname === 'channels.weixin.qq.com') return /^\/platform\/?$/.test(u.pathname)
    return false
  } catch {
    return false
  }
}

// 把探测结果归一成三种状态。
//   ok      = 个人页上有头像且没有登录入口
//   expired = 个人页上有登录入口且没有头像
//   unknown = 不在个人页、或两者矛盾、或页面没加载出来
export function parseHealthOutcome(raw) {
  if (!raw || typeof raw !== 'object') return { state: 'unknown', detail: '没有返回值' }
  if (raw.error) return { state: 'unknown', detail: String(raw.error).slice(0, 80) }

  const href = String(raw.href || '')
  // 没落在平台域名上（about:blank、加载失败页），探不出任何东西。
  // 用 platforms.js 里同一份 host 清单判断，避免两处各写一套正则后走样。
  if (!isPlatformUrl(href, 'douyin') && !isPlatformUrl(href, 'channels')) {
    return { state: 'unknown', detail: '页面未就绪' }
  }
  // 判断依据只在个人页成立，别的页面上的头像不代表当前账号。
  if (!isProfileUrl(href)) {
    return { state: 'unknown', detail: '当前不在个人页，无法判断登录态' }
  }

  const loginBtn = Number(raw.loginBtn) || 0
  const avatar = Number(raw.avatar) || 0

  if (avatar > 0 && loginBtn === 0) return { state: 'ok', detail: '已登录' }
  if (loginBtn > 0 && avatar === 0) {
    return { state: 'expired', detail: `页面上出现「${raw.loginText || '登录'}」入口` }
  }
  if (avatar > 0 && loginBtn > 0) {
    // 两者同时出现：可能是页面里别处渲染了登录引导，不足以判定。
    return { state: 'unknown', detail: '头像与登录入口同时存在' }
  }
  return { state: 'unknown', detail: '既无头像也无登录入口' }
}

// 决定这一轮要探哪些账号：只探已打开且当前挂载着的。
// 未挂载的账号页面在别的平台下，探不了，别把它们标成异常。
export function pickTargets(accounts, mountedIds) {
  const mounted = mountedIds instanceof Set ? mountedIds : new Set(mountedIds || [])
  return (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.opened && mounted.has(a.id))
}

// 是否到了该巡检的时间。
// 间隔被强制抬到 HEALTH_MIN_INTERVAL 以上，避免调用方传个小值把请求打密。
export function shouldCheck({ now, lastRun, intervalMs = HEALTH_DEFAULT_INTERVAL }) {
  const wait = Math.max(Number(intervalMs) || 0, HEALTH_MIN_INTERVAL)
  if (!Number.isFinite(lastRun)) return true
  return now - lastRun >= wait
}

// 汇总一批结果，给界面显示一行总览。
// null / 非对象一律丢掉：没跑到的账号不该被算成「待确认」。
export function summarizeHealth(results) {
  const list = (Array.isArray(results) ? results : []).filter(
    (r) => r && typeof r === 'object' && typeof r.state === 'string'
  )
  const count = { ok: 0, expired: 0, unknown: 0 }
  for (const r of list) {
    if (count[r.state] !== undefined) count[r.state]++
  }
  return { total: list.length, ...count }
}
