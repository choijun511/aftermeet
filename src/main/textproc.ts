// 文本后处理:繁体 → 简体(OpenCC,本地、瞬时)。
// Whisper 中文常输出繁体,这里统一兜底转简体,无论 LLM 润色是否启用都生效。

import * as OpenCC from 'opencc-js'

let convert: ((s: string) => string) | null = null

function ensure(): (s: string) => string {
  if (!convert) {
    // from 't'(通用繁体)→ 'cn'(大陆简体)
    convert = OpenCC.Converter({ from: 't', to: 'cn' })
  }
  return convert
}

export function toSimplified(text: string): string {
  if (!text) return text
  try {
    return ensure()(text)
  } catch {
    return text
  }
}
