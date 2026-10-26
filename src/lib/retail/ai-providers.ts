// ─── Varejo: chamada às IAs de imagem (servidor) ──────────────────────────────
// Gemini (API Interactions do Google) e OpenAI (Images API). A chave é a da própria
// usuária; nunca vai para o navegador nem para log.

import type { AiProvider } from '@/lib/retail/ai-studio'

export type GenInput = { provider: AiProvider; key: string; model: string; prompt: string; images: string[] /* URLs públicas */; size: string; aspect: string }
export type GenResult = { ok: true; data: Buffer; mime: string } | { ok: false; error: string }

async function fetchAsBase64(url: string): Promise<{ data: string; mime: string }> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Não consegui abrir uma das fotos (${r.status}).`)
  const mime = (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0]
  return { data: Buffer.from(await r.arrayBuffer()).toString('base64'), mime }
}

// Procura a primeira imagem em base64 na resposta (o formato do Google pode variar)
function findImage(node: unknown, depth = 0): { data: string; mime: string } | null {
  if (!node || typeof node !== 'object' || depth > 8) return null
  const o = node as Record<string, unknown>
  if ((o.type === 'image' || o.mime_type || o.mimeType) && typeof o.data === 'string' && o.data.length > 100) {
    return { data: o.data, mime: String(o.mime_type ?? o.mimeType ?? 'image/png') }
  }
  const inline = (o.inlineData ?? o.inline_data) as Record<string, unknown> | undefined
  if (inline && typeof inline.data === 'string') return { data: inline.data, mime: String(inline.mimeType ?? inline.mime_type ?? 'image/png') }
  for (const v of Object.values(o)) {
    const hit = Array.isArray(v) ? v.map(x => findImage(x, depth + 1)).find(Boolean) ?? null : findImage(v, depth + 1)
    if (hit) return hit
  }
  return null
}

function apiError(provider: AiProvider, status: number, body: string): string {
  let msg = ''
  try { const j = JSON.parse(body); msg = j?.error?.message ?? '' } catch { /* texto */ }
  if (status === 401 || status === 403) return `A ${provider === 'gemini' ? 'chave do Google' : 'chave da OpenAI'} foi recusada. Confira se está ativa e com cobrança liberada.`
  if (status === 429) return 'Limite de uso ou de crédito da sua conta de IA atingido. Confira o saldo/cobrança na sua conta.'
  if (status === 400 && /safety|policy|moderation|blocked/i.test(msg + body)) return 'A IA recusou o pedido pelas regras de segurança dela. Ajuste o texto ou troque as fotos.'
  return `A IA respondeu com erro (${status})${msg ? `: ${msg.slice(0, 200)}` : '.'}`
}

export async function generateImage(g: GenInput): Promise<GenResult> {
  try {
    if (g.provider === 'gemini') {
      const imgs = await Promise.all(g.images.map(fetchAsBase64))
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': g.key },
        body: JSON.stringify({
          model: g.model,
          input: [{ type: 'text', text: g.prompt }, ...imgs.map(i => ({ type: 'image', mime_type: i.mime, data: i.data }))],
          response_format: { type: 'image', aspect_ratio: g.aspect, image_size: '2K' },
        }),
      })
      const text = await r.text()
      if (!r.ok) return { ok: false, error: apiError('gemini', r.status, text) }
      let json: unknown = null
      try { json = JSON.parse(text) } catch { return { ok: false, error: 'Resposta inesperada do Google.' } }
      const img = findImage(json)
      if (!img) return { ok: false, error: 'O Google não devolveu imagem (pode ter recusado pelas regras de segurança). Tente ajustar o texto.' }
      return { ok: true, data: Buffer.from(img.data, 'base64'), mime: img.mime }
    }
    // OpenAI: sem foto de referência gera do zero; com fotos, edita/combina as fotos
    const common = { model: g.model, prompt: g.prompt, size: g.size, quality: 'medium', n: 1, output_format: 'jpeg' }
    const r = await fetch(g.images.length ? 'https://api.openai.com/v1/images/edits' : 'https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${g.key}` },
      body: JSON.stringify(g.images.length ? { ...common, images: g.images.map(u => ({ image_url: u })) } : common),
    })
    const text = await r.text()
    if (!r.ok) return { ok: false, error: apiError('openai', r.status, text) }
    let json: { data?: { b64_json?: string }[] } = {}
    try { json = JSON.parse(text) } catch { return { ok: false, error: 'Resposta inesperada da OpenAI.' } }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) return { ok: false, error: 'A OpenAI não devolveu imagem.' }
    return { ok: true, data: Buffer.from(b64, 'base64'), mime: 'image/jpeg' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Falha ao chamar a IA.' }
  }
}

// Confere a chave sem gerar nada (lista de modelos: não cobra)
export async function checkKey(provider: AiProvider, key: string): Promise<string | null> {
  try {
    const r = provider === 'gemini'
      ? await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } })
      : await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    if (r.ok) return null
    return r.status === 401 || r.status === 403 || r.status === 400 ? 'Chave recusada. Confira se copiou inteira e se está ativa.' : `Não consegui conferir a chave agora (${r.status}).`
  } catch {
    return 'Não consegui falar com o serviço de IA agora. Tente de novo.'
  }
}

// Texto a partir de uma foto (OpenAI Responses / Gemini Interactions).
// Junta todos os textos da resposta; quem chama usa o último que fizer sentido.
function allTexts(node: unknown, out: string[] = [], depth = 0): string[] {
  if (!node || typeof node !== 'object' || depth > 10) return out
  const o = node as Record<string, unknown>
  if (typeof o.output_text === 'string' && o.output_text.trim()) out.push(o.output_text)
  if ((o.type === 'output_text' || o.type === 'text') && typeof o.text === 'string' && o.text.trim()) out.push(o.text)
  for (const v of Object.values(o)) {
    if (Array.isArray(v)) v.forEach(x => allTexts(x, out, depth + 1))
    else if (v && typeof v === 'object') allTexts(v, out, depth + 1)
  }
  return out
}

export async function describeImage(g: { provider: AiProvider; key: string; model: string; prompt: string; imageUrl: string }): Promise<{ ok: true; texts: string[] } | { ok: false; error: string }> {
  try {
    let r: Response
    if (g.provider === 'gemini') {
      const img = await fetchAsBase64(g.imageUrl)
      r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': g.key },
        body: JSON.stringify({ model: g.model, input: [{ type: 'text', text: g.prompt }, { type: 'image', mime_type: img.mime, data: img.data }] }),
      })
    } else {
      r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${g.key}` },
        body: JSON.stringify({ model: g.model, input: [{ role: 'user', content: [{ type: 'input_text', text: g.prompt }, { type: 'input_image', image_url: g.imageUrl }] }] }),
      })
    }
    const body = await r.text()
    if (!r.ok) return { ok: false, error: apiError(g.provider, r.status, body) }
    let json: unknown = null
    try { json = JSON.parse(body) } catch { return { ok: false, error: 'Resposta inesperada da IA.' } }
    const texts = allTexts(json).filter(t => t !== g.prompt)
    return texts.length ? { ok: true, texts } : { ok: false, error: 'A IA não devolveu texto.' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'Falha ao chamar a IA.' }
  }
}
