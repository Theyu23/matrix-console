# 贡献

## 本地开发

```bash
npm install
npm run build     # 渲染层构建到 dist/
npm test          # 跑测试
npm run app       # 启动
```

开发时 `npm run dev` 起 vite 的 watch 构建，另开一个终端跑 `npm run app`。

## 改动后的验证

渲染层改完**必须** `npm run build` 才生效——应用加载的是 `dist/index.html`，不是源码。只在源码上验证会测到旧包，新加的 DOM 选择器查不到，很容易误判成「功能没实现」。

提交前跑一遍 `npm test` 和 `npm run build`。涉及主进程 import 新模块时，记得同步 `electron-builder.yml` 的 `files` 清单，否则打包后启动会 `MODULE_NOT_FOUND`（`tests/packaging.test.js` 会拦这个）。

改动 `src/isolation.js` 的画像档位时注意：preset key 是兼容性承诺，**只增不改名**。存量画像里存着 key，改了就认不出来，老账号的指纹会整体漂移一次。

## 几处刻意的设计取舍

**不做 canvas / WebGL / 音频噪声。** 这类噪声每次刷新都变，本身就可被聚类，而且和真实硬件的稳定特征对不上，比不加更糟。画像只覆盖「平台 + UA + 语言 + 时区 + WebGL 厂商/渲染器」这一组——这些是能自洽改掉的。

**画像按账号 id 播种，不随机。** 同一个账号每次算出来一致，即使 localStorage 丢了或换机器打开也不变。可复现比「更散」重要。

**代理凭据不进 `proxyRules`。** Chromium 只认 `scheme://host:port`，内嵌的 `user:pass` 会被丢掉，带认证的代理直接 407。凭据必须走 `app.on('login')`。同理，凭据取回时要 `decodeURIComponent`，否则密码含 `@ : /` 时认证必失败。

**webview 注入挂在 `web-contents-created` 的 guest 分支上。** Electron 45 下宿主 webContents 的 `did-attach` 实测不触发，挂那里等于整段不执行。

**注册注入脚本后要主动 reload 一次。** guest 创建时 `getURL()` 是空串，但 `<webview>` 的 `src` 立刻开始导航；`attach` + `Page.enable` + `addScriptToEvaluateOnNewDocument` 走完时首屏已加载，脚本只对下一次导航生效。

**读 webview 的 URL 一律走 `safeViewUrl`。** `did-start-loading` 可能早于 `dom-ready`，此时 `getURL()` 会同步抛错并打断整个回调。

**下发画像前 `JSON.parse(JSON.stringify(...))`。** `profiles` 是 `reactive()` 的 Proxy，直接交给 `ipcRenderer.invoke` 会在结构化克隆时抛 `An object could not be cloned.`，而且是静默失败。

## 提交

普通 PR 即可。修 bug 请在描述里写清复现步骤和根因，方便补回归测试。
