// 画像注入链路的回归检查。
//
// 这三条都来自同一次真实故障：账号 A 的画像明明是 12 核 / 8G / 4 种语言，
// 打开 webview 后页面里读到的却是 24 核 / 16G / 2 种语言（本机真实值），
// 而 Navigator.prototype 上的描述符还是原生形态（enumerable: true）。
// 逐层查下来是三个独立问题叠在一起，任何一个不修都复现：
//
//   1. 宿主上的 did-attach 不触发 → 注入代码整段没跑
//      （宿主 type 是 window，套了 getType() === 'webview' 就永远进不去）
//   2. 渲染层 void applyAccountEnv(a) 不等 IPC → 主进程拿不到真画像，
//      只能用 buildProfile(id) 现算一份不带 preset 的顶上（档位不同）
//   3. addScriptToEvaluateOnNewDocument 注册完时首屏已经跑起来了
//      → 脚本只对下一次导航生效，必须补一次重载
//
// 第三条最隐蔽：前两条修好后日志显示注入「成功」、画像也对，
// 但页面里仍是真实值，因为脚本注册得太晚。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainSrc = readFileSync(path.join(root, 'electron/main.js'), 'utf8')
const appSrc = readFileSync(path.join(root, 'src/App.vue'), 'utf8')

// 只保留可执行行，去掉整行注释，避免注释里提到的名字被误判。
function codeLines(src) {
  return src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
}

test('guest 注入挂在 web-contents-created 的 guest 分支上，不挂在宿主的 did-attach', () => {
  const lines = codeLines(mainSrc)
  // 宿主上的 did-attach 在 Electron 45 的 <webview> 下不触发，用它会静默失效。
  const didAttach = lines.filter((l) => /\.on\(\s*['"]did-attach['"]/.test(l))
  assert.equal(didAttach.length, 0, '不要用宿主 did-attach 注入：它不触发，注入会静默失效')

  // 走的是 guest 自己的创建事件。
  assert.ok(
    lines.some((l) => /contents\.getType\(\)\s*===\s*['"]webview['"]/.test(l)),
    '应当按 contents.getType() === "webview" 找 guest'
  )
  assert.ok(
    lines.some((l) => /applyProfileToWebContents\(\s*contents\s*,/.test(l)),
    '找到 guest 后要把画像注入到 guest 上'
  )
})

test('注入注册完脚本后主动重载一次，否则赶不上首屏', () => {
  const lines = codeLines(mainSrc)
  const start = lines.findIndex((l) => /function applyProfileToWebContents/.test(l))
  assert.ok(start >= 0, 'applyProfileToWebContents 应当存在')

  // 函数体到下一个顶层 function 为止。
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^function\s/.test(lines[i])) { end = i; break }
  }
  const body = lines.slice(start, end)

  assert.ok(
    body.some((l) => /addScriptToEvaluateOnNewDocument/.test(l)),
    '要注册 document_start 脚本'
  )
  assert.ok(
    body.some((l) => /contents\.reload\(\)/.test(l)),
    '注册完必须重载一次：addScriptToEvaluateOnNewDocument 只对之后的导航生效'
  )
  // 重载必须接在 setup 之后，也就是「注册完再重载」，而不是反过来。
  const rearmCall = body.findIndex((l) => /setup\(\)\.then\(\s*rearm\s*\)/.test(l))
  assert.ok(
    rearmCall >= 0,
    '要先 setup()（内部注册脚本）再 rearm（重载），写成 setup().then(rearm)'
  )
  const reg = body.findIndex((l) => /addScriptToEvaluateOnNewDocument/.test(l))
  assert.ok(rearmCall > reg, '重载要排在脚本注册之后')
})

test('挂载 webview 前必须等环境下发完成', () => {
  const lines = codeLines(appSrc)
  // 不能出现「不等就挂载」的写法：void applyAccountEnv(a) 后面紧跟 a.opened = true
  // 会让 IPC 还在路上时 webview 就挂载，主进程只能现算一份画像顶上。
  assert.ok(
    !/void\s+applyAccountEnv\(/.test(appSrc),
    '不要用 void applyAccountEnv：必须等到 IPC 返回再挂载 webview'
  )
  assert.ok(
    /await\s+applyAccountEnv\(/.test(appSrc),
    'dispatchOpen 里要 await applyAccountEnv'
  )

  // opened 置位必须在 await 之后：它是 paneAccounts 的依据，一置位就挂载。
  const awaitIdx = lines.findIndex((l) => /await\s+applyAccountEnv\(/.test(l))
  const openedIdx = lines.findIndex((l) => /a\.opened\s*=\s*true/.test(l))
  assert.ok(awaitIdx >= 0, '要 await applyAccountEnv')
  assert.ok(openedIdx > awaitIdx, 'a.opened = true 必须在 await applyAccountEnv 之后')
})

test('组件里读 webview 的 URL 一律走 safeViewUrl', () => {
  // did-start-loading 可能早于 dom-ready，此时 WebViewElement.getURL() 会同步抛
  // "The WebView must be attached to the DOM..."。直接调用会打断整个事件回调，
  // 状态不更新、观察器不注入，表现像页面卡死。
  const paneSrc = readFileSync(path.join(root, 'src/components/BrowserPane.vue'), 'utf8')
  const script = (paneSrc.match(/<script setup>([\s\S]*?)<\/script>/) || [])[1] || ''
  assert.ok(script, 'BrowserPane.vue 应当有 script setup')

  const code = script
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))

  const direct = code.filter((l) => /\.getURL\s*\(/.test(l))
  assert.equal(
    direct.length,
    0,
    '不要直接调 getURL()，用 safeViewUrl(el, fallback)：' + direct.join(' | ')
  )
  assert.ok(
    /safeViewUrl/.test(script),
    'BrowserPane.vue 应当 import 并使用 safeViewUrl'
  )
})

test('下发的画像必须是普通对象，不能把 reactive 的 Proxy 交给 invoke', () => {
  // profiles 是 reactive() 的，profileFor() 返回的是 Proxy。
  // ipcRenderer.invoke 走结构化克隆，遇到 Proxy 抛
  // "An object could not be cloned."，环境下发就整段静默失败：
  // 主进程永远收不到真画像，只能用它自己现算的那份，页面硬件项全错。
  // 这个错误在界面上没有渲染（envError 没进模板），只能靠静态查。
  const start = appSrc.indexOf('async function applyAccountEnv')
  assert.ok(start >= 0, 'applyAccountEnv 应当存在')
  const body = appSrc.slice(start, start + 1400)

  assert.ok(
    /JSON\.parse\(\s*JSON\.stringify\(\s*profileFor\(/.test(body),
    '下发前要把 profileFor 的结果深拷贝成普通对象，否则 Proxy 克隆失败'
  )
  // 直接把 profileFor(a) 塞进 setAccountEnv 就是原 bug。
  assert.ok(
    !/profile:\s*profileFor\(/.test(body),
    '不要直接把 profileFor(a) 当 profile 传：那是 reactive Proxy'
  )
})
