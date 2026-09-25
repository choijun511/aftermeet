import { net } from 'electron'

// Electron's network stack uses macOS certificate/proxy settings.
export async function cloudFetch(url: string, init: RequestInit = {}, timeoutMs = 60000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await net.fetch(url, { ...init, signal: ctrl.signal, redirect: 'error' })
    // Read the body inside the deadline, not just the response headers.
    const body = await response.arrayBuffer()
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error('云端请求超时，请检查网络后重试')
    throw e
  } finally { clearTimeout(timer) }
}

export function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  for (const key of ['OPENAI_API_KEY', 'DASHSCOPE_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY']) {
    const value = process.env[key]
    if (value) message = message.split(value).join('[已隐藏]')
  }
  return message.replace(/https?:\/\/\S+/g, '[服务地址]').slice(0, 500)
}
