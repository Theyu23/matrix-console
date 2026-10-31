// 话术模板解析：以 # 开头的行是分组名，其余每行一条。
// 全局去重（保留第一次出现的位置），文本顺序即展示顺序。
export function parsePhrases(raw) {
  const groups = []
  const seen = new Set()
  let group = { name: '默认', items: [] }
  for (const line of String(raw || '').split('\n')) {
    const value = line.trim()
    if (!value) continue
    if (value.startsWith('#')) {
      if (group.items.length) groups.push(group)
      group = { name: value.replace(/^#+\s*/, '') || '默认', items: [] }
      continue
    }
    if (seen.has(value)) continue
    seen.add(value)
    group.items.push(value)
  }
  if (group.items.length) groups.push(group)
  return groups
}

export function serializePhrases(groups) {
  const lines = []
  const withHeaders = groups.length > 1
  for (const group of groups) {
    if (withHeaders || group.name !== '默认') lines.push('#' + group.name)
    lines.push(...group.items)
  }
  return lines.join('\n')
}
