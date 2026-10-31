// 注入到平台页面的只读观察器：监听评论项，通过 console 回传宿主。
// 只读 DOM，不做任何点击/输入。
//
// 两套选择器配置：
// - live:  抖音直播间（live.douyin.com）。聊天区结构稳定，用 ~= 精确匹配 class token，
//          避免 ___item-wrapper 这类含子串的节点重复命中。
// - video: 抖音视频页（www.douyin.com/video/*）。评论区是虚拟列表，节点会被复用，
//          所以去重必须按「元素 + 当前文本」而不是「元素本身」，否则复用到新评论会被吞掉。
//
// 视频页的那组选择器按公开页面结构推断，抖音改版后会失效。要调只改下面的 VIDEO_PROFILE，
// 脚本主体是通用的。
const LIVE_PROFILE = {
  key: 'live',
  flag: '__matrixChatObserver',
  // 第一个必须保持精确 token 匹配，直播间专用。
  items: ['[class~="webcast-chatroom___item"]', '[class*="webcast-chatroom___item"]'],
  nickname: ['[class*="webcast-chatroom___nickname"]'],
  text: ['[class*="webcast-chatroom___display-text"]'],
  // 进场提示 / 点赞提示不进评论流。
  skip: ['等\\d+人来了$', '^\\S{1,20} 来了$', '为主播点赞了$', '^欢迎来到直播间']
}

const VIDEO_PROFILE = {
  key: 'video',
  flag: '__matrixVideoObserver',
  items: [
    '[data-e2e="comment-item"]',
    '[class*="comment-item"]',
    '[class*="CommentItem"]',
    'div[class*="comment"][class*="item"]'
  ],
  nickname: [
    '[data-e2e="comment-username"]',
    '[class*="user-name"]',
    '[class*="username"]',
    '[class*="nickname"]'
  ],
  text: [
    '[data-e2e="comment-content"]',
    '[class*="comment-content"]',
    '[class*="content-inner"]'
  ],
  // 评论区里的按钮文案和占位提示不是评论内容。
  skip: ['^(展开|收起|查看更多|查看\\d+条回复|回复)$', '^作者$', '^置顶$']
}

function buildObserverScript(profile) {
  return String.raw`
(() => {
  var FLAG = ${JSON.stringify(profile.flag)}
  var KIND = ${JSON.stringify(profile.key)}
  if (window[FLAG]) return 'already'
  window[FLAG] = true
  var ITEMS = ${JSON.stringify(profile.items)}
  var NICK = ${JSON.stringify(profile.nickname)}
  var TEXT = ${JSON.stringify(profile.text)}
  var SKIP = ${JSON.stringify(profile.skip)}.map(function (src) { return new RegExp(src) })
  // 用 WeakMap 记「该节点上次上报的文本」：同一条评论被就地改写（或虚拟列表复用节点）
  // 时能补发，而不是永远吞掉。用 WeakSet 会漏掉这一类。
  var reported = new WeakMap()
  var pending = new Set()
  var scheduled = false

  function firstText(el, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var n = el.querySelector(selectors[i])
      if (n && n.innerText && n.innerText.trim()) return n.innerText.trim()
    }
    return ''
  }
  function skipped(text) {
    for (var i = 0; i < SKIP.length; i++) {
      if (SKIP[i].test(text)) return true
    }
    return false
  }
  function extract(item) {
    var nickname = firstText(item, NICK)
    var text = firstText(item, TEXT)
    if (!text) text = (item.innerText || '').trim()
    if (!text) return null
    if (skipped(text)) return { skip: true }
    if (!nickname) {
      var idx = text.indexOf('：')
      if (idx > 0 && idx < 40) {
        nickname = text.slice(0, idx)
        text = text.slice(idx + 1).trim()
      }
    }
    if (!text) return { skip: true }
    return { nickname: nickname, text: text.slice(0, 200) }
  }
  function emit(item) {
    var r = extract(item)
    if (!r) return false // 文本还没渲染出来，后续 mutation 再试
    if (r.skip) {
      reported.set(item, '')
      return true
    }
    if (reported.get(item) === r.text) return true
    reported.set(item, r.text)
    console.log('__MATRIX_CHAT__' + JSON.stringify({
      kind: KIND,
      nickname: r.nickname || '',
      text: r.text,
      ts: Date.now()
    }))
    return true
  }
  // 评论区高频滚动时每个 mutation 都扫一遍 DOM 太贵：同一帧内只处理一次。
  function flush() {
    scheduled = false
    pending.forEach(function (el) {
      // 只在明确已脱离文档时跳过；不做真值判断，避免非元素节点被静默丢弃。
      if (el.isConnected !== false) emit(el)
    })
    pending.clear()
  }
  function enqueue(el) {
    pending.add(el)
    if (!scheduled) {
      scheduled = true
      ;(window.requestAnimationFrame || window.setTimeout)(flush, 16)
    }
  }
  function matchesAny(el) {
    if (!el || !el.matches) return false
    for (var i = 0; i < ITEMS.length; i++) {
      try {
        if (el.matches(ITEMS[i])) return true
      } catch (e) {}
    }
    return false
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return
    if (matchesAny(node)) enqueue(node)
    if (node.querySelectorAll) {
      for (var s = 0; s < ITEMS.length; s++) {
        var inner = node.querySelectorAll(ITEMS[s])
        for (var i = 0; i < inner.length; i++) enqueue(inner[i])
      }
    }
  }
  function collectInitial() {
    var all = []
    for (var s = 0; s < ITEMS.length; s++) {
      var nodes = document.querySelectorAll(ITEMS[s])
      for (var i = 0; i < nodes.length; i++) all.push(nodes[i])
    }
    // 只补最近 30 条，历史评论不重放。
    for (var k = Math.max(0, all.length - 30); k < all.length; k++) enqueue(all[k])
  }
  collectInitial()
  var mo = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) { scan(n) })
      var t = m.target && m.target.nodeType === 1 ? m.target : (m.target ? m.target.parentElement : null)
      if (t && t.closest) {
        for (var s = 0; s < ITEMS.length; s++) {
          var host = null
          try {
            host = t.closest(ITEMS[s])
          } catch (e) {}
          if (host) enqueue(host)
        }
      }
    })
  })
  mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  return 'installed'
})()
`
}

export const CHAT_OBSERVER_SCRIPT = buildObserverScript(LIVE_PROFILE)
export const VIDEO_OBSERVER_SCRIPT = buildObserverScript(VIDEO_PROFILE)

// 把文本写入当前页面的可见评论框，不触发发送。
// 先按评论框的 placeholder/aria 特征找，找不到再退回通用输入框；排除搜索框。
// 目标元素存在页面 JS 侧的不可枚举属性上，不往 DOM 写自定义属性——
// 写 data-matrix-* 等于在页面上留一个「已被注入」的标记。
//
// 直播间和视频页的评论框结构不同：直播间的在聊天区底部，视频页的在评论区顶部，
// 所以选择器列表要同时覆盖两套 data-e2e 与中文 placeholder 特征。
export function fillInputScript(text) {
  return String.raw`(() => {
    var text = ${JSON.stringify(String(text))}
    function visible(el) {
      if (!el || el.disabled || el.readOnly) return false
      var style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      return !!(el.offsetWidth || el.offsetHeight)
    }
    function labelOf(el) {
      return [
        el.getAttribute('placeholder'),
        el.getAttribute('aria-label'),
        el.getAttribute('data-placeholder')
      ].filter(Boolean).join(' ')
    }
    function isSearch(el) {
      return el.getAttribute('type') === 'search' ||
        /搜索|search/i.test(labelOf(el)) ||
        /搜索|search/i.test(el.id + ' ' + String(el.className || ''))
    }
    function editable(el) {
      return el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
    }
    function pick(selectorList) {
      for (var s = 0; s < selectorList.length; s++) {
        var nodes = document.querySelectorAll(selectorList[s])
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i]
          if (!visible(el) || !editable(el) || isSearch(el)) continue
          return el
        }
      }
      return null
    }
    // 顺序：平台专用属性 → placeholder/aria 中文特征 → 通用输入框。
    var el = pick([
      'textarea[data-e2e*="comment"]',
      'input[data-e2e*="comment"]',
      '[contenteditable="true"][data-e2e*="comment"]',
      '[data-e2e="comment-input"]',
      'textarea[placeholder*="说点"]',
      'textarea[placeholder*="评论"]',
      'textarea[placeholder*="回复"]',
      'input[placeholder*="说点"]',
      'input[placeholder*="评论"]',
      'input[placeholder*="回复"]',
      'input[placeholder*="留下"]',
      '[contenteditable="true"][data-placeholder*="说点"]',
      '[contenteditable="true"][data-placeholder*="评论"]',
      '[contenteditable="true"][data-placeholder*="回复"]',
      '[contenteditable="true"][aria-label*="评论"]',
      '[contenteditable="true"][aria-label*="说点"]',
      '[contenteditable="true"][aria-label*="回复"]',
      '[role="textbox"][aria-label*="评论"]',
      'textarea',
      '[contenteditable="true"]',
      'input[type="text"]'
    ])
    if (!el) return 'no-input'
    // 不可枚举属性：不出现在 DOM 里，也不进 for-in 枚举。
    Object.defineProperty(window, '__matrixInput', {
      value: el,
      configurable: true,
      enumerable: false,
      writable: true
    })
    el.focus()
    if (el.isContentEditable) {
      var selection = window.getSelection()
      var range = document.createRange()
      range.selectNodeContents(el)
      selection.removeAllRanges()
      selection.addRange(range)
      var inserted = false
      try {
        inserted = document.execCommand('insertText', false, text)
      } catch (e) {
        inserted = false
      }
      if (!inserted) {
        // 直接改 textContent 后必须补一个带 data 的 InputEvent，
        // 否则受控编辑器（React/Vue）的内部状态不会同步，点发送会发出空内容。
        el.textContent = text
        try {
          el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true, inputType: 'insertText', data: text
          }))
        } catch (e) {}
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertText', data: text
        }))
      }
      var end = document.createRange()
      end.selectNodeContents(el)
      end.collapse(false)
      selection.removeAllRanges()
      selection.addRange(end)
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return (el.textContent || '').trim() === text.trim() ? 'filled' : 'fill-mismatch'
    }
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    var desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc && desc.set) desc.set.call(el, text)
    else el.value = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value === text ? 'filled' : 'fill-mismatch'
  })()`
}

// 找到刚才填入的评论框旁边的“发送/发布”按钮并点击一次。
// 只负责点击，不循环、不批量；调用前由宿主弹确认。
// 页面框架同步输入状态有延迟，找不到按钮时在页面内重试约 1 秒。
export function sendCommentScript() {
  return String.raw`(async () => {
    var input = window.__matrixInput
    if (!input || !input.isConnected) return 'no-input'
    // 输入内容已被框架清空时不要点发送，否则会发出空评论。
    var content = input.isContentEditable ? (input.textContent || '') : (input.value || '')
    if (!content.trim()) return 'empty-input'
    function visible(el) {
      if (!el) return false
      var style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      return !!(el.offsetWidth || el.offsetHeight)
    }
    function enabled(el) {
      if (el.disabled === true) return false
      if (el.getAttribute('aria-disabled') === 'true') return false
      // 只认独立的 disabled class token，避免误伤 disabled:opacity-50 这类样式名。
      return !/(^|\s)disabled(\s|$)/i.test(String(el.className || ''))
    }
    function findBest() {
      var nodes = document.querySelectorAll(
        'button, [role="button"], [aria-label*="发送"], [title*="发送"], ' +
        '[class*="send"], [class*="Send"], [class*="publish"], ' +
        '[data-e2e*="send"], [data-e2e*="submit"], [data-e2e="comment-submit"]'
      )
      var ir = input.getBoundingClientRect()
      var best = null
      var bestScore = Infinity
      var disabledFound = false
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i]
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) continue
        if (!visible(el)) continue
        var text = (el.innerText || el.textContent || '').trim()
        var label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')
        var e2e = el.getAttribute('data-e2e') || ''
        var isSend = /send|submit/i.test(e2e)
          || /^(发送|发布|评论)$/.test(text)
          || (/发送/.test(text) && text.length <= 6)
          || /发送|发布/.test(label)
        if (!isSend) continue
        if (!enabled(el)) {
          disabledFound = true
          continue
        }
        var r = el.getBoundingClientRect()
        var score =
          Math.abs(r.top + r.height / 2 - (ir.top + ir.height / 2)) * 2 +
          Math.abs(r.left + r.width / 2 - (ir.left + ir.width / 2))
        if (score < bestScore) {
          bestScore = score
          best = el
        }
      }
      return { best: best, score: bestScore, disabled: disabledFound }
    }
    var disabledFound = false
    for (var attempt = 0; attempt < 8; attempt++) {
      var found = findBest()
      disabledFound = disabledFound || found.disabled
      // 距离阈值防止误点页面上离评论框很远的同名按钮。
      if (found.best && found.score < 900) {
        var target = found.best.closest
          ? (found.best.closest('button, [role="button"]') || found.best)
          : found.best
        target.click()
        return 'sent'
      }
      await new Promise(function (resolve) { setTimeout(resolve, 120) })
    }
    return disabledFound ? 'button-disabled' : 'no-button'
  })()`
}
