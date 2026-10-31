import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_OBSERVER_SCRIPT,
  VIDEO_OBSERVER_SCRIPT,
  fillInputScript,
  sendCommentScript
} from '../src/chatObserver.js'
import { commentKind, isVideoPage } from '../src/platforms.js'

// 注入脚本要能真正跑起来，语法错误在这里就该暴露，而不是等到直播间里。
// 脚本体是 IIFE 且模板字符串以换行开头，直接 `return` 会被 ASI 断成 return; —— 必须加括号。
function runInPage(script, sandbox = {}) {
  const fn = new Function('window', 'document', 'MutationObserver', 'console', 'return (' + script + ')')
  return fn(
    sandbox.window || {},
    sandbox.document || {},
    sandbox.MutationObserver || class {},
    sandbox.console || { log() {} }
  )
}

const style = () => ({ display: 'block', visibility: 'visible' })

test('observer script installs once and reports already on re-inject', () => {
  class FakeObserver {
    observe() {}
  }
  const win = {}
  const doc = { querySelectorAll: () => [], body: {} }
  const first = runInPage(CHAT_OBSERVER_SCRIPT, {
    window: win,
    document: doc,
    MutationObserver: FakeObserver
  })
  assert.equal(first, 'installed')
  const second = runInPage(CHAT_OBSERVER_SCRIPT, {
    window: win,
    document: doc,
    MutationObserver: FakeObserver
  })
  assert.equal(second, 'already')
})

test('observer re-emits when the same chat item text changes in place', () => {
  let callback = null
  class FakeObserver {
    constructor(cb) {
      callback = cb
    }
    observe() {}
  }
  const logged = []
  let text = '第一条'
  const item = {
    nodeType: 1,
    isConnected: true,
    querySelector: (sel) =>
      sel.includes('nickname') ? { innerText: '小明' } : { innerText: text },
    closest: () => item
  }
  const doc = {
    querySelectorAll: (sel) => (sel === '[class~="webcast-chatroom___item"]' ? [item] : []),
    body: {}
  }
  const win = { requestAnimationFrame: (fn) => fn() }
  runInPage(CHAT_OBSERVER_SCRIPT, {
    window: win,
    document: doc,
    MutationObserver: FakeObserver,
    console: { log: (m) => logged.push(m) }
  })
  assert.equal(logged.length, 1)
  assert.equal(JSON.parse(logged[0].slice('__MATRIX_CHAT__'.length)).text, '第一条')

  // 同一条元素被就地改写（characterData mutation）：旧实现用 WeakSet，这里会被永久吞掉。
  text = '第二条'
  callback([{ addedNodes: [], target: item }])
  assert.equal(logged.length, 2)
  assert.equal(JSON.parse(logged[1].slice('__MATRIX_CHAT__'.length)).text, '第二条')

  // 文本没变时不应重复上报。
  callback([{ addedNodes: [], target: item }])
  assert.equal(logged.length, 2)
})

test('live observer tags its output as live', () => {
  class FakeObserver {
    observe() {}
  }
  const logged = []
  const item = {
    nodeType: 1,
    isConnected: true,
    querySelector: (sel) => (sel.includes('nickname') ? { innerText: '观众' } : { innerText: '666' })
  }
  const doc = {
    querySelectorAll: (sel) => (sel === '[class~="webcast-chatroom___item"]' ? [item] : []),
    body: {}
  }
  runInPage(CHAT_OBSERVER_SCRIPT, {
    window: { requestAnimationFrame: (fn) => fn() },
    document: doc,
    MutationObserver: FakeObserver,
    console: { log: (m) => logged.push(m) }
  })
  assert.equal(JSON.parse(logged[0].slice('__MATRIX_CHAT__'.length)).kind, 'live')
})

test('video observer uses its own selectors and tags output as video', () => {
  class FakeObserver {
    observe() {}
  }
  const logged = []
  const item = {
    nodeType: 1,
    isConnected: true,
    querySelector: (sel) =>
      /username|user-name|nickname/.test(sel) ? { innerText: '路人甲' } : { innerText: '这个视频讲得清楚' }
  }
  const doc = {
    querySelectorAll: (sel) => (sel === '[data-e2e="comment-item"]' ? [item] : []),
    body: {}
  }
  const win = { requestAnimationFrame: (fn) => fn() }
  runInPage(VIDEO_OBSERVER_SCRIPT, {
    window: win,
    document: doc,
    MutationObserver: FakeObserver,
    console: { log: (m) => logged.push(m) }
  })
  const payload = JSON.parse(logged[0].slice('__MATRIX_CHAT__'.length))
  assert.equal(payload.kind, 'video')
  assert.equal(payload.nickname, '路人甲')
  assert.equal(payload.text, '这个视频讲得清楚')
  // 两套观察器用不同的全局 flag，互不干扰，同一账号在两类页面间切换不会互相挡住。
  assert.equal(win.__matrixVideoObserver, true)
  assert.equal(win.__matrixChatObserver, undefined)
})

test('video observer skips button-like lines inside a comment node', () => {
  class FakeObserver {
    observe() {}
  }
  const logged = []
  const item = {
    nodeType: 1,
    isConnected: true,
    querySelector: (sel) => (/username|user-name|nickname/.test(sel) ? null : { innerText: '展开' })
  }
  const doc = {
    querySelectorAll: (sel) => (sel === '[data-e2e="comment-item"]' ? [item] : []),
    body: {}
  }
  runInPage(VIDEO_OBSERVER_SCRIPT, {
    window: { requestAnimationFrame: (fn) => fn() },
    document: doc,
    MutationObserver: FakeObserver,
    console: { log: (m) => logged.push(m) }
  })
  assert.equal(logged.length, 0)
})

test('commentKind separates live rooms from video pages', () => {
  assert.equal(commentKind('https://live.douyin.com/123456'), 'live')
  assert.equal(commentKind('https://www.douyin.com/video/7412345678901234567'), 'video')
  assert.equal(commentKind('https://www.douyin.com/note/7412345678901234567'), 'video')
  assert.equal(commentKind('https://www.douyin.com/user/self'), '')
  assert.equal(commentKind('https://channels.weixin.qq.com/platform'), '')
  assert.equal(isVideoPage('https://www.douyin.com/video/7412345678901234567?x=1'), true)
  assert.equal(isVideoPage('https://live.douyin.com/123'), false)
})

test('fillInputScript embeds text as a literal, not as executable code', () => {
  const evil = `'); throw new Error('pwned'); //`
  const script = fillInputScript(evil)
  // 文本走 JSON.stringify 后应变成一个合法字符串字面量。
  assert.ok(script.includes(JSON.stringify(evil)))
  assert.doesNotThrow(() => new Function('return ' + script))
})

test('fillInputScript returns no-input when nothing matches', () => {
  const result = runInPage(fillInputScript('hi'), {
    window: { getComputedStyle: style },
    document: { querySelectorAll: () => [], body: { appendChild() {} } }
  })
  assert.equal(result, 'no-input')
})

test('fillInputScript does not leave a marker attribute in the DOM', () => {
  const script = fillInputScript('hi')
  // 旧实现用 data-matrix-comment-input 在两次 executeJavaScript 之间传状态，
  // 等于在页面上留了一个「已被注入」的标记。
  assert.equal(script.includes('data-matrix'), false)
  assert.ok(script.includes('__matrixInput'))
})

test('fillInputScript writes the value and dispatches input + change', () => {
  const events = []
  class FakeEvent {
    constructor(type) {
      this.type = type
    }
  }
  class FakeTextArea {
    constructor() {
      this.tagName = 'TEXTAREA'
      this.value = ''
      this.offsetWidth = 100
      this.offsetHeight = 20
    }
    getAttribute() {
      return null
    }
    focus() {}
    dispatchEvent(e) {
      events.push(e.type)
      return true
    }
  }
  globalThis.HTMLTextAreaElement = FakeTextArea
  globalThis.HTMLInputElement = class {}
  globalThis.Event = FakeEvent
  globalThis.InputEvent = FakeEvent

  const el = new FakeTextArea()
  const win = { getComputedStyle: style }
  const doc = {
    querySelectorAll: (sel) => (sel === 'textarea' ? [el] : []),
    body: { appendChild() {} }
  }
  const result = runInPage(fillInputScript('你好'), { window: win, document: doc })
  assert.equal(result, 'filled')
  assert.equal(el.value, '你好')
  assert.deepEqual(events, ['input', 'change'])
  assert.equal(win.__matrixInput, el)
})

test('sendCommentScript refuses to send an empty input', () => {
  class FakeEvent {
    constructor(type) {
      this.type = type
    }
  }
  globalThis.Event = FakeEvent
  globalThis.InputEvent = FakeEvent
  const win = {
    __matrixInput: { isConnected: true, tagName: 'TEXTAREA', value: '   ' },
    getComputedStyle: style
  }
  const doc = { querySelectorAll: () => [] }
  return runInPage(sendCommentScript(), { window: win, document: doc }).then((r) => {
    assert.equal(r, 'empty-input')
  })
})

test('sendCommentScript reports no-input after the page detached the element', async () => {
  const win = { __matrixInput: { isConnected: false, tagName: 'TEXTAREA', value: 'x' } }
  const r = await runInPage(sendCommentScript(), {
    window: win,
    document: { querySelectorAll: () => [] }
  })
  assert.equal(r, 'no-input')
})
