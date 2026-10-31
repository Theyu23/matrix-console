// 组件脚本的静态检查。
//
// 起因：ActionBar.vue 里把 defineProps(...) 写成裸调用，没赋给 props，
// 而下面又用了 props.lastSpeaker。vite build 只做编译不做求值，
// 构建照过；到运行时 setup 抛 ReferenceError，整个工具栏组件挂掉，
// 连带「添加账号」按钮点了没反应——症状看着像功能坏了，其实是脚本崩了。
//
// 这里只查最容易踩的那一类：defineProps 的返回值有没有被接住。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../src/components/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function scriptOf(file) {
  const src = readFileSync(join(DIR, file), 'utf8')
  const hit = src.match(/<script setup>([\s\S]*?)<\/script>/)
  return hit ? hit[1] : ''
}

test('every component that reads props binds defineProps to a variable', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.vue'))
  assert.ok(files.length > 0)

  for (const file of files) {
    const script = scriptOf(file)
    if (!script) continue
    // 裸调用 defineProps 之后又出现 props.xxx 就是必然的 ReferenceError。
    const bare = /^\s*defineProps\s*\(/m.test(script) && /[^.\w]props\./.test(script)
    assert.equal(bare, false, `${file}: defineProps 没赋值给 props，但代码里用了 props.xxx`)
  }
})

test('components that use props.xxx declare them', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.vue'))
  for (const file of files) {
    const script = scriptOf(file)
    if (!script) continue
    if (!/[^.\w]props\.\w/.test(script)) continue
    // 用了 props.x 就必须有 defineProps，否则 props 这个名字根本没定义。
    assert.ok(
      /defineProps\s*\(/.test(script),
      `${file}: 用到了 props.xxx 却没有 defineProps`
    )
  }
})

// 同一类事故的另一种写法：defineProps 声明了 health，脚本里却直接写 health?.[id]。
// <script setup> 里声明的 prop 名不会自动变成变量，裸用就是 ReferenceError。
// 这类错构建照样过，只在运行时炸，而且一炸整个组件不渲染。
test('declared prop names are not used as bare variables in script', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.vue'))
  for (const file of files) {
    const script = scriptOf(file)
    const hit = script.match(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/)
    if (!hit) continue
    // 从 props 对象字面量里扒出所有键名。
    const names = [...hit[1].matchAll(/(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1])
    const propsVar = script.match(/(?:const|let)\s+(\w+)\s*=\s*defineProps/)?.[1]

    for (const name of names) {
      // 形如 `health?.[` 或 `= health` 这种裸用；排除 `props.health` 与对象字面量键。
      const bare = new RegExp(`(?<![.\\w$])${name}\\s*(?:\\?\\.|\\[|\\.|\\)|,|\\s*\\})`).test(
        script
      )
      if (!bare) continue
      // 赋给 props 变量后就该用 props.name，裸名一定是漏改。
      assert.equal(
        bare && Boolean(propsVar),
        false,
        `${file}: prop "${name}" 被当作裸变量使用，应写成 ${propsVar || 'props'}.${name}`
      )
    }
  }
})

test('script setup blocks are balanced enough to compile', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.vue'))
  for (const file of files) {
    const src = readFileSync(join(DIR, file), 'utf8')
    // 每份 .vue 必须恰好有一个 script 块和一个 template 块；
    // 少一个通常意味着某次编辑吃掉了闭合标签。
    assert.equal((src.match(/<script setup>/g) || []).length, 1, `${file}: script setup 数量异常`)
    assert.ok(src.includes('</script>'), `${file}: script 未闭合`)
    assert.ok(src.includes('<template>'), `${file}: 缺 template`)
  }
})
