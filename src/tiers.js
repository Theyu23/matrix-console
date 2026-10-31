// 账号分级。
//
// 目的不是让账号「更安全」，而是让损失可控：主力号是必须保住的，
// 备用号本来就是消耗品。两者不该用同一套待遇——
// 现在所有账号巡检频率一样、批量操作一样、上墙优先级一样，等于把主力
// 和备用绑在同一个风险面上。
//
// 分两级：
//   main   主力：优先上墙、巡检更勤、批量操作默认跳过
//   spare  备用：默认级别，批量操作优先作用在它身上

export const TIERS = ['main', 'spare']
export const DEFAULT_TIER = 'spare'

export function tierOf(account) {
  return account && account.tier === 'main' ? 'main' : DEFAULT_TIER
}

export function isMain(account) {
  return tierOf(account) === 'main'
}

// 巡检间隔：主力更勤，备用更疏。
// 主力被踢下线要尽早知道（重新扫码的代价大），备用可以等。
export const TIER_INTERVAL = {
  main: 20 * 60 * 1000,
  spare: 45 * 60 * 1000
}

export function intervalFor(account) {
  return TIER_INTERVAL[tierOf(account)] || TIER_INTERVAL[DEFAULT_TIER]
}

// 批量操作要不要带上这个账号。
// 默认跳过主力：批量登录、批量打开这类动作一次作用于很多账号，
// 形态最整齐，主力不该承担这种曝光。
export function includeInBatch(account, { includeMain = false } = {}) {
  if (!account) return false
  if (isMain(account) && !includeMain) return false
  return true
}

// 按分组拆出一批账号，供界面显示「主力 3 / 备用 7」。
export function summarizeTiers(accounts) {
  const list = (Array.isArray(accounts) ? accounts : []).filter(Boolean)
  let main = 0
  for (const a of list) if (isMain(a)) main++
  return { total: list.length, main, spare: list.length - main }
}

// 切换分级时的下一个值，供界面点击循环。
export function nextTier(account) {
  return isMain(account) ? 'spare' : 'main'
}

// 规范化从存储里读出来的分级值。不认识的、缺的，一律当备用。
// 这条很重要：老数据没有 tier 字段，读出来必须是 spare 而不是 undefined，
// 否则 cellsFor 的排序会把它们排到主力后面一位，位置看着乱跳。
export function normalizeTier(value) {
  return value === 'main' ? 'main' : DEFAULT_TIER
}
