const { contextBridge, ipcRenderer } = require('electron')

// 只暴露账号分区的清理与环境配置能力，不暴露 Node / ipcRenderer 本身。
contextBridge.exposeInMainWorld('matrix', {
  clearSession: (partition) => ipcRenderer.invoke('matrix:clear-session', partition),
  clearCache: (partition) => ipcRenderer.invoke('matrix:clear-cache', partition),
  // 把某个账号的画像和代理交给主进程，按分区落地。
  setAccountEnv: (payload) => ipcRenderer.invoke('matrix:set-account-env', payload),
  // 实测出口：从各账号自己的分区发请求，问对方看到的公网 IP。
  probeEgress: (partitions) => ipcRenderer.invoke('matrix:probe-egress', partitions)
})
