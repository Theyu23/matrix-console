// 分栏宽度：纯计算 + 持久化，方便单测。
//
// 为什么要有这一层：拖动分隔条时的宽度计算如果散在组件里，
// 「拖到比窗口还宽」这种边界就没法测，只能靠手拖去试。

// 三处可拖的分栏。default 是现在写死的宽度，改成可拖之后保持原样。
export const SPLITS = {
  list: { min: 240, max: 560, def: 320 },
  chat: { min: 240, max: 520, def: 280 },
  env: { min: 300, max: 720, def: 420 }
}

export const LAYOUT_KEY = 'matrix.layout'

// 中间那块（webview 区）至少留这么多，否则分栏一拖大，网页就只剩一条缝。
export const MIN_STAGE = 320

export function clamp(value, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  if (max < min) return min
  return Math.min(max, Math.max(min, n))
}

// 拖动增量换算成新宽度。
// invert: 分隔条左边的分栏往右拖变宽；右边的分栏往左拖才变宽。
export function nextWidth(start, dx, spec, invert = false) {
  const d = invert ? -dx : dx
  return clamp(Number(start) + d, spec.min, spec.max)
}

// 键盘调整：方向键小步、按住 Shift 大步。用「往哪个方向长」来表达，
// 免得组件里操心左右方向相反这件事。
export function stepWidth(width, key, spec, { invert = false, big = false } = {}) {
  const unit = big ? 64 : 16
  // grow=+1 表示该分栏变宽
  let grow = 0
  if (key === 'ArrowRight') grow = 1
  else if (key === 'ArrowLeft') grow = -1
  else return width
  if (invert) grow = -grow
  return clamp(Number(width) + grow * unit, spec.min, spec.max)
}

// 动态上限：窗口变窄时不能还允许 720 的环境面板，否则会把中间挤成负数。
// others 是其它已占用的固定宽度之和。
export function limitMax(spec, available, others = 0, minStage = MIN_STAGE) {
  const room = Number(available) - Number(others) - minStage
  if (!Number.isFinite(room)) return spec.max
  return clamp(room, spec.min, spec.max)
}

// 拖大一个分栏后，如果中间不够了，就把它压回能放下的最大值。
// 返回最终应该采用的宽度，调用方直接赋值即可。
export function fitWidth(width, spec, available, others = 0, minStage = MIN_STAGE) {
  const max = limitMax(spec, available, others, minStage)
  return clamp(width, spec.min, max)
}

export function normalizeLayout(raw) {
  const out = {}
  for (const [key, spec] of Object.entries(SPLITS)) {
    const v = raw && typeof raw === 'object' ? raw[key] : undefined
    out[key] = clamp(v === undefined || v === null ? spec.def : v, spec.min, spec.max)
  }
  return out
}

export function loadLayout(storage) {
  if (!storage || typeof storage.getItem !== 'function') return normalizeLayout(null)
  try {
    const raw = storage.getItem(LAYOUT_KEY)
    if (!raw) return normalizeLayout(null)
    return normalizeLayout(JSON.parse(raw))
  } catch {
    // 存坏了就回默认值，不要因为一个坏值把整个界面卡在异常宽度上。
    return normalizeLayout(null)
  }
}

export function saveLayout(storage, layout) {
  // 显式判空：可选链对 null 存储不会抛错，会静默失败并误报成功。
  if (!storage || typeof storage.setItem !== 'function') return false
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(normalizeLayout(layout)))
    return true
  } catch {
    return false
  }
}
