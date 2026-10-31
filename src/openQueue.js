// 批量打开的并发闸门。
//
// 旧实现把选中账号的 url 一次性全部设上，20 个号就是 20 个重页面同时开载，
// 主进程和渲染进程一起被打满，登录页容易白屏、直播直接 OOM。
// 这里改成固定并发：满了就排队，前一条加载完（或超时）再放行下一条。
//
// 队列本身不碰 Vue，也不认识账号对象，只按 id 收发，方便单测。

export const OPEN_CONCURRENCY = 3
// 页面卡住不触发 did-finish-load 时不能永久占着名额，否则整条队列停死。
export const OPEN_SLOT_TIMEOUT = 30000

export function createOpenQueue({ limit = OPEN_CONCURRENCY, onDispatch } = {}) {
  const waiting = []
  const running = new Set()

  function pump() {
    while (running.size < limit && waiting.length) {
      const id = waiting.shift()
      running.add(id)
      try {
        onDispatch?.(id)
      } catch {
        // 派发失败也要让出名额，否则这一个 id 会把队列堵死。
        running.delete(id)
      }
    }
  }

  return {
    enqueue(ids) {
      for (const id of ids) {
        // 同一个账号可能被连点两次「打开」，已经在队里的不重复排。
        if (running.has(id) || waiting.includes(id)) continue
        waiting.push(id)
      }
      pump()
    },
    // 释放名额并立刻补下一条。不在运行中的 id 返回 false，用于忽略迟到的回调。
    done(id) {
      if (!running.delete(id)) return false
      pump()
      return true
    },
    isRunning(id) {
      return running.has(id)
    },
    has(id) {
      return running.has(id) || waiting.includes(id)
    },
    clear() {
      waiting.length = 0
    },
    get pending() {
      return waiting.length
    },
    get running() {
      return running.size
    },
    get total() {
      return waiting.length + running.size
    }
  }
}
