import { app, BrowserWindow } from 'electron'

const UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.webContents.setUserAgent(UA)
  try {
    await win.loadURL('https://live.douyin.com/')
    await new Promise((r) => setTimeout(r, 7000))
    const links = await win.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('a[href*="live.douyin.com/"]'))
        .map((a) => a.href)
        .filter((h) => /live\\.douyin\\.com\\/\\d{5,}/.test(h))
    `)
    const room = links[0] || process.env.ROOM_URL || 'https://live.douyin.com/123456789012'
    console.log('ROOM', room)
    await win.loadURL(room)
    await new Promise((r) => setTimeout(r, 12000))
    const info = await win.webContents.executeJavaScript(`(() => {
      const tas = Array.from(document.querySelectorAll('textarea')).map(function (t) {
        return { cls: String(t.className).slice(0, 120), ph: t.placeholder || '', hidden: !(t.offsetWidth || t.offsetHeight) }
      })
      const ces = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(function (e) {
        return { cls: String(e.className).slice(0, 120), text: (e.innerText || '').slice(0, 30) }
      })
      const btns = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
        .filter(function (e) { return (e.innerText || '').trim() === '发送' })
        .slice(0, 5)
        .map(function (e) { return { tag: e.tagName, cls: String(e.className).slice(0, 120) } })
      return { title: document.title, tas: tas.slice(0, 8), ces: ces.slice(0, 8), btns: btns }
    })()`)
    console.log('INPUT_INFO', JSON.stringify(info, null, 2))
  } catch (e) {
    console.error('PROBE_FAIL', e.message)
  }
  app.quit()
})
