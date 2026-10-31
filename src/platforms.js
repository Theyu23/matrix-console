// 平台配置与 URL 判定。集中放在这里，避免 App.vue / BrowserPane.vue 各写一套。
export const PLATFORMS = [
  {
    key: 'douyin',
    label: '抖音',
    loginUrl: 'https://www.douyin.com/user/self',
    hosts: ['douyin.com']
  },
  {
    key: 'channels',
    label: '微信视频号',
    loginUrl: 'https://channels.weixin.qq.com/platform',
    hosts: ['weixin.qq.com']
  }
]

export const STORAGE_KEY = 'matrix.accounts'

const LOGIN_RE = /login|passport|verify|signin|sso/i

export function isLoginUrl(url) {
  return LOGIN_RE.test(String(url || ''))
}

export function isLiveRoom(url) {
  return /^https:\/\/live\.douyin\.com\/\d+/.test(String(url || ''))
}

// 视频详情页：www.douyin.com/video/<id>，以及分享短链跳转后的同形态地址。
// 视频页有独立评论区，和直播间的聊天区不是一套节点。
export function isVideoPage(url) {
  return /^https:\/\/www\.douyin\.com\/(video|note)\/\d+/.test(String(url || ''))
}

// 需要挂评论观察器的页面类型：'live' / 'video' / ''（不挂）。
// 两者用不同的选择器配置，所以类型必须分开，不能统一成「要不要挂」。
export function commentKind(url) {
  const value = String(url || '')
  if (isLiveRoom(value)) return 'live'
  if (isVideoPage(value)) return 'video'
  return ''
}

function hostMatches(hostname, platformKey) {
  const platform = PLATFORMS.find((p) => p.key === platformKey)
  if (!platform) return false
  return platform.hosts.some((h) => hostname === h || hostname.endsWith('.' + h))
}

export function isPlatformUrl(url, platformKey) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && hostMatches(u.hostname, platformKey)
  } catch {
    return false
  }
}

// 只在“登录成功后的目标页”上给已登录信号；直播间、普通视频页不再冒充已登录。
export function isLoginSuccess(url, platformKey) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (platformKey === 'douyin') {
      return u.hostname === 'www.douyin.com' && /^\/user\/self\/?$/.test(u.pathname)
    }
    if (platformKey === 'channels') {
      return u.hostname === 'channels.weixin.qq.com' && /^\/platform\/?$/.test(u.pathname)
    }
    return false
  } catch {
    return false
  }
}

// 账号状态同时包含“页面状态”和“登录状态”的粗略信息：
// loading=页面加载中, qr=登录/扫码页, online=确认落在登录成功页,
// watching=直播间, ready=页面已就绪但无法确认登录, offline=加载失败。
// 只有真正落在登录成功页才算 online：早期版本用 loginPending 兜底，会把任何
// 平台 URL 都判成已登录，批量登录后没扫码也显示在线。
export function statusFor(account, url) {
  if (!account) return 'ready'
  if (isLoginUrl(url)) return 'qr'
  if (isLiveRoom(url)) return 'watching'
  if (isLoginSuccess(url, account.platform)) return 'online'
  return 'ready'
}

export function normalizeUrl(raw) {
  let value = String(raw || '').trim()
  if (!value) return ''
  if (!/^https?:\/\//i.test(value)) {
    if (!/^[\w-]+(\.[\w-]+)+/.test(value)) return ''
    value = 'https://' + value
  }
  try {
    const u = new URL(value)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString()
  } catch {
    return ''
  }
}
