// 监看墙上评论条的取数逻辑，从组件里抽出来独立测。
//
// 抽出来的理由：这块最容易出错的不是渲染，而是「该取哪几条」「什么时候贴底」，
// 都是纯判断，放组件里只能靠肉眼看。

// 每格保留多少条。默认可见 3 条左右，多余的靠滚动。
export const WALL_CHAT_LINES = 20

// 单格取数：从尾部取，尾部就是「此刻最新」。
export function wallChatsFor(chats, id, limit = WALL_CHAT_LINES) {
  const list = chats && typeof chats === 'object' ? chats[id] : null
  if (!Array.isArray(list) || !list.length) return []
  const n = Math.max(0, Math.floor(Number(limit) || 0))
  if (!n) return []
  return list.slice(-n)
}

// 是否还贴着底看最新。距底 12px 内算贴底。
export const STICK_SLACK = 12

export function isNearBottom({ scrollTop, scrollHeight, clientHeight }, slack = STICK_SLACK) {
  const top = Number(scrollTop)
  const height = Number(scrollHeight)
  const client = Number(clientHeight)
  if (!Number.isFinite(top) || !Number.isFinite(height) || !Number.isFinite(client)) return true
  // 内容比视口还短时本来就没有滚动条，按贴底处理。
  if (height <= client) return true
  return height - top - client < slack
}
