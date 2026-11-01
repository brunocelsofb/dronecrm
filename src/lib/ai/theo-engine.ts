// ─── Théo: conversa com a IA escolhida pela empresa (Anthropic, OpenAI ou Gemini) ─
// Mesma lógica para as três: a IA lê a conversa, chama consultas (executadas aqui na hora)
// e, quando quer fazer uma AÇÃO, a rodada para e devolve a ação para a pessoa confirmar.
// O histórico guardado entre rodadas é só texto (pergunta / resposta), igual para as três IAs.

import { normalizeHistory, toGeminiSchema, type TheoProvider, type TheoTool, type TheoTurn } from '@/lib/ai/theo-catalog'
export type { TheoTurn }

export type TheoPending = { name: string; input: Record<string, unknown> }
export type EngineResult = { text: string; pending: TheoPending | null; tokensIn: number; tokensOut: number; error?: string }

type RunOpts = {
  provider: TheoProvider; model: string; key: string; system: string
  history: TheoTurn[]; tools: TheoTool[]
  read: (name: string, input: Record<string, unknown>) => Promise<string>
  maxSteps?: number
}

const MAX_OUT = 2048
const clip = (s: string) => (s.length > 12_000 ? `${s.slice(0, 12_000)}… (cortado)` : s)

export function friendlyAiError(provider: TheoProvider, status: number, body: string): string {
  let msg = ''
  try { const j = JSON.parse(body); msg = j?.error?.message ?? j?.message ?? '' } catch { /* texto */ }
  const who = provider === 'anthropic' ? 'da Anthropic' : provider === 'openai' ? 'da OpenAI' : 'do Google'
  if (status === 401 || status === 403) return `A chave ${who} foi recusada. Confira se está ativa e com cobrança liberada (Configurações → Théo).`
  if (status === 429) return `Limite de uso ou de crédito da conta ${who} atingido. Confira o saldo na conta de IA da empresa.`
  if (status === 404) return `O modelo escolhido não está disponível na conta ${who}. Troque o modelo em Configurações → Théo.`
  return `A IA respondeu com erro (${status})${msg ? `: ${String(msg).slice(0, 200)}` : '.'}`
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 55_000)
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal })
    return { ok: r.ok, status: r.status, text: await r.text() }
  } finally { clearTimeout(t) }
}

export async function runTheo(o: RunOpts): Promise<EngineResult> {
  const history = normalizeHistory(o.history)
  if (!history.length) return { text: '', pending: null, tokensIn: 0, tokensOut: 0, error: 'Escreva uma pergunta.' }
  const isAction = new Set(o.tools.filter(t => t.kind === 'acao').map(t => t.name))
  const known = new Set(o.tools.map(t => t.name))
  const steps = o.maxSteps ?? 6
  try {
    if (o.provider === 'anthropic') return await runAnthropic(o, history, isAction, known, steps)
    if (o.provider === 'openai') return await runOpenAI(o, history, isAction, known, steps)
    return await runGemini(o, history, isAction, known, steps)
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return { text: '', pending: null, tokensIn: 0, tokensOut: 0, error: aborted ? 'A IA demorou demais para responder. Tente de novo.' : 'Falha ao falar com a IA. Tente de novo.' }
  }
}

type Call = { id: string; name: string; input: Record<string, unknown> }
const parseArgs = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object') return v as Record<string, unknown>
  try { const j = JSON.parse(String(v ?? '{}')); return j && typeof j === 'object' ? j : {} } catch { return {} }
}

// Executa as consultas de uma rodada; se a IA pediu uma ação, para e devolve para confirmar
async function handleCalls(calls: Call[], o: RunOpts, isAction: Set<string>, known: Set<string>): Promise<{ pending: TheoPending | null; results: { id: string; name: string; output: string }[] }> {
  const action = calls.find(c => isAction.has(c.name))
  if (action) return { pending: { name: action.name, input: action.input }, results: [] }
  const results = []
  for (const c of calls) {
    const output = known.has(c.name) ? clip(await o.read(c.name, c.input)) : 'Ferramenta não disponível para esta empresa.'
    results.push({ id: c.id, name: c.name, output })
  }
  return { pending: null, results }
}

// ─── Anthropic (Messages API) ────────────────────────────────────────────────
async function runAnthropic(o: RunOpts, history: TheoTurn[], isAction: Set<string>, known: Set<string>, steps: number): Promise<EngineResult> {
  const messages: { role: string; content: unknown }[] = history.map(t => ({ role: t.role, content: t.text }))
  const tools = o.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.params }))
  let tIn = 0, tOut = 0, lastText = ''
  for (let i = 0; i < steps; i++) {
    const r = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': o.key, 'anthropic-version': '2023-06-01' },
      { model: o.model, max_tokens: MAX_OUT, system: o.system, tools, messages })
    if (!r.ok) return { text: '', pending: null, tokensIn: tIn, tokensOut: tOut, error: friendlyAiError('anthropic', r.status, r.text) }
    const j = JSON.parse(r.text)
    tIn += Number(j?.usage?.input_tokens ?? 0); tOut += Number(j?.usage?.output_tokens ?? 0)
    const content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] = j?.content ?? []
    lastText = content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
    const calls: Call[] = content.filter(b => b.type === 'tool_use').map(b => ({ id: String(b.id), name: String(b.name), input: parseArgs(b.input) }))
    if (!calls.length) return { text: lastText, pending: null, tokensIn: tIn, tokensOut: tOut }
    const h = await handleCalls(calls, o, isAction, known)
    if (h.pending) return { text: lastText, pending: h.pending, tokensIn: tIn, tokensOut: tOut }
    messages.push({ role: 'assistant', content })
    messages.push({ role: 'user', content: h.results.map(x => ({ type: 'tool_result', tool_use_id: x.id, content: x.output })) })
  }
  return { text: lastText || 'Não consegui concluir em poucas etapas. Tente uma pergunta mais específica.', pending: null, tokensIn: tIn, tokensOut: tOut }
}

// ─── OpenAI (Responses API) ──────────────────────────────────────────────────
async function runOpenAI(o: RunOpts, history: TheoTurn[], isAction: Set<string>, known: Set<string>, steps: number): Promise<EngineResult> {
  const input: unknown[] = history.map(t => ({ role: t.role, content: t.text }))
  const tools = o.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.params }))
  let tIn = 0, tOut = 0, lastText = ''
  for (let i = 0; i < steps; i++) {
    const r = await post('https://api.openai.com/v1/responses', { Authorization: `Bearer ${o.key}` },
      { model: o.model, instructions: o.system, input, tools, max_output_tokens: MAX_OUT })
    if (!r.ok) return { text: '', pending: null, tokensIn: tIn, tokensOut: tOut, error: friendlyAiError('openai', r.status, r.text) }
    const j = JSON.parse(r.text)
    tIn += Number(j?.usage?.input_tokens ?? 0); tOut += Number(j?.usage?.output_tokens ?? 0)
    const output: { type: string; call_id?: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[] = j?.output ?? []
    lastText = output.filter(x => x.type === 'message').flatMap(x => x.content ?? []).filter(c => c.type === 'output_text').map(c => c.text ?? '').join('\n').trim()
    const calls: Call[] = output.filter(x => x.type === 'function_call').map(x => ({ id: String(x.call_id), name: String(x.name), input: parseArgs(x.arguments) }))
    if (!calls.length) return { text: lastText, pending: null, tokensIn: tIn, tokensOut: tOut }
    const h = await handleCalls(calls, o, isAction, known)
    if (h.pending) return { text: lastText, pending: h.pending, tokensIn: tIn, tokensOut: tOut }
    input.push(...output)
    for (const x of h.results) input.push({ type: 'function_call_output', call_id: x.id, output: x.output })
  }
  return { text: lastText || 'Não consegui concluir em poucas etapas. Tente uma pergunta mais específica.', pending: null, tokensIn: tIn, tokensOut: tOut }
}

// ─── Gemini (generateContent) ────────────────────────────────────────────────
async function runGemini(o: RunOpts, history: TheoTurn[], isAction: Set<string>, known: Set<string>, steps: number): Promise<EngineResult> {
  const contents: { role: string; parts: unknown[] }[] = history.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }))
  const functionDeclarations = o.tools.map(t => ({
    name: t.name, description: t.description,
    ...(Object.keys(t.params.properties).length ? { parameters: toGeminiSchema(t.params) } : {}),
  }))
  let tIn = 0, tOut = 0, lastText = ''
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`
  for (let i = 0; i < steps; i++) {
    const r = await post(url, { 'x-goog-api-key': o.key }, {
      systemInstruction: { parts: [{ text: o.system }] }, contents,
      tools: [{ functionDeclarations }], generationConfig: { maxOutputTokens: MAX_OUT },
    })
    if (!r.ok) return { text: '', pending: null, tokensIn: tIn, tokensOut: tOut, error: friendlyAiError('gemini', r.status, r.text) }
    const j = JSON.parse(r.text)
    const um = j?.usageMetadata ?? {}
    tIn += Number(um.promptTokenCount ?? 0); tOut += Number(um.candidatesTokenCount ?? 0) + Number(um.thoughtsTokenCount ?? 0)
    const content = j?.candidates?.[0]?.content ?? { role: 'model', parts: [] }
    const parts: { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: unknown } }[] = content.parts ?? []
    lastText = parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n').trim()
    const calls: Call[] = parts.filter(p => p.functionCall).map((p, k) => ({ id: String(p.functionCall!.id ?? k), name: String(p.functionCall!.name), input: parseArgs(p.functionCall!.args) }))
    if (!calls.length) return { text: lastText, pending: null, tokensIn: tIn, tokensOut: tOut }
    const h = await handleCalls(calls, o, isAction, known)
    if (h.pending) return { text: lastText, pending: h.pending, tokensIn: tIn, tokensOut: tOut }
    // Devolve a resposta da IA como veio (inclui as "assinaturas" de raciocínio exigidas pelo Gemini 3)
    contents.push({ role: 'model', parts })
    contents.push({ role: 'user', parts: h.results.map(x => ({ functionResponse: { name: x.name, ...(/^\d+$/.test(x.id) ? {} : { id: x.id }), response: { result: x.output } } })) })
  }
  return { text: lastText || 'Não consegui concluir em poucas etapas. Tente uma pergunta mais específica.', pending: null, tokensIn: tIn, tokensOut: tOut }
}

// Confere a chave com uma chamada barata (lista de modelos)
export async function checkTheoKey(provider: TheoProvider, key: string): Promise<string | null> {
  try {
    const r = provider === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
      : provider === 'openai'
        ? await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
        : await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } })
    if (r.ok) return null
    return [400, 401, 403].includes(r.status) ? 'Chave recusada. Confira se copiou inteira e se está ativa.' : `Não consegui conferir a chave agora (${r.status}).`
  } catch {
    return 'Não consegui falar com o serviço de IA agora. Tente de novo.'
  }
}
