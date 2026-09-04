// 实时校对:把 whisper 转写片段修正为「通顺、带完整标点」的简体中文。
// 首选 Gemini 2.5 Flash-Lite(便宜、快);无 Gemini key 时降级 Claude Haiku;都没有则原样返回。

import Anthropic from '@anthropic-ai/sdk'
import { geminiKey, geminiText } from './gemini'

const GEMINI_MODEL = 'gemini-2.5-flash-lite'
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM =
  '你是中文语音实时转写的校对助手。用户给你一段语音转写文本(可能有同音/形近错别字、缺标点、断句混乱、口语重复、语气词)。' +
  '请把它修正为通顺、准确、带完整标点的简体中文:\n' +
  '① 纠正明显的同音/形近错别字;\n' +
  '② 补全标点符号(逗号、句号、问号、感叹号等),按语义正确断句成完整句子;\n' +
  '③ 删除无意义的口头语和语气词(如"嗯、啊、那个、就是说")与明显重复;\n' +
  '④ 消除明显歧义,但不改变原意、不臆造原文没有的信息;\n' +
  '⑤ 不要翻译、不要解释、不要加引号,只输出修正后的该片段文本;\n' +
  '⑥ 保持简体中文。'

function buildUser(context: string, text: string): string {
  return (context ? `【上文(仅供参考,不要输出)】\n${context}\n\n` : '') + `【待修正片段】\n${text}`
}

export class Polisher {
  private useGemini: boolean
  private claude: Anthropic | null

  constructor() {
    this.useGemini = !!geminiKey()
    this.claude =
      !this.useGemini && process.env.ANTHROPIC_API_KEY
        ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
        : null
  }

  get enabled(): boolean {
    return this.useGemini || this.claude !== null
  }

  async polish(text: string, context: string): Promise<string> {
    if (!text.trim()) return text

    if (this.useGemini) {
      try {
        const out = await geminiText(GEMINI_MODEL, SYSTEM, buildUser(context, text), {
          thinkingBudget: 0,
          timeoutMs: 12000
        })
        return out || text
      } catch (e) {
        console.warn('[polish/gemini] 失败,保留原文:', e instanceof Error ? e.message : e)
        return text
      }
    }

    if (this.claude) {
      try {
        const msg = await this.claude.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          system: SYSTEM,
          messages: [{ role: 'user', content: buildUser(context, text) }]
        })
        const block = msg.content.find((c) => c.type === 'text')
        const out = block && block.type === 'text' ? block.text.trim() : ''
        return out || text
      } catch (e) {
        console.warn('[polish/claude] 失败,保留原文:', e instanceof Error ? e.message : e)
        return text
      }
    }

    return text
  }
}
