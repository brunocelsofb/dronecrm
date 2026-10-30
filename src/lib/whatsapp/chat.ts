// ─── WhatsApp como no app oficial: regras puras (sem imports) ────────────────
// Usadas no webhook (tiques, reações, citação), na lista (não lidas) e no campo de
// mensagem (respostas rápidas). Testes em tests/whatsapp-chat.test.mjs.

export type Delivery = 'sent' | 'delivered' | 'read'
const RANK: Record<Delivery, number> = { sent: 1, delivered: 2, read: 3 }

// Situação vinda da Evolution/Baileys: texto (DELIVERY_ACK, READ, PLAYED…) ou número (2, 3, 4, 5)
export function evoAckStatus(raw: unknown): Delivery | null {
  if (raw === null || raw === undefined || raw === '') return null
  const s = String(raw).trim().toUpperCase()
  if (s === 'SERVER_ACK' || s === '2' || s === 'SENT') return 'sent'
  if (s === 'DELIVERY_ACK' || s === '3' || s === 'DELIVERED') return 'delivered'
  if (s === 'READ' || s === '4' || s === 'PLAYED' || s === '5') return 'read'
  return null
}

// Tique só avança (lido não volta para entregue quando os avisos chegam fora de ordem)
export function nextDelivery(current: unknown, incoming: Delivery | null): Delivery | null {
  if (!incoming) return null
  const cur = typeof current === 'string' && current in RANK ? RANK[current as Delivery] : 0
  return RANK[incoming] > cur ? incoming : null
}

// Avisos de situação do evento messages.update → [{ id do WhatsApp, situação }]
// Formatos: v2 { keyId, status } (messageId é o id interno da Evolution, não serve),
// v1 { key: { id }, update: { status } }; um objeto ou uma lista.
export function evoStatusUpdates(data: unknown): { id: string; status: Delivery; fromMe: boolean | null }[] {
  const list = Array.isArray(data) ? data : data ? [data] : []
  const out: { id: string; status: Delivery; fromMe: boolean | null }[] = []
  for (const d of list as Record<string, any>[]) {
    if (!d || typeof d !== 'object') continue
    const id = d.keyId ?? d.key?.id ?? d.id ?? null
    const status = evoAckStatus(d.status ?? d.update?.status ?? d.ack)
    if (!id || !status) continue
    const fromMe = typeof d.fromMe === 'boolean' ? d.fromMe : typeof d.key?.fromMe === 'boolean' ? d.key.fromMe : null
    out.push({ id: String(id), status, fromMe })
  }
  return out
}

// Id da mensagem citada (respondida) em qualquer tipo de mensagem
export function quotedIdOf(msg: unknown, msgData?: unknown): string | null {
  const top = (msgData as Record<string, any> | null)?.contextInfo?.stanzaId
  if (top) return String(top)
  if (!msg || typeof msg !== 'object') return null
  for (const v of Object.values(msg as Record<string, any>)) {
    const id = v && typeof v === 'object' ? v.contextInfo?.stanzaId : null
    if (id) return String(id)
  }
  return null
}

// Reação: { key: { id, fromMe }, text } — texto vazio tira a reação
export function reactionOf(msg: unknown): { targetId: string; emoji: string } | null {
  const r = (msg as Record<string, any> | null)?.reactionMessage
  const id = r?.key?.id
  if (!id) return null
  return { targetId: String(id), emoji: String(r.text ?? '') }
}

export type Reactions = { me?: string; them?: string }
export function applyReaction(current: unknown, who: 'me' | 'them', emoji: string): Reactions {
  const base: Reactions = current && typeof current === 'object' ? { ...(current as Reactions) } : {}
  if (emoji) base[who] = emoji.slice(0, 16)
  else delete base[who]
  return base
}

// Não lidas: mensagens recebidas depois da última leitura e da última resposta da empresa.
// Sem registro de leitura, conta a partir de `since` (evita marcar o histórico antigo).
export function unreadCount(
  msgs: { direction: string; created_at: string }[],
  lastReadAt: string | null | undefined,
  since: string,
): number {
  const lastOut = msgs.filter(m => m.direction === 'enviado').reduce((t, m) => Math.max(t, Date.parse(m.created_at) || 0), 0)
  const cut = Math.max(Date.parse(lastReadAt ?? since) || 0, lastOut)
  return msgs.filter(m => m.direction === 'recebido' && (Date.parse(m.created_at) || 0) > cut).length
}

// ─── Respostas rápidas ───────────────────────────────────────────────────────
export const normShortcut = (v: string) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/^\/+/, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 30)

// "/ped" no fim do texto (ou sozinho) → termo "ped"; null quando não está digitando um atalho
export function slashQuery(text: string): string | null {
  const m = /(?:^|\s)\/([a-z0-9_-]*)$/i.exec(text ?? '')
  return m ? m[1].toLowerCase() : null
}

export function matchQuickReplies<T extends { shortcut: string; body: string }>(list: T[], q: string): T[] {
  const t = normShortcut(q)
  return list
    .filter(r => !t || r.shortcut.includes(t) || normShortcut(r.body).includes(t))
    .sort((a, b) => Number(!b.shortcut.startsWith(t)) - Number(!a.shortcut.startsWith(t)) || a.shortcut.localeCompare(b.shortcut))
    .slice(0, 8)
}

// Variáveis: {nome} = primeiro nome do contato; {nome_completo}; {atendente}
export function fillQuickReply(body: string, vars: { nome?: string | null; atendente?: string | null }): string {
  const full = (vars.nome ?? '').trim()
  const first = full.split(/\s+/)[0] ?? ''
  return String(body ?? '')
    .replace(/\{nome_completo\}/gi, full)
    .replace(/\{nome\}/gi, first)
    .replace(/\{atendente\}/gi, (vars.atendente ?? '').trim())
    .replace(/[ \t]{2,}/g, ' ')
}

// Troca o "/termo" final do texto pela resposta escolhida
export function insertQuickReply(text: string, reply: string): string {
  return (text ?? '').replace(/(^|\s)\/[a-z0-9_-]*$/i, (_m, sp) => `${sp}${reply}`)
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

// ─── Apagada para todos ──────────────────────────────────────────────────────
// A mensagem continua no lugar, só com o aviso (como no WhatsApp); o conteúdo sai.
export const REVOKED_TYPE = 'revoked'
export const revokedText = (direction: string) => direction === 'enviado' ? '🚫 Você apagou esta mensagem' : '🚫 Esta mensagem foi apagada'

// "Apagar para todos" pode chegar como mensagem de protocolo (REVOKE, tipo 0)
export function revokedIdOf(msg: unknown): string | null {
  const p = (msg as Record<string, any> | null)?.protocolMessage
  if (!p) return null
  const t = p.type
  if (!(t === 0 || t === '0' || String(t).toUpperCase() === 'REVOKE')) return null
  return p.key?.id ? String(p.key.id) : null
}

// …ou como aviso de situação "DELETED" no messages.update
export function evoDeletedIds(data: unknown): string[] {
  const list = Array.isArray(data) ? data : data ? [data] : []
  const out: string[] = []
  for (const d of list as Record<string, any>[]) {
    if (!d || typeof d !== 'object') continue
    const st = String(d.status ?? d.update?.status ?? '').toUpperCase()
    const id = d.keyId ?? d.key?.id ?? null
    const viaProto = revokedIdOf(d.update?.message ?? d.message)
    if (viaProto) out.push(viaProto)
    else if (id && st === 'DELETED') out.push(String(id))
  }
  return out
}

// ─── Mensagem dentro de "envelope" ───────────────────────────────────────────
// Enviada por outro aparelho conectado (WhatsApp Web/celular: deviceSentMessage), em
// conversa temporária (ephemeralMessage), visualização única, documento com legenda,
// edição ou formato futuro: o conteúdo de verdade fica dentro. Abre até 5 camadas.
const WRAPPERS = ['deviceSentMessage', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage', 'futureProofMessage', 'groupMentionedMessage']
export function unwrapMessage<T = Record<string, any>>(msg: T | null | undefined): T | null {
  let cur = (msg ?? null) as Record<string, any> | null
  for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
    const key = WRAPPERS.find(k => cur![k]?.message && typeof cur![k].message === 'object')
    if (!key) break
    // Mantém o que vier ao lado do envelope (ex.: messageContextInfo)
    const { [key]: env, ...rest } = cur
    cur = { ...rest, ...env.message }
  }
  return cur as T | null
}

// ─── Mesmo número em formatos diferentes ─────────────────────────────────────
// Recebidas chegam sem DDI (62999677609); enviadas pela Central são gravadas com 55.
// Forma canônica: sem 55, com o 9 do celular.
export function canonPhone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = `${d.slice(0, 2)}9${d.slice(2)}`
  return d
}
export const samePhone = (a: unknown, b: unknown) => !!canonPhone(a) && canonPhone(a) === canonPhone(b)
// Formas gravadas possíveis do número (filtro do tempo real)
export function phoneVariants(raw: unknown): string[] {
  const c = canonPhone(raw)
  if (!c) return []
  const out = new Set([c, `55${c}`, String(raw ?? '').replace(/\D/g, '')])
  if (c.length === 11 && c[2] === '9') { const no9 = c.slice(0, 2) + c.slice(3); out.add(no9); out.add(`55${no9}`) }
  return [...out].filter(Boolean)
}
