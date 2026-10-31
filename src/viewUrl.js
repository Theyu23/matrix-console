// 读取 <webview> 当前的 URL。
//
// Electron 的 WebViewElement.getURL() 内部要先拿 webContentsId，而
// 「元素还没挂到 DOM、dom-ready 还没发出」的时候它会直接同步抛
// "The WebView must be attached to the DOM and the dom-ready event
//  emitted before this method can be called."——不是返回空串，是抛异常。
//
// did-start-loading 恰好可能落在这个窗口期里：webview 刚创建、开始加载，
// 但 attach 还没完成。所以事件处理里每一次读 URL 都要兜住，否则一条报错
// 会把整个事件回调打断，后面的状态更新和观察器注入全都不会执行。
//
// 读不到就退回调用方手里已知的地址（账号的 currentUrl），
// 这样状态标记仍然是准的，只是可能比真实地址旧一拍。
export function safeViewUrl(el, fallback = '') {
  try {
    const url = el && typeof el.getURL === 'function' ? el.getURL() : ''
    return url || fallback || ''
  } catch {
    return fallback || ''
  }
}
