/** CLI failures may be JSON on either stderr or stdout. Never display its raw auth payload. */
export function feishuError(out: string, err: string, code: number | null): string {
  for (const raw of [out, err]) {
    try {
      const failure = JSON.parse(raw)?.error
      if (!failure) continue
      if (failure.subtype === 'missing_scope') {
        return '飞书授权范围不足，请补充授权后重试。' + (failure.missing_scopes?.includes('vc:meeting.search:read')
          ? '当前缺少“搜索会议记录”权限（vc:meeting.search:read）；日历读取正常也不代表能搜索妙记。'
          : '当前操作需要额外的飞书只读权限。')
      }
      if (failure.subtype === 'not_configured') return '飞书尚未配置或登录，请先连接飞书账号。'
      if (failure.type === 'authorization') return '飞书登录或授权失效，请重新授权后重试。'
      if (typeof failure.message === 'string') return failure.message
    } catch { /* try the other stream */ }
  }
  return err.trim() || `飞书工具执行失败（退出码 ${code}）`
}
