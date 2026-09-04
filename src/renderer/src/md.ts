import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

// 把 Markdown 渲染为 HTML。先转义 '<' 中和任何原始 HTML 标签(防注入),
// 但保留 '>' 以便 markdown 的引用语法仍可用。内容来自我们自己的 LLM,风险已很低,这是额外保险。
export function renderMarkdown(src: string): string {
  if (!src) return ''
  const safe = src.replace(/</g, '&lt;')
  return marked.parse(safe) as string
}
