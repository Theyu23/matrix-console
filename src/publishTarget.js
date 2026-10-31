// 发布目标解析：单页发当前账号，监看墙发「选中的那一格」。
//
// 抽出来的理由：这里最容易出错的是「到底发给谁」。
// 发布是不可撤销的动作，选错账号就是发到了错的号下面，
// 所以规则要能单独测，而不是埋在组件的事件处理里。
import { commentKind, isPlatformUrl } from './platforms.js'

// 监看墙模式下墙上的格子可能被换掉（关页面、切平台、移除账号），
// 手里记着的 id 会失效。失效时退到第一个可见账号，而不是静默什么都不发。
export function resolveTarget({ accounts, activeId, wallTarget, gridMode }) {
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : []
  if (!gridMode) {
    const one = list.find((a) => a.id === activeId)
    return one ? one.id : ''
  }
  if (wallTarget && list.some((a) => a.id === wallTarget)) return wallTarget
  return list.length ? list[0].id : ''
}

// 页面类型的中文说法，用在发布目标下拉和二次确认里。
//
// commentKind 只认抖音的直播间和视频页；其它平台页它一律返回空。
// 但「空」不等于「发不出去」——视频号直播间同样有评论框，
// 只是观察器没覆盖。所以这里区分「平台页但类型未知」和「根本不是平台页」，
// 否则一个能发的页面会被标成「非评论页」，把人劝退。
export function pageKindLabel(account) {
  if (!account) return ''
  const url = account.currentUrl || account.url || ''
  const kind = commentKind(url)
  if (kind === 'live') return '直播'
  if (kind === 'video') return '视频'
  return isPlatformUrl(url, account.platform) ? '平台页' : '非评论页'
}

