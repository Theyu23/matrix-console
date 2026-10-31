import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 回归检查：主进程的相对 import 必须都在 electron-builder 的 files 清单里。
//
// 这条测试来自一次真实崩溃：main.js 里 import 了 ../src/isolation.js，
// 但打包配置只收 dist/** 和 electron/**，asar 里没有那个文件，
// 装完启动就是 ERR_MODULE_NOT_FOUND 弹窗。本地 npx electron 完全正常，
// 因为项目目录里文件都在——所以这个问题只能静态查，跑不起来才发现的都是用户。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseFilesList(yaml) {
  // 只取 files: 下的一级列表项，够用且不必引入 yaml 解析依赖。
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^files:\s*$/.test(l))
  if (start < 0) return []
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\S/.test(line)) break // 回到顶格键，列表结束
    const m = /^\s*-\s*(.+)$/.exec(line)
    if (m) out.push(m[1].trim())
  }
  return out
}

// 简化版 glob 匹配：支持 ** 与 *，足够覆盖打包清单里的写法。
function matchesGlob(file, pattern) {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000SLASH\u0000')
    .replace(/\*\*/g, '\u0000ALL\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000SLASH\u0000/g, '(?:.*/)?')
    .replace(/\u0000ALL\u0000/g, '.*')
  return new RegExp('^' + re + '$').test(file)
}

function isCovered(file, files) {
  return files.some((p) => matchesGlob(file, p) || file === p || file.startsWith(p.replace(/\/\*\*.*$/, '/')))
}

test('electron-builder 的 files 清单覆盖主进程的所有相对 import', () => {
  const yaml = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  const files = parseFilesList(yaml)
  assert.ok(files.length > 0, '没有解析到 files 清单')

  const electronDir = path.join(root, 'electron')
  const problems = []
  for (const name of readdirSync(electronDir)) {
    if (!/\.(js|cjs|mjs)$/.test(name)) continue
    const src = readFileSync(path.join(electronDir, name), 'utf8')
    const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
    let m
    while ((m = re.exec(src))) {
      const target = m[1]
      const abs = path.resolve(electronDir, target)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (!isCovered(rel, files)) problems.push(`electron/${name} → ${rel}`)
    }
  }
  assert.deepEqual(problems, [], `以下主进程依赖不会被打进安装包：\n${problems.join('\n')}`)
})

test('files 清单确实包含 src/isolation.js', () => {
  // 这条是上面那个崩溃的具体回归点。
  const yaml = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  const files = parseFilesList(yaml)
  assert.ok(isCovered('src/isolation.js', files), 'src/isolation.js 必须打进产物')
})

test('glob 匹配器本身可靠', () => {
  // 匹配器写错会让上面的检查恒真，等于没检查。
  assert.equal(matchesGlob('src/isolation.js', 'electron/**/*'), false)
  assert.equal(matchesGlob('electron/main.js', 'electron/**/*'), true)
  assert.equal(matchesGlob('electron/deep/x.js', 'electron/**/*'), true)
  assert.equal(matchesGlob('dist/index.html', 'dist/**/*'), true)
  assert.equal(matchesGlob('src/isolation.js', 'src/isolation.js'), true)
  assert.equal(isCovered('src/isolation.js', ['src/isolation.js']), true)
  assert.equal(isCovered('src/other.js', ['src/isolation.js']), false)
})
