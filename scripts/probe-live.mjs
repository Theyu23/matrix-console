import { app, BrowserWindow } from 'electron'
import { CHAT_OBSERVER_SCRIPT } from '../src/chatObserver.js'

const UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.webContents.setUserAgent(UA)

  let chats = 0
  win.webContents.on('console-message', (event, level, message) => {
    const msg = typeof message === 'string' ? message : event?.message
    if (!msg || !msg.startsWith('__MATRIX_CHAT__')) return
    chats++
    if (chats <= 8) console.log('CHAT', msg.slice(0, 300))
  })

  try {
    // 用法：ROOM_URL=https://live.douyin.com/<房间号> npx electron scripts/probe-live.mjs
    await win.loadURL(process.env.ROOM_URL || 'https://live.douyin.com/123456789012')
    await new Promise((r) => setTimeout(r, 12000))
    const diag = await win.webContents.executeJavaScript(`(() => ({
      title: document.title,
      exact: document.querySelectorAll('[class~="webcast-chatroom___item"]').length,
      fuzzy: document.querySelectorAll('[class*="webcast-chatroom___item"]').length,
      last: Array.prototype.slice.call(document.querySelectorAll('[class~="webcast-chatroom___item"]')).slice(-5).map(function (e) { return (e.innerText || '').slice(0, 80) })
    }))()`)
    console.log('DIAG', JSON.stringify(diag))
    const res = await win.webContents.executeJavaScript(CHAT_OBSERVER_SCRIPT)
    console.log('INJECT', res)
    await new Promise((r) => setTimeout(r, 15000))
    console.log('CHAT_COUNT', chats)
  } catch (e) {
    console.error('PROBE_FAIL', e.message)
  }
  app.quit()
})
