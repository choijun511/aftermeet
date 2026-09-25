import { cloudFetch } from './cloud-http'

export type AnalysisMode = 'standard' | 'deep'
export function openaiAvailable(): boolean { return !!process.env.OPENAI_API_KEY?.trim() }
export function openaiModel(mode: AnalysisMode = 'standard'): string {
  return mode === 'deep'
    ? process.env.OPENAI_MODEL_DEEP || 'gpt-5.6-sol'
    : process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.6-luna'
}

// Responses strict schemas require every property; unspecified strings use an empty value.
export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema }
  if (schema.type === 'object') {
    const props = schema.properties as Record<string, Record<string, unknown>>
    result.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strictSchema(v)]))
    result.required = Object.keys(props)
    result.additionalProperties = false
  }
  if (schema.items) result.items = strictSchema(schema.items as Record<string, unknown>)
  return result
}

export async function openaiText(system: string, input: string, opts: {
  signal?: AbortSignal; mode?: AnalysisMode; schema?: Record<string, unknown>; timeoutMs?: number; maxOutput?: number
} = {}): Promise<string> {
  if (!openaiAvailable()) throw new Error('未配置 OPENAI_API_KEY')
  const model = openaiModel(opts.mode)
  const body = {
    model, instructions: system, input, store: false,
    reasoning: { effort: opts.mode === 'deep' ? 'medium' : 'none' },
    max_output_tokens: opts.maxOutput || (opts.mode === 'deep' ? 16000 : 8000),
    ...(opts.schema ? { text: { format: { type: 'json_schema', name: 'meeting_result', strict: true, schema: strictSchema(opts.schema) } } } : {})
  }
  const res = await cloudFetch('https://api.openai.com/v1/responses', {
    signal: opts.signal, method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, opts.timeoutMs || 180000)
  const data = await res.json() as {
    status?: string; error?: { message?: string }; incomplete_details?: { reason?: string };
    output?: { content?: { type: string; text?: string; refusal?: string }[] }[]
  }
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || '请求失败'}`)
  if (data.status !== 'completed') throw new Error(`OpenAI 输出未完成：${data.incomplete_details?.reason || data.status}`)
  const content = (data.output || []).flatMap((o) => o.content || [])
  if (content.some((c) => c.type === 'refusal')) throw new Error('模型拒绝处理此内容，原转写已保留')
  const text = content.filter((c) => c.type === 'output_text').map((c) => c.text || '').join('').trim()
  if (!text) throw new Error('OpenAI 返回空结果')
  console.log(`[openai] ${model} completed`)
  return text
}

export async function openaiJson<T>(system: string, input: string, schema: Record<string, unknown>, mode: AnalysisMode = 'standard', signal?: AbortSignal): Promise<T> {
  return JSON.parse(await openaiText(system, input, { schema, mode, signal })) as T
}
