// 出口实测。
//
// 配了代理不等于流量真的走了代理：地址填错、密码过期、规则没落到分区上，
// 界面上那个「独立出口 N」照样显示得整整齐齐——它数的是配置条数。
// 这一层把配置换回事实：从每个账号自己的分区发一个请求出去，
// 看对方看到的公网 IP 到底是什么。
//
// 判据只有一条：**同一台机器上，两个账号的公网 IP 相同，就是同一个来源。**
// 平台看到的也正是这一条。是不是本机直连、代理是不是已经死了，都是它的推论。

// 对方看到的 IP 就是这几个地址。国内网络下要能容错，
// 所以按顺序试，第一个成功的就采用。
export const PROBE_ENDPOINTS = [
  'https://myip.ipip.net/json',
  'https://api.ipify.org/?format=json',
  'https://ipinfo.io/json'
]

// 一次探测最多等多久。出口坏掉的情况要等满，但不能让整批探测一直挂着。
export const PROBE_TIMEOUT = 6000

// IP 归一化。比较「是不是同一个来源」时，两边的字符串形态必须一致，
// 否则 1.2.3.4 和 " 1.2.3.4 " 会被当成两个出口。
export function normalizeIp(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase()
  if (!s) return ''
  // IPv4-mapped IPv6（::ffff:1.2.3.4）还原成 IPv4，否则同一个出口会有两种写法。
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s)
  if (mapped) return mapped[1]
  return s
}

const IPV4_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/
const IPV6_RE = /\b((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})\b/i

// 是不是 IPv4。双栈网络下同一台机器能同时给出 v4 和 v6 两种形态，
// 比较「是不是同一个来源」时必须统一协议，否则同一个出口会被算成两个。
export function isIpv4(value) {
  const s = normalizeIp(value)
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)
}

// 从各家返回里抠出 IP。有的给 JSON、有的给纯文本、有的夹在一句话里
// （「当前 IP：1.2.3.4 来自于：…」），所以不能只按 JSON 解。
export function ipFromPayload(text) {
  const raw = String(text == null ? '' : text).trim()
  if (!raw) return ''
  // JSON 优先：字段名各家不同，都认一遍。
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      for (const key of ['ip', 'query', 'ip_addr', 'address', 'client_ip']) {
        const v = parsed[key]
        if (typeof v === 'string' && v.trim()) return normalizeIp(v)
      }
      // ipip.net 的 json 形态：{ ret: 'ok', data: { ip: '1.2.3.4' } }
      const nested = parsed.data
      if (nested && typeof nested === 'object' && typeof nested.ip === 'string') {
        return normalizeIp(nested.ip)
      }
    }
  } catch {
    // 不是 JSON，走下面的正则。
  }
  // 先找 IPv4：它不会和句子里的版本号、端口号撞得那么频繁。
  const v4 = IPV4_RE.exec(raw)
  if (v4) return normalizeIp(v4[1])
  const v6 = IPV6_RE.exec(raw)
  if (v6) return normalizeIp(v6[1])
  return ''
}

// 一个账号的实测结论。ok / direct / proxy-dead / failed / unprobed。
//   proxy-dead 是最要紧的一种：配了代理，出口却和本机一样，
//               说明请求根本没走代理，界面上却显示「已隔离」。
export function verdictFor(account, probe, ownIp = '') {
  const hasProxy = Boolean(String(account?.proxy || '').trim())
  if (!probe || probe.ok !== true || !probe.ip) {
    const failed = Boolean(probe && probe.error)
    return { state: failed ? 'failed' : 'unprobed', ip: '', hasProxy }
  }
  const ip = normalizeIp(probe.ip)
  const own = normalizeIp(ownIp)
  if (hasProxy && own && ip === own) return { state: 'proxy-dead', ip, hasProxy }
  return { state: hasProxy ? 'ok' : 'direct', ip, hasProxy }
}

// 汇总一批实测结果。
//
// measuredIsolated 才是「真的分开了几个」——它数的是公网 IP 只出现一次的账号，
// 和配置条数不是一回事：五条代理指向同一个出口，配置上是 5，实测是 1。
export function summarizeMeasured(accounts, probes, ownIp = '') {
  const list = (Array.isArray(accounts) ? accounts : []).filter(Boolean)
  const map = probes && typeof probes === 'object' ? probes : {}
  const byIp = new Map()
  const rows = []
  let failed = 0
  let unprobed = 0
  let direct = 0
  const proxyDead = []

  for (const a of list) {
    const verdict = verdictFor(a, map[a.id], ownIp)
    const name = a.nickname || a.id || ''
    rows.push({ id: a.id, name, ...verdict })
    if (verdict.state === 'failed') {
      failed++
      continue
    }
    if (verdict.state === 'unprobed') {
      unprobed++
      continue
    }
    if (verdict.state === 'direct') direct++
    if (verdict.state === 'proxy-dead') proxyDead.push({ id: a.id, name, ip: verdict.ip })
    const count = (byIp.get(verdict.ip) || 0) + 1
    byIp.set(verdict.ip, count)
  }

  // 同一个 IP 被多个账号用到，就是共用来源。名单要带上，
  // 否则只能看到「有几个共用」，不知道该去改哪几个账号。
  const sharedIps = []
  let measuredIsolated = 0
  for (const [ip, count] of byIp) {
    if (count === 1) {
      measuredIsolated++
      continue
    }
    sharedIps.push({
      ip,
      count,
      names: rows.filter((r) => r.ip === ip && r.state !== 'failed').map((r) => r.name)
    })
  }
  sharedIps.sort((a, b) => b.count - a.count)

  return {
    total: list.length,
    probed: list.length - failed - unprobed,
    failed,
    unprobed,
    direct,
    distinct: byIp.size,
    measuredIsolated,
    sharedIps,
    proxyDead,
    rows
  }
}

// 一句话说明这次实测的结论，给界面上的提示用。
export function measuredVerdict(summary) {
  const s = summary || {}
  if (!s.probed) return '还没实测出口'
  const parts = [`实测 ${s.probed} 个账号，分布在 ${s.distinct} 个出口 IP 上`]
  if (s.proxyDead && s.proxyDead.length) {
    parts.push(`${s.proxyDead.length} 个配了代理但出口仍是本机 IP`)
  }
  if (s.sharedIps && s.sharedIps.length) {
    parts.push(`${s.sharedIps.length} 个 IP 被多个账号共用`)
  }
  if (s.direct) parts.push(`${s.direct} 个走本机直连`)
  if (s.failed) parts.push(`${s.failed} 个探测失败`)
  return parts.join('；')
}
