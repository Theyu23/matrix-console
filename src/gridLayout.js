// 监看墙的网格切分。
//
// 只算行列数，不碰 DOM：webview 元素本身不搬家，切布局只改 CSS，
// 这样不会有任何一个页面因为切换视图被重新加载。

// 上限从 9 提到 12。9 是 3×3 整齐，但十个账号会有一个上不了墙；
// 12 刚好是 4×3，十到十二个都能排满，是「一屏塞得下」和「还看得清」的折中。
// 再多就没人看得清了，真人也就盯得住三四路。
export const MAX_CELLS = 12

// 每格的宽高比按 16:9 算，用来给网格定一个合理的行列数：
// 列数太少格子会扁得像条，太多高度又不够。
// 目标是让格子尽量接近 16:9，而不是机械地「三列四行」。
export function gridShape(count, max = MAX_CELLS) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const cap = Math.max(1, Math.floor(Number(max) || MAX_CELLS))
  const cells = Math.min(n, cap)
  if (cells <= 1) return { cols: 1, cells, hidden: n - cells }
  if (cells <= 4) return { cols: 2, cells, hidden: n - cells }
  // 5-9 用三列；10 以上用四列，否则行数太多每格太扁。
  const cols = cells <= 9 ? 3 : 4
  return { cols, cells, hidden: n - cells }
}

// 上墙的账号。超出上限的部分不显示，但仍在后台照常跑。
// 排序规则：主力账号先上墙，同级之间保持原顺序。
// 理由是一屏看得住的位置有限，先给需要盯的那些。
export function cellsFor(accounts, limit = MAX_CELLS) {
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : []
  const cap = Math.max(0, Math.floor(Number(limit) || 0))
  if (!cap) return []
  const tierOf = (a) => (a && a.tier === 'main' ? 0 : 1)
  // 稳定排序：tier 相同时保持原索引顺序，避免每次刷新格子位置乱跳。
  const ordered = list
    .map((a, i) => ({ a, i, t: tierOf(a) }))
    .sort((x, y) => x.t - y.t || x.i - y.i)
    .map((x) => x.a)
  return ordered.slice(0, cap)
}

// 上不了墙的账号列表。用于提示条说明「还有几个在后台跑」。
export function hiddenFor(accounts, limit = MAX_CELLS) {
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : []
  const cap = Math.max(0, Math.floor(Number(limit) || 0))
  const shown = new Set(cellsFor(list, cap).map((a) => a.id))
  return list.filter((a) => !shown.has(a.id))
}
