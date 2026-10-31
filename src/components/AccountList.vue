<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  accounts: Array,
  selected: Set,
  activeId: String,
  search: String,
  health: Object,
  // 实测出口：accountId → 判定结果。
  // 只有测过的账号才有条目，没测过的仍按配置显示。
  egressVerdicts: { type: Object, default: () => ({}) }
})
const emit = defineEmits([
  'toggle',
  'select',
  'rename',
  'search',
  'add-many',
  'toggle-tier',
  'set-proxy'
])
const bulkCount = ref(5)

function submitBulk() {
  const count = Math.floor(Number(bulkCount.value))
  if (!Number.isFinite(count) || count < 1 || count > 50) {
    window.alert('请输入 1 到 50 之间的数字。')
    return
  }
  emit('add-many', count)
}

const STATUS_TEXT = {
  idle: '未打开',
  loading: '加载中',
  qr: '待扫码',
  online: '已登录',
  watching: '直播中',
  ready: '页面就绪',
  offline: '离线'
}

// 出口标签。配了代理只说明「填了」，测过才算「真的分了」。
// 实测优先：测过就用实测结论，没测过才退回配置状态。
// proxy-dead 必须显式说出「代理没生效」——这是配置看着正常、实际没隔离的那种情况。
const EGRESS_TEXT = {
  ok: '独立出口',
  direct: '本机直连',
  'proxy-dead': '代理未生效',
  failed: '出口未知',
  unprobed: ''
}

// 一条 computed 出全部账号的标签，避免模板里对每个账号反复 new 对象。
const egressMap = computed(() => {
  const out = {}
  for (const a of props.accounts || []) {
    if (!a) continue
    const v = props.egressVerdicts && props.egressVerdicts[a.id]
    let text = v ? EGRESS_TEXT[v.state] || '' : ''
    let tone = v ? v.state : 'config'
    if (!text) {
      // 没测过（或测了但没结论）：沿用配置状态，
      // 文案照旧但 tone 是 config，表示「这是配置，不是实测」。
      text = a.proxy ? '独立出口' : '共用出口'
      tone = 'config'
    }
    out[a.id] = { text, tone, ip: (v && v.ip) || '', hasProxy: Boolean(a.proxy) }
  }
  return out
})

function egressFor(a) {
  return egressMap.value[a.id] || { text: '', tone: 'config', ip: '' }
}

function egressTitleFor(a) {
  const v = props.egressVerdicts && props.egressVerdicts[a.id]
  if (!v) {
    return a.proxy
      ? `出口代理：${a.proxy}\n（配置，未实测）\n点击修改`
      : '未配独立出口，与其它账号共用本机 IP。点击设置'
  }
  const lines = [v.ip ? `实测出口 IP：${v.ip}` : '实测未能取到出口 IP']
  if (v.state === 'proxy-dead') lines.push('配了代理，但对方看到的仍是本机 IP——代理没有生效')
  else if (v.state === 'ok') lines.push('代理已生效，出口与本机不同')
  else if (v.state === 'direct') lines.push('未配代理，走本机直连')
  else if (v.state === 'failed') lines.push('探测失败：网络不通或代理不可用')
  lines.push('点击修改代理')
  return lines.join('\n')
}

function statusText(s) {
  return STATUS_TEXT[s] || s
}

// 巡检结果只补一个额外提示，不覆盖原状态文字：
// 会话过期比「页面就绪」更值得知道，所以在后面挂一个明显的红色标记。
function healthFlag(a) {
  const h = props.health?.[a.id]
  if (!h) return null
  if (h.state === 'expired') return { text: '登录失效', cls: 'bad' }
  if (h.state === 'unknown') return { text: '待确认', cls: 'warn' }
  return null
}

function avatarStyle(a) {
  let h = 0
  const name = String(a.nickname || '?')
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return { background: `hsl(${h} 65% 55%)` }
}
</script>

<template>
  <aside class="list">
    <div class="list-head">
      <input
        class="search"
        :value="search"
        placeholder="搜索昵称"
        @input="$emit('search', $event.target.value)"
      />
      <input
        v-model.number="bulkCount"
        class="bulk-count"
        type="number"
        min="1"
        max="50"
        title="批量添加数量"
      />
      <button class="add-many" title="按左侧数量批量添加账号" @click="submitBulk">添加</button>
    </div>
    <p v-if="!accounts.length" class="empty">
      {{ search ? '没有匹配的账号' : '暂无账号，点上方“添加账号”' }}
    </p>
    <div
      v-for="a in accounts"
      :key="a.id"
      class="row"
      :class="{ active: a.id === activeId }"
      @click="$emit('select', a.id)"
    >
      <input type="checkbox" :checked="selected.has(a.id)" @click.stop="$emit('toggle', a.id)" />
      <span class="avatar" :style="avatarStyle(a)">{{ (a.nickname || '?').slice(0, 1) }}</span>
      <!-- 两行：320px 侧栏里五项横排会把昵称挤到只剩一个字，拆开后昵称拿回完整宽度。 -->
      <div class="body">
        <div class="line-main">
          <input
            class="nickname"
            :value="a.nickname"
            @input="$emit('rename', { id: a.id, value: $event.target.value })"
            @click.stop
          />
          <span v-if="healthFlag(a)" class="flag" :class="healthFlag(a).cls">
            {{ healthFlag(a).text }}
          </span>
          <span class="status" :class="a.status">{{ statusText(a.status) }}</span>
        </div>
        <div class="line-tags">
          <button
            class="tier"
            :class="a.tier === 'main' ? 'main' : 'spare'"
            :title="a.tier === 'main' ? '主力账号：优先上墙、巡检更勤、批量操作默认跳过。点击改为备用' : '备用账号：点击改为主力'"
            @click.stop="$emit('toggle-tier', a.id)"
          >
            {{ a.tier === 'main' ? '主力' : '备用' }}
          </button>
          <button
            class="egress"
            :class="[egressFor(a).tone === 'ok' ? 'on' : '', egressFor(a).tone === 'proxy-dead' ? 'dead' : '']"
            :title="egressTitleFor(a)"
            @click.stop="$emit('set-proxy', a.id)"
          >
            {{ egressFor(a).text }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.list {
  padding: 8px;
}
.list-head {
  display: flex;
  gap: 6px;
  padding: 2px 2px 8px;
}
.search {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  outline: none;
  font: inherit;
}
.search:focus {
  border-color: #c9cdd4;
}
.bulk-count {
  flex: none;
  width: 48px;
  padding: 6px 4px;
  border: 1px solid var(--line);
  border-radius: 6px;
  outline: none;
  font: inherit;
  text-align: center;
}
.add-many {
  flex: none;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  white-space: nowrap;
}
.add-many:hover {
  border-color: #c9cdd4;
  background: #f8f9fa;
}
.empty {
  padding: 24px 16px;
  color: #8a919f;
  text-align: center;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
/* 昵称与标签分两行。原来五个元素横排，昵称是唯一的 flex:1，
   侧栏一窄就只剩一个字宽；拆行后昵称独占第一行的剩余宽度。 */
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.line-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.line-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.row:hover {
  background: #f5f6f7;
}
.row.active {
  background: #fff1f3;
  box-shadow: inset 0 0 0 1px #ffd0d8;
}
/* 主力/备用切换。做成按钮而不是下拉：两档而已，点一下就切最快。 */
.tier {
  flex: none;
  padding: 2px 7px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.tier.spare {
  border-color: #e5e6eb;
  background: #f7f8fa;
  color: #8a919f;
}
.tier.spare:hover {
  border-color: #c9cdd4;
  color: #646a73;
}
.tier.main {
  border-color: #ffd0d8;
  background: #fff1f3;
  color: #d92d20;
  font-weight: 600;
}
.tier.main:hover {
  border-color: #ffb3c0;
}
/* 出口标识。共用出口用灰色提示，独立出口给一点存在感但不抢眼。 */
.egress {
  flex: none;
  padding: 2px 7px;
  border: 1px solid #e5e6eb;
  border-radius: 999px;
  background: #f7f8fa;
  color: #8a919f;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.egress:hover {
  border-color: #c9cdd4;
  color: #646a73;
}
.egress.on {
  border-color: #c9e2ff;
  background: #eef4ff;
  color: #2f6feb;
}
.egress.on:hover {
  border-color: #a8c9ff;
}
/* 代理没生效：配置看着正常、实际走本机。这个必须比「共用出口」更醒目，
   因为它是错的——用户以为自己隔离好了。 */
.egress.dead {
  border-color: #ffd0d8;
  background: #fff1f3;
  color: #d92d20;
  font-weight: 600;
}
.egress.dead:hover {
  border-color: #ffb3c0;
}
.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #fff;
  font-weight: 600;
}
.nickname {
  flex: 1;
  min-width: 0;
  padding: 4px 2px;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  /* 昵称过长时省略而不是把状态标签挤出去。 */
  text-overflow: ellipsis;
}
.flag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
}
.flag.bad {
  background: #fdecea;
  color: #d92d20;
  font-weight: 600;
}
.flag.warn {
  background: #fff4e5;
  color: #b76e00;
}
.status {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f2f3f5;
  color: #646a73;
  font-size: 12px;
}
.status.online {
  background: #e8f7ee;
  color: #12805c;
}
.status.loading,
.status.qr {
  background: #fff4e5;
  color: #b76e00;
}
.status.watching {
  background: #eef4ff;
  color: #2f6feb;
}
.status.ready {
  background: #f2f3f5;
  color: #646a73;
}
.status.offline {
  background: #fdecea;
  color: #d92d20;
}
</style>
