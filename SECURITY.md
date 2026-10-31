# 安全策略

## 报告漏洞

本项目处理代理凭据和账号会话，安全问题优先走私密渠道，不要开公开 issue。

请在 GitHub 的 Security 标签页用「Report a vulnerability」提交，或用仓库 owner 的公开联系方式。请附上复现步骤和影响范围，我会在一周内回复。

## 范围

以下视为安全问题：

- 代理凭据泄漏到页面、日志、错误信息或渲染进程可读的位置
- 账号分区隔离失效（一个账号能读到另一个账号的 Cookie / localStorage / 缓存）
- webview 逃逸：guest 页面拿到 Node 能力、preload、或能访问渲染层 IPC
- 画像注入可被页面检测出篡改（`toString` 露馅、实例上留下自有属性、原型描述符形态异常）
- 出口不生效却报成功（配置上「已隔离」但实际走本机直连）

以下**不**视为安全问题，属已知边界（见 README）：

- 同窗口内账号共享屏幕尺寸与 DPR
- 同机器共享 TLS / HTTP2 指纹
- 未处理的字体列表特征

## 已知设计前提

应用只接受 `persist:acct-<id>` 形式的账号分区，非此形态的 webview 挂载会被 `will-attach-webview` 直接拦掉。guest 页面不带 preload、`nodeIntegration` 关闭、`contextIsolation` 开启。HID / USB / 串口设备权限一律拒绝。

CSP 写在 `index.html` 里，`connect-src 'self'` 只允许渲染层访问自身。

账号清单导出**只含身份信息**，Cookie、分区数据、登录态一律不进文件。
