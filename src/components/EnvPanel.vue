<script setup>
import { computed, ref } from 'vue'
import { summarizeEnv } from '../envProbe.js'
import { describeSnapshot } from '../envSnapshot.js'

const props = defineProps({
  accounts: { type: Array, default: () => [] },
  probing: Boolean,
  result: { type: Object, default: null },
  snapshots: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['probe', 'close'])

const showOnlyShared = ref(false)
const showOnlyDrift = ref(false)
const report = computed(() => props.result || summarizeEnv([]))
const rows = computed(() => {
  if (!showOnlyShared.value) return report.value.fields
  return report.value.fields.filter((f) => f.same)
})

// 有环境漂移的账号：最近一次探测和上一次不一样。
// 这是诊断信号——真实账号的环境是稳定的，会变通常意味着别的问题。
const drifts = computed(() => report.value.drifts || [])

// 表格列：只列参与探测的账号，昵称太长会挤爆布局。
function shortName(name) {
  const s = String(name || '账号')
  return s.length > 8 ? s.slice(0, 8) + '…' : s
}

const FIELD_LABEL = {
  ua: 'UA',
  platform: 'navigator.platform',
  uaPlatform: 'UA-CH platform',
  cores: 'CPU 核心数',
  memory: '设备内存',
  language: '语言',
  timezone: '时区',
  screen: '屏幕',
  webglVendor: 'WebGL 厂商',
  webglRenderer: 'WebGL 渲染器'
}

function fieldLabel(key) {
  return FIELD_LABEL[key] || key
}

// 每个账号存了几条快照，给表格行做脚注用。
function snapshotNote(id) {
  return describeSnapshot(props.snapshots?.[id])
}
</script>

<template>
  <section class="panel">
    <header>
      <strong>账号环境自检</strong>
      <span class="sub">只读探测，不改任何值</span>
      <span class="spacer" />
      <label class="toggle">
        <input v-model="showOnlyShared" type="checkbox" />
        只看完全一致的
      </label>
      <button class="ghost" :disabled="probing" @click="$emit('probe')">
        {{ probing ? '探测中…' : '重新探测' }}
      </button>
      <button class="ghost" @click="$emit('close')">关闭</button>
    </header>

    <p v-if="!accounts.length" class="empty">当前平台还没有已打开的账号，先打开几个再来比对。</p>

    <template v-else>
      <p v-if="report.accountCount < 2 && !probing" class="empty">
        至少要有两个采集成功的账号才能比对一致性。
      </p>

      <div v-if="report.shared.length" class="summary">
        <p class="lead">
          以下 {{ report.shared.length }} 项在所有账号上完全相同——这些是账号之间的关联面，
          技术上可以直接看出它们属于同一台机器。
        </p>
        <ul>
          <li v-for="f in report.shared" :key="'s-' + f.key">
            <span class="name">{{ f.label }}</span>
            <code>{{ f.distinct[0] }}</code>
          </li>
        </ul>
      </div>

      <div v-if="drifts.length" class="drift">
        <p class="lead">
          以下账号这次的浏览器环境和上次探测时不一样。真实账号的环境是稳定的，
          这里出现变化通常意味着驱动、系统或浏览器更新过，值得对照掉线时间看一眼：
        </p>
        <ul>
          <li v-for="d in drifts" :key="'d-' + d.id">
            <span class="who-drift">{{ d.nickname || d.id }}</span>
            <span class="msg">{{ d.changed.map(fieldLabel).join('、') }}</span>
          </li>
        </ul>
      </div>

      <div v-if="report.warnings.length" class="warnings">
        <p class="lead">以下情况在同一账号内部就自相矛盾，与是否使用任何工具无关：</p>
        <ul>
          <li v-for="(w, i) in report.warnings" :key="'w-' + i">
            <span class="who">{{ w.nickname || w.id }}</span>
            <span class="msg">{{ w.message }}</span>
          </li>
        </ul>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="field">字段</th>
              <th v-for="a in accounts" :key="a.id">{{ shortName(a.nickname) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in rows" :key="f.key" :class="{ same: f.same }">
              <th class="field">
                {{ f.label }}
                <span v-if="f.same" class="badge">一致</span>
              </th>
              <td v-for="(v, i) in f.values" :key="i" :title="v">{{ v }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="note">
        这个面板不修改任何值。完全一致的字段越多，账号之间越容易被归到同一来源；
        具体要不要处理、怎么处理，由你判断。
      </p>
      <ul class="snap-shots">
        <li v-for="a in accounts" :key="'snap-' + a.id">
          <span class="who">{{ shortName(a.nickname) }}</span>
          <span class="msg">{{ snapshotNote(a.id) }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 420px;
  min-height: 0;
  background: #fff;
  border-left: 1px solid var(--line);
}
header {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.sub {
  color: #8a919f;
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #646a73;
  font-size: 12px;
  white-space: nowrap;
}
.ghost {
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.ghost:hover:not(:disabled) {
  background: #f8f9fa;
}
.ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.empty {
  padding: 24px 16px;
  color: #8a919f;
  font-size: 13px;
  text-align: center;
}
.summary,
.warnings,
.drift {
  flex: none;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.summary {
  background: #f6f8fb;
}
.warnings {
  background: #fff8f7;
}
.drift {
  background: #f0f7ff;
}
.who-drift {
  margin-right: 6px;
  color: #2f6feb;
  font-weight: 600;
}
.lead {
  margin: 0 0 6px;
  color: #1f2329;
  font-size: 12px;
  line-height: 1.6;
}
ul {
  margin: 0;
  padding-left: 16px;
}
li {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}
.name {
  color: #646a73;
  margin-right: 6px;
}
code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #eef1f5;
  font-size: 11px;
}
.who {
  margin-right: 6px;
  color: #d92d20;
  font-weight: 600;
}
.msg {
  color: #1f2329;
}
.table-wrap {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
td {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2329;
}
th.field {
  position: sticky;
  left: 0;
  z-index: 1;
  background: #fafbfc;
  color: #646a73;
  font-weight: 500;
  white-space: nowrap;
}
thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fafbfc;
  color: #646a73;
  font-weight: 500;
  white-space: nowrap;
}
tr.same td {
  background: #fffaf2;
}
.badge {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: #fff0d9;
  color: #b76e00;
  font-size: 10px;
  font-weight: 400;
}
.note {
  flex: none;
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  color: #8a919f;
  font-size: 11px;
  line-height: 1.6;
}
.snap-shots {
  flex: none;
  margin: 0;
  padding: 6px 12px 10px;
  border-top: 1px solid var(--line);
  background: #fafbfc;
}
.snap-shots .who {
  margin-right: 6px;
  color: #646a73;
  font-weight: 600;
}
.snap-shots .msg {
  color: #8a919f;
}
</style>
