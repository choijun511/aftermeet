import React, { useState } from 'react'
import log from '../../../../docs/MAINTENANCE_LOG.md?raw'
import { renderMarkdown } from '../md'
const entries = log.split('\n## ').slice(1).map(section => {
  const newline = section.indexOf('\n')
  return { title: section.slice(0, newline), body: section.slice(newline + 1) }
})
export default function MaintenanceView({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const matches = entries.filter(e => `${e.title}\n${e.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <div className="content maintenance-page">
    <button className="btn soft" onClick={onBack} style={{ marginBottom: 16 }}>返回设置</button>
    <h1 className="page-h">维护日志</h1>
    <p className="page-sub">每次改动的原因、内容与验证结果。随应用更新，与 GitHub 共用一份记录。</p>
    <label htmlFor="maintenance-search">搜索维护记录</label>
    <input id="maintenance-search" type="search" className="txt-input" placeholder="例如：日历、录音、权限" value={query} onChange={e => setQuery(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 8, marginBottom: 12 }} />
    <p className="muted" role="status">共 {matches.length} 条记录 · 日期以提交与验证记录为准</p>
    {matches.length === 0 && <p className="card" style={{ padding: 24 }}>没有匹配的记录，请换个关键词。</p>}
    {matches.map(entry => <article key={entry.title} className="card maintenance-entry">
      <h2>{entry.title}</h2>
      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }} />
    </article>)}
  </div>
}
