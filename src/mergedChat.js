// 评论流的「多路合并」取数。
//
// 监看墙上一屏可能开着十来个视频，各自的评论流原本只在自己格里滚。
// 这里把它们按时间合成一条，并带上来源，让「哪个视频在说什么」一眼可读。
// 纯函数：不碰 DOM、不碰组件状态，合并规则可以单独测。

// 合并后最多保留多少条。比单路的 200 少一些：
// 多路合起来增长快，留太多会让面板滚动很长，也对不上「看当下」的用途。
export const MERGED_LIMIT = 150

// 决定哪些账号参与评论流。
// - 单页模式：只有当前选中的那一个。
// - 监看墙：墙上所有账号一起看，这才是「多路同时盯」的用处。
//
// 为什么不按列表里的勾选筛：勾选是批量操作（打开链接 / 移除）的入口，
// 拿它当评论流筛选会互相打架——你为了给某个号开直播而勾上它，
// 评论流就悄悄只剩那一路了。想单独看某一路，点格子放大成单页即可。
export function streamTargets({ accounts, activeId, gridMode }) {
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : []
  if (!gridMode) {
    const one = list.find((a) => a.id === activeId)
    return one ? [one] : []
  }
  // 不按 MAX_CELLS 截断：上不了墙的账号仍在后台采集，
  // 它的评论同样真实，没有理由在流里被丢掉。
  return list
}

// 合并之后想只看其中一路时用的筛选。
// scope 是账号 id；不在列表里（比如那格已经关掉）就退回全部，
// 不留下「选了但没数据」的空面板。
export function pickScope(list, scope) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : []
  if (!scope) return arr
  const hit = arr.filter((a) => a.id === scope)
  return hit.length ? hit : arr
}

// 多路合并。targets 形如 [{ id, nickname }]。
//
// 为什么不去重跨来源：两个视频下不同观众同时打「666」是真事，
// 按内容去重会把这些真实消息吞掉。同源内部的重复已由 onChat 处理过。
export function mergeChats(chats, targets, limit = MERGED_LIMIT) {
  const n = Math.max(0, Math.floor(Number(limit) || 0))
  if (!n) return []
  const list = Array.isArray(targets) ? targets.filter(Boolean) : []
  const rows = []
  list.forEach((t, srcIndex) => {
    const src = chats && typeof chats === 'object' ? chats[t.id] : null
    if (!Array.isArray(src) || !src.length) return
    src.forEach((m, i) => {
      if (!m) return
      rows.push({
        kind: m.kind === 'video' ? 'video' : 'live',
        nickname: m.nickname || '',
        text: m.text || '',
        ts: Number(m.ts) || 0,
        srcId: t.id,
        srcName: String(t.nickname || srcIdShort(t.id)),
        // 排序用的稳定键：时间相同的两条不能每次刷新换位置。
        _ord: srcIndex * 1e6 + i
      })
    })
  })
  rows.sort((a, b) => a.ts - b.ts || a._ord - b._ord)
  const out = rows.slice(-n)
  // 去掉内部排序键，避免它漏进渲染或持久化。
  return out.map(({ _ord, ...rest }) => rest)
}

function srcIdShort(id) {
  const s = String(id || '')
  return s.length > 6 ? s.slice(0, 6) : s || '?'
}

// 合并后的最近发言者，给话术里的 {昵称} 占位符用。
export function lastSpeakerOf(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.nickname) return list[i].nickname
  }
  return ''
}

// 面板标题用：参与合并的账号名，超过 max 个就用「等 N 个」收尾。
export function summarizeSources(targets, max = 2) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : []
  if (!list.length) return ''
  const names = list.map((a) => String(a.nickname || '账号'))
  if (names.length <= max) return names.join('、')
  return names.slice(0, max).join('、') + ` 等 ${names.length} 个`
}
