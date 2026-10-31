// 崩溃自愈判定。
//
// webview 的渲染进程在长时挂机（尤其直播间）时崩掉是常事。旧实现只把状态标成
// offline，页面永远空着，用户得手动重开。这里给一次自动重挂的机会：窗口期内
// 第一次崩溃就重挂，同一窗口内第二次才放弃并报离线——避免和同一个崩溃死循环。
//
// 只做判定，不碰 Electron API，方便单测。

export const CRASH_WINDOW = 3 * 60 * 1000
export const CRASH_MAX_RETRY = 1

// 返回 { retry, count }：count 是窗口期内（含本次）的崩溃次数。
export function decideCrashRetry(history, now, { windowMs = CRASH_WINDOW, max = CRASH_MAX_RETRY } = {}) {
  const recent = (Array.isArray(history) ? history : []).filter(
    (ts) => Number.isFinite(ts) && now - ts >= 0 && now - ts < windowMs
  )
  recent.push(now)
  return { retry: recent.length <= max, count: recent.length, recent }
}
