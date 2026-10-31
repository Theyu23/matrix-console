// 话术占位符与分组轮换。
//
// 目的只有一个：同一条话术反复原样发出去，是所有评论里最容易被识别成机器的形态。
// 占位符让同一条模板每次填出来都不一样；轮换让同一个分组里的条目按序取用，
// 而不是随机撞运气（随机容易连着抽到同一条）。
//
// 这里全部是纯函数，不读写存储、不碰 DOM。

// 时段划分。按小时区间给一个自然的称呼，用于 {时段}。
// 边界取整点，避免「下午」和「傍晚」出现在同一分钟。
const PERIODS = [
  { from: 0, to: 5, text: '凌晨' },
  { from: 5, to: 9, text: '早上' },
  { from: 9, to: 12, text: '上午' },
  { from: 12, to: 14, text: '中午' },
  { from: 14, to: 18, text: '下午' },
  { from: 18, to: 23, text: '晚上' },
  { from: 23, to: 24, text: '深夜' }
]

export function periodOf(hour) {
  // Number(null) 是 0、Number('') 也是 0——不先挡掉，缺值会被当成凌晨。
  if (hour === null || hour === undefined || hour === '') return '此刻'
  const h = Math.floor(Number(hour))
  if (!Number.isFinite(h) || h < 0 || h > 23) return '此刻'
  const hit = PERIODS.find((p) => h >= p.from && h < p.to)
  return hit ? hit.text : '此刻'
}

// 支持的占位符清单，供界面提示用。
export const PLACEHOLDERS = [
  { key: '{昵称}', desc: '当前页面的对方昵称，取不到时留空' },
  { key: '{时段}', desc: '按本地时间给出凌晨/早上/上午/中午/下午/晚上/深夜' },
  { key: '{随机数}', desc: '1 到 100 之间的随机整数' },
  { key: '{日期}', desc: '本地日期，如 3月14日' }
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 填充上下文。nickname 由调用方给（当前评论流里最后一条的昵称，或手动输入）。
export function buildContext({ nickname = '', now = new Date(), random = Math.random } = {}) {
  const d = now instanceof Date ? now : new Date(now)
  const date = Number.isNaN(d.getTime()) ? new Date() : d
  return {
    nickname: String(nickname || '').trim(),
    period: periodOf(date.getHours()),
    date: `${date.getMonth() + 1}月${date.getDate()}日`,
    // 只取 1-100，避免出现 0 这种看着像填充失败的值。
    rand: () => Math.floor(random() * 100) + 1,
    // 时间戳形式，界面上偶尔要显示具体时刻。
    clock: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }
}

// 把模板里的占位符换掉。不认识的占位符原样保留——静默删掉会让用户
// 以为打错了却没提示，保留下来一眼就能看见。
export function renderPhrase(template, context) {
  const text = String(template || '')
  if (!text) return ''
  const ctx = context || buildContext()
  let out = text
  // {昵称} 取不到时整段去掉，而不是留下空的「你好，」这种残缺句。
  out = out.replace(/\{昵称\}/g, ctx.nickname || '')
  out = out.replace(/\{时段\}/g, () => ctx.period || '')
  out = out.replace(/\{日期\}/g, () => ctx.date || '')
  // 每次出现都给一个新随机数，同一句里两个 {随机数} 不该一模一样。
  out = out.replace(/\{随机数\}/g, () => String(typeof ctx.rand === 'function' ? ctx.rand() : ctx.rand))
  // 占位符被去掉后可能留下多余空格和空悬的标点，收拾一下。
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？、；：])/g, '$1')
    .replace(/^[，。！？、；：\s]+/, '')
    .trim()
}

// 分组轮换：每个分组各自记一个游标，按序取，取到底再从头。
// 用 Map 存游标，key 是分组名。同一个分组连续取用不会重复，
// 直到把整组走完一遍。
export function createRotator() {
  const cursors = new Map()
  return {
    // 取该分组的下一條。空组返回空字符串。
    next(groupName, items) {
      const list = Array.isArray(items) ? items.filter((x) => String(x || '').trim()) : []
      if (!list.length) return ''
      const key = String(groupName || '默认')
      const at = cursors.get(key) || 0
      const value = list[at % list.length]
      cursors.set(key, (at + 1) % list.length)
      return value
    },
    // 分组内容变了（用户编辑过），游标归零。
    // 否则游标可能停在新列表里不存在的位置，看起来像「跳过了一条」。
    reset(groupName) {
      if (groupName === undefined) cursors.clear()
      else cursors.delete(String(groupName || '默认'))
    },
    // 供界面显示「本组第几条」。
    cursorOf(groupName) {
      return cursors.get(String(groupName || '默认')) || 0
    }
  }
}

// 从若干分组里挑一个分组的名字。按顺序轮换，不随机。
// 这样「开场 → 互动 → 收尾」能成套地用，而不是乱序。
export function nextGroupName(groups, state) {
  const list = (Array.isArray(groups) ? groups : []).filter(
    (g) => g && Array.isArray(g.items) && g.items.length
  )
  if (!list.length) return ''
  const at = Number(state?.groupCursor) || 0
  return list[at % list.length].name
}
