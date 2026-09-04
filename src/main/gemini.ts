// Gemini REST 封装(用全局 fetch,无需 SDK)。提供文本生成与结构化 JSON 生成。
// 只发送「文字」到 Google —— 音频始终留在本地。

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY
}

interface GenOpts {
  timeoutMs?: number
  /** 2.5 系列默认开启「思考」,润色这类低延迟任务传 0 关掉更快更省 */
  thinkingBudget?: number
}

async function call(model: string, body: Record<string, unknown>, opts: GenOpts = {}): Promise<unknown> {
  const key = geminiKey()
  if (!key) throw new Error('未配置 GEMINI_API_KEY')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000)
  try {
    const res = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    const data = (await res.json()) as { error?: { message?: string } }
    if (!res.ok) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`)
    return data
  } finally {
    clearTimeout(timer)
  }
}

function extractText(data: unknown): string {
  const parts = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]
    ?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((p) => p?.text || '')
    .join('')
    .trim()
}

function genConfig(opts: GenOpts, extra?: Record<string, unknown>): Record<string, unknown> {
  const cfg: Record<string, unknown> = { temperature: 0.2, ...extra }
  if (opts.thinkingBudget !== undefined) {
    cfg.thinkingConfig = { thinkingBudget: opts.thinkingBudget }
  }
  return cfg
}

export async function geminiText(
  model: string,
  system: string,
  user: string,
  opts: GenOpts = {}
): Promise<string> {
  const data = await call(
    model,
    {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: genConfig(opts)
    },
    opts
  )
  return extractText(data)
}

export async function geminiJson<T>(
  model: string,
  system: string,
  user: string,
  schema: object,
  opts: GenOpts = {}
): Promise<T> {
  const data = await call(
    model,
    {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: genConfig(opts, {
        responseMimeType: 'application/json',
        responseSchema: schema
      })
    },
    opts
  )
  const text = extractText(data)
  if (!text) throw new Error('Gemini 返回空结果')
  return JSON.parse(text) as T
}
