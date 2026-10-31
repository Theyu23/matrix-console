// 账号环境快照档案。
//
// 用途是「对照」，不是「伪装」。一个真实账号的环境是稳定的：同一台机器、
// 同一个浏览器，上周和这周的 UA、时区、屏幕都一模一样。指纹会变恰恰是
// 伪装工具的特征。
//
// 所以这里只做两件事：记下每个账号每次探测到的环境；等它掉线时，能回答
// 「这次掉线之前环境变过没有」。这是诊断依据，不是用来改值的。

const SNAPSHOT_KEY = 'matrix.envSnapshots'
// 每个账号最多留几条。留多了占 localStorage，而且太久以前的值没有对照价值。
export const MAX_SNAPSHOTS = 20

// 只挑有诊断意义的字段。dpr、touch 这类每次都可能因为窗口缩放而变，
// 记进来会让「环境变了」的判断充满噪声，所以不参与比对。
export const TRACKED_FIELDS = [
  'ua',
  'platform',
  'uaPlatform',
  'cores',
  'memory',
  'language',
  'timezone',
  'screen',
  'webglVendor',
  'webglRenderer'
]

// 从一条 envProbe 结果里挑出要比对的字段。
export function pickTracked(env) {
  const out = {}
  for (const key of TRACKED_FIELDS) {
    const v = env?.[key]
    out[key] = v === undefined || v === null ? '' : String(v)
  }
  return out
}

// 对比两次快照，返回变化的字段名。
// 空值不算变化：某次探测没取到 WebGL 不代表浏览器变了。
export function diffSnapshot(before, after) {
  const a = pickTracked(before)
  const b = pickTracked(after)
  const changed = []
  for (const key of TRACKED_FIELDS) {
    if (!a[key] || !b[key]) continue
    if (a[key] !== b[key]) changed.push(key)
  }
  return changed
}

// 追加一条快照并裁到上限。返回新的列表，不改入参。
export function appendSnapshot(list, snapshot, { max = MAX_SNAPSHOTS } = {}) {
  const arr = Array.isArray(list) ? list.slice() : []
  arr.push({
    ts: Number(snapshot?.ts) || Date.now(),
    tracked: pickTracked(snapshot)
  })
  const limit = Math.max(1, Math.floor(Number(max) || MAX_SNAPSHOTS))
  return arr.length > limit ? arr.slice(-limit) : arr
}

// 和最近一条旧快照比对，得出「这次探测之后环境有没有变」。
// 只跟最近一条比，因为要回答的是「自上次以来变没变」，
// 跟最早那条比只会累积一堆历史噪声。
export function compareWithLatest(list, snapshot) {
  const arr = Array.isArray(list) ? list : []
  if (!arr.length) return { first: true, changed: [] }
  const latest = arr[arr.length - 1]
  const changed = diffSnapshot(latest?.tracked, snapshot)
  return { first: false, changed }
}

export function loadSnapshots(storage) {
  try {
    const raw = storage?.getItem?.(SNAPSHOT_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [id, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue
      out[id] = list.filter((s) => s && typeof s === 'object' && s.tracked)
    }
    return out
  } catch {
    return {}
  }
}

export function saveSnapshots(storage, all) {
  try {
    storage?.setItem?.(SNAPSHOT_KEY, JSON.stringify(all || {}))
    return true
  } catch {
    // localStorage 满了会抛；档案不是关键数据，静默失败即可。
    return false
  }
}

// 给界面显示的一句话摘要。
export function describeSnapshot(list) {
  const arr = Array.isArray(list) ? list : []
  if (!arr.length) return '还没有环境快照'
  const last = arr[arr.length - 1]
  const when = new Date(Number(last.ts) || Date.now())
  const stamp = `${when.getMonth() + 1}月${when.getDate()}日 ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  return `${arr.length} 条，最近 ${stamp}`
}
