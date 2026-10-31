// 时间抖动与账号错开。
//
// 为什么要这个：固定间隔必然形成固定模式。巡检每 30 分钟准点跑、批量打开一次
// 放三个、账号按列表顺序依次请求——这些都是「形状」而不是「值」，比 UA 好抓。
// 抖动不改变总频率，只把落点打散，让后台定时任务看起来不像定时任务。
//
// 全部纯函数，随机源可注入，方便单测。

// 对称抖动：可能提前也可能延后，平均值仍是 base。
// ratio 是相对幅度，0.25 表示 ±25%。
export function jitter(ms, { ratio = 0.25, random = Math.random, min = 1000 } = {}) {
  const base = Number(ms)
  if (!Number.isFinite(base) || base <= 0) return Math.max(0, Number(min) || 0)
  const r = Math.min(1, Math.max(0, Number(ratio) || 0))
  const spread = base * r
  const value = base + (random() * 2 - 1) * spread
  // 下限兜底：抖动到接近 0 会把定时任务变成忙等。
  return Math.max(Math.max(0, Number(min) || 0), Math.round(value))
}

// 账号之间的错开延迟。
// 一台机器上二十几个号在 3 秒内挨个访问同一路径，这个密集程度本身就是信号。
export function staggerDelay(index, { baseMs = 700, maxMs = 2600, random = Math.random } = {}) {
  const i = Math.max(0, Math.floor(Number(index) || 0))
  const base = Math.max(0, Number(baseMs) || 0)
  const cap = Math.max(base, Number(maxMs) || base)
  // 线性抬升 + 随机，避免「序号越大延迟越固定」这种新的规律。
  const target = base + i * base * 0.5
  const value = target + random() * base
  return Math.round(Math.min(cap, value))
}

// 批量操作里每个目标之间的等待。用固定上限保证整批不会拖太久。
export function batchGap(index, opts) {
  return staggerDelay(index, opts)
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)))
