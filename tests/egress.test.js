import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROBE_ENDPOINTS,
  PROBE_TIMEOUT,
  ipFromPayload,
  isIpv4,
  measuredVerdict,
  normalizeIp,
  summarizeMeasured,
  verdictFor
} from '../src/egress.js'

// ── IP 归一化 ────────────────────────────────────────────
// 比较「是不是同一个出口」时两边形态必须一致，
// 否则同一个 IP 会被算成两个，界面上显得隔离得很好、实际没有。

test('normalizeIp trims and lowercases', () => {
  assert.equal(normalizeIp('  1.2.3.4  '), '1.2.3.4')
  assert.equal(normalizeIp('2001:DB8::1'), '2001:db8::1')
})

test('normalizeIp unwraps IPv4-mapped IPv6', () => {
  // ::ffff:1.2.3.4 和 1.2.3.4 是同一个出口，不能算成两个。
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4')
  assert.equal(normalizeIp('::FFFF:8.8.8.8'), '8.8.8.8')
})

test('normalizeIp handles empty and junk', () => {
  assert.equal(normalizeIp(''), '')
  assert.equal(normalizeIp(null), '')
  assert.equal(normalizeIp(undefined), '')
})

// ── 从各家返回里抠 IP ────────────────────────────────────

test('isIpv4 distinguishes the two address families', () => {
  assert.equal(isIpv4('1.2.3.4'), true)
  assert.equal(isIpv4(' ::ffff:1.2.3.4 '), true)
  assert.equal(isIpv4('2408:821b:20f:ff6b::1'), false)
  assert.equal(isIpv4(''), false)
})

test('ipFromPayload reads common JSON shapes', () => {
  assert.equal(ipFromPayload('{"ip":"1.2.3.4"}'), '1.2.3.4')
  assert.equal(ipFromPayload('{"query":"5.6.7.8"}'), '5.6.7.8')
  // ipinfo.io 的字段就叫 ip
  assert.equal(ipFromPayload('{"ip":"9.9.9.9","city":"X"}'), '9.9.9.9')
})

test('ipFromPayload reads ipip.net nested shape', () => {
  assert.equal(ipFromPayload('{"ret":"ok","data":{"ip":"1.1.1.1"}}'), '1.1.1.1')
})

test('ipFromPayload falls back to plain text', () => {
  // ipip.net 的人读形态：「当前 IP：1.2.3.4 来自于：…」
  assert.equal(ipFromPayload('当前 IP：1.2.3.4 来自于：北京'), '1.2.3.4')
  assert.equal(ipFromPayload('1.2.3.4'), '1.2.3.4')
})

test('ipFromPayload handles IPv6-only response', () => {
  assert.equal(ipFromPayload('{"ip":"2001:db8::1"}'), '2001:db8::1')
})

test('ipFromPayload returns empty for responses without an IP', () => {
  // 拿到错误页时不能瞎猜一个 IP 出来，否则会伪造出「隔离成功」。
  assert.equal(ipFromPayload(''), '')
  assert.equal(ipFromPayload('<html>error</html>'), '')
  assert.equal(ipFromPayload('{"error":"rate limited"}'), '')
})

test('probe endpoints and timeout are usable', () => {
  assert.ok(Array.isArray(PROBE_ENDPOINTS) && PROBE_ENDPOINTS.length > 0)
  for (const url of PROBE_ENDPOINTS) assert.match(url, /^https:\/\//)
  assert.ok(PROBE_TIMEOUT > 0)
})

// ── 单账号判定 ───────────────────────────────────────────

test('verdictFor recognizes a working proxy', () => {
  const v = verdictFor({ proxy: 'socks5://1.1.1.1:1080' }, { ok: true, ip: '9.9.9.9' }, '1.2.3.4')
  assert.equal(v.state, 'ok')
  assert.equal(v.ip, '9.9.9.9')
  assert.equal(v.hasProxy, true)
})

test('verdictFor flags a proxy that is not taking effect', () => {
  // 最关键的一类：配了代理，出口却还是本机 IP。
  // 界面上「独立出口」显示正常，实际完全没有隔离。
  const v = verdictFor({ proxy: 'http://1.1.1.1:8080' }, { ok: true, ip: '1.2.3.4' }, '1.2.3.4')
  assert.equal(v.state, 'proxy-dead')
})

test('verdictFor marks accounts without proxy as direct', () => {
  const v = verdictFor({ proxy: '' }, { ok: true, ip: '1.2.3.4' }, '1.2.3.4')
  assert.equal(v.state, 'direct')
})

test('verdictFor does not call a proxy dead without a baseline', () => {
  // 没有本机基准时无法区分「代理出口恰好同 IP」和「代理没生效」。
  // 这种情况不报，好过误报。
  const v = verdictFor({ proxy: 'http://1.1.1.1:8080' }, { ok: true, ip: '1.2.3.4' }, '')
  assert.equal(v.state, 'ok')
})

test('verdictFor separates failed from unprobed', () => {
  const failed = verdictFor({ proxy: 'x' }, { ok: false, error: '超时' }, '')
  assert.equal(failed.state, 'failed')
  // 压根没测过的账号不能当成失败，也不能算进有效出口。
  const unprobed = verdictFor({ proxy: 'x' }, null, '')
  assert.equal(unprobed.state, 'unprobed')
})

// ── 批量汇总 ─────────────────────────────────────────────

test('summarizeMeasured counts distinct IPs, not configured proxies', () => {
  // 三条不同的代理，但都从同一个 IP 出去：配置是 3，实测是 1。
  const accounts = [
    { id: 'a', nickname: '甲', proxy: 'http://1.1.1.1:1' },
    { id: 'b', nickname: '乙', proxy: 'http://2.2.2.2:2' },
    { id: 'c', nickname: '丙', proxy: 'http://3.3.3.3:3' }
  ]
  const probes = {
    a: { ok: true, ip: '9.9.9.9' },
    b: { ok: true, ip: '9.9.9.9' },
    c: { ok: true, ip: '9.9.9.9' }
  }
  const s = summarizeMeasured(accounts, probes, '1.2.3.4')
  assert.equal(s.probed, 3)
  assert.equal(s.distinct, 1)
  assert.equal(s.measuredIsolated, 0)
  assert.equal(s.sharedIps.length, 1)
  assert.equal(s.sharedIps[0].count, 3)
  assert.deepEqual(s.sharedIps[0].names, ['甲', '乙', '丙'])
})

test('summarizeMeasured credits genuinely separate exits', () => {
  const accounts = [
    { id: 'a', nickname: '甲', proxy: 'http://1.1.1.1:1' },
    { id: 'b', nickname: '乙', proxy: 'http://2.2.2.2:2' }
  ]
  const probes = { a: { ok: true, ip: '9.9.9.9' }, b: { ok: true, ip: '8.8.8.8' } }
  const s = summarizeMeasured(accounts, probes, '1.2.3.4')
  assert.equal(s.distinct, 2)
  assert.equal(s.measuredIsolated, 2)
  assert.deepEqual(s.sharedIps, [])
})

test('summarizeMeasured sorts shared IPs by how many accounts share them', () => {
  const accounts = [
    { id: 'a', nickname: '甲', proxy: 'p1' },
    { id: 'b', nickname: '乙', proxy: 'p2' },
    { id: 'c', nickname: '丙', proxy: 'p3' },
    { id: 'd', nickname: '丁', proxy: 'p4' }
  ]
  const probes = {
    a: { ok: true, ip: '1.1.1.1' },
    b: { ok: true, ip: '1.1.1.1' },
    c: { ok: true, ip: '2.2.2.2' },
    d: { ok: true, ip: '2.2.2.2' }
  }
  const s = summarizeMeasured(accounts, probes, '9.9.9.9')
  // 两组各两人，顺序不重要，但都要出现
  assert.equal(s.sharedIps.length, 2)
  assert.equal(s.sharedIps[0].count, 2)
})

test('summarizeMeasured reports proxy-dead accounts', () => {
  const accounts = [
    { id: 'a', nickname: '甲', proxy: 'http://1.1.1.1:1' },
    { id: 'b', nickname: '乙', proxy: '' }
  ]
  const probes = { a: { ok: true, ip: '1.2.3.4' }, b: { ok: true, ip: '1.2.3.4' } }
  const s = summarizeMeasured(accounts, probes, '1.2.3.4')
  assert.equal(s.proxyDead.length, 1)
  assert.equal(s.proxyDead[0].name, '甲')
  // 甲和乙都在 1.2.3.4 上，所以这个 IP 是共用的——即使乙本来就走直连。
  assert.equal(s.sharedIps[0].ip, '1.2.3.4')
})

test('summarizeMeasured keeps failed and unprobed out of the IP tally', () => {
  // 探测失败的账号不能算进任何 IP，否则会凭空造出一个「共用出口」。
  const accounts = [
    { id: 'a', nickname: '甲', proxy: 'p1' },
    { id: 'b', nickname: '乙', proxy: 'p2' },
    { id: 'c', nickname: '丙', proxy: 'p3' }
  ]
  const probes = {
    a: { ok: true, ip: '9.9.9.9' },
    b: { ok: false, error: '超时' }
  }
  const s = summarizeMeasured(accounts, probes, '')
  assert.equal(s.probed, 1)
  assert.equal(s.failed, 1)
  assert.equal(s.unprobed, 1)
  assert.equal(s.distinct, 1)
  assert.deepEqual(s.sharedIps, [])
})

test('summarizeMeasured tolerates empty input', () => {
  const s = summarizeMeasured([], {}, '')
  assert.equal(s.total, 0)
  assert.equal(s.probed, 0)
  assert.deepEqual(s.sharedIps, [])
  assert.deepEqual(s.rows, [])
  // null 元素要跳过，不能整个炸掉
  assert.equal(summarizeMeasured([null, undefined], {}).total, 0)
  assert.equal(summarizeMeasured(null, null).total, 0)
})

// ── 结论文案 ─────────────────────────────────────────────

test('measuredVerdict says so when nothing was probed', () => {
  assert.equal(measuredVerdict({ probed: 0 }), '还没实测出口')
  assert.equal(measuredVerdict(null), '还没实测出口')
})

test('measuredVerdict names the problems it found', () => {
  const text = measuredVerdict({
    probed: 3,
    distinct: 1,
    proxyDead: [{ name: '甲' }],
    sharedIps: [{ ip: '9.9.9.9', count: 3 }],
    direct: 0,
    failed: 0
  })
  assert.match(text, /实测 3 个账号/)
  assert.match(text, /代理但出口仍是本机 IP/)
  assert.match(text, /共用/)
})

test('measuredVerdict stays clean when everything is fine', () => {
  const text = measuredVerdict({
    probed: 2, distinct: 2, proxyDead: [], sharedIps: [], direct: 0, failed: 0
  })
  assert.match(text, /2 个出口 IP/)
  assert.ok(!/共用/.test(text))
  assert.ok(!/失败/.test(text))
})
