// ─── Uma rodada da IA: lê a conversa, usa ferramentas e devolve a resposta ────
// O efeito de cada ferramenta vem de fora (onTool): no WhatsApp grava no CRM;
// no "Testar conversa" das Configurações é só simulado.

import Anthropic from '@anthropic-ai/sdk'
import type { SdrSettings } from './settings'
import { buildSystemPrompt, SDR_TOOLS, TERMINAL_TOOLS, type ChatTurn, type SdrToolName } from './prompt'

export type ToolCall = { name: SdrToolName; input: Record<string, unknown> }
export type TurnResult = {
  text: string
  calls: ToolCall[]
  terminal: SdrToolName | null
  usage: { input: number; output: number }
}

export type ModelClient = Pick<Anthropic['messages'], 'create'>

export async function runSdrTurn(opts: {
  client: ModelClient
  settings: SdrSettings
  companyName: string
  turns: ChatTurn[]
  repliesLeft: number
  contactName: string | null
  onTool: (call: ToolCall) => Promise<string>
  now?: Date
}): Promise<TurnResult> {
  const system = buildSystemPrompt(opts.settings, {
    companyName: opts.companyName, now: opts.now ?? new Date(), repliesLeft: opts.repliesLeft, contactName: opts.contactName,
  })
  const messages: Anthropic.MessageParam[] = opts.turns.map(t => ({ role: t.role, content: t.content }))
  const calls: ToolCall[] = []
  let terminal: SdrToolName | null = null
  const usage = { input: 0, output: 0 }
  let text = ''

  for (let i = 0; i < 4; i++) {
    const res = await opts.client.create({
      model: opts.settings.model,
      max_tokens: 700,
      system,
      tools: SDR_TOOLS as unknown as Anthropic.Tool[],
      messages,
    }) as Anthropic.Message
    usage.input += res.usage?.input_tokens ?? 0
    usage.output += res.usage?.output_tokens ?? 0
    const blockText = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim()
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !toolUses.length) { text = blockText; break }

    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      const name = tu.name as SdrToolName
      const input = (tu.input && typeof tu.input === 'object' ? tu.input : {}) as Record<string, unknown>
      let out: string
      if (terminal && TERMINAL_TOOLS.has(name)) out = 'Já encerrado nesta conversa.'
      else {
        calls.push({ name, input })
        try { out = await opts.onTool({ name, input }) } catch (e) { out = `Falhou: ${e instanceof Error ? e.message : 'erro'}` }
        if (TERMINAL_TOOLS.has(name)) terminal = name
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: out })
    }
    messages.push({ role: 'user', content: results })
    // Texto já escrito junto com a ferramenta vale como resposta se a próxima volta vier vazia
    if (blockText) text = blockText
  }
  return { text: cleanReply(text), calls, terminal, usage }
}

// Limpa o que não deve ir para o WhatsApp (marcações de raciocínio, espaços)
export function cleanReply(t: string): string {
  return t.replace(/<[^>]{1,40}>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500)
}
