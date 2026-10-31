// 打包后把 portable 产物同步到项目根目录的「矩阵账号控制台-启动器.exe」。
// 那份 exe 是给用户双击用的，不跟着 release/ 一起更新就会一直是旧版本。
// 打包时 exe 可能正在运行导致文件被占用，这里读出哈希做比对再决定是否覆盖。
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const launcherName = '矩阵账号控制台-启动器.exe'
const source = join(root, 'release', `Matrix-Console-Portable-${pkg.version}.exe`)
const target = join(root, launcherName)

if (!existsSync(source)) {
  console.error(`[sync-launcher] 找不到打包产物：${source}`)
  process.exit(1)
}

function hashOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

const sourceHash = hashOf(source)
if (existsSync(target) && hashOf(target) === sourceHash) {
  console.log(`[sync-launcher] ${launcherName} 已是最新，跳过`)
  process.exit(0)
}

try {
  copyFileSync(source, target)
} catch (error) {
  // EBUSY/EPERM 基本都是 exe 还在运行。给出明确提示，不要让构建看起来成功。
  console.error(`[sync-launcher] 覆盖失败：${error.code || error.message}`)
  console.error('[sync-launcher] 请先退出正在运行的启动器再重试')
  process.exit(1)
}

const size = (statSync(target).size / 1024 / 1024).toFixed(0)
console.log(`[sync-launcher] 已更新 ${launcherName}（${size} MB，sha256 ${sourceHash.slice(0, 12)}）`)
