// ─── Ferramentas de e-mail marketing da empresa (envio de listas) ────────────
// Mailchimp: chave de API (Basic auth "qualquer:chave") e prefixo do servidor
//   (ex.: us21 — vem no fim da chave). Contato: PUT /lists/{id}/members/{md5}
//   + etiqueta: POST /lists/{id}/members/{md5}/tags.
// RD Station Marketing: chave de API do App Publisher (só eventos de conversão):
//   POST https://api.rd.services/platform/conversions?api_key=… — cria/atualiza o contato.
// Chaves criptografadas (SETTINGS_ENCRYPTION_KEY) em organization_settings.marketing_tools.

import { createHash } from 'node:crypto'
import { decryptSecret } from '@/lib/ai/tenant-key'
import type { Member } from './segments'

export type ToolsConfig = {
  mailchimp?: { key_enc: string; last4: string; dc: string; list_id?: string | null; list_name?: string | null; double_optin?: boolean }
  rd_station?: { key_enc: string; last4: string; legal_basis?: string }
}

export function readTools(raw: unknown): ToolsConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | undefined>
  const out: ToolsConfig = {}
  const mc = o.mailchimp, rd = o.rd_station
  if (mc && typeof mc.key_enc === 'string' && typeof mc.dc === 'string') {
    out.mailchimp = { key_enc: mc.key_enc, last4: String(mc.last4 ?? ''), dc: mc.dc, list_id: typeof mc.list_id === 'string' ? mc.list_id : null, list_name: typeof mc.list_name === 'string' ? mc.list_name : null, double_optin: mc.double_optin === true }
  }
  if (rd && typeof rd.key_enc === 'string') out.rd_station = { key_enc: rd.key_enc, last4: String(rd.last4 ?? ''), legal_basis: typeof rd.legal_basis === 'string' ? rd.legal_basis : undefined }
  return out
}

// Prefixo do servidor no fim da chave do Mailchimp: "xxxxxxxx-us21" → "us21"
export function mailchimpDc(key: string): string | null {
  const m = key.trim().match(/-([a-z]{2,4}\d{1,3})$/i)
  return m ? m[1].toLowerCase() : null
}

const md5 = (s: string) => createHash('md5').update(s.trim().toLowerCase()).digest('hex')

async function mc(key: string, dc: string, path: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> | null }> {
  if (!/^[a-z]{2,4}\d{1,3}$/.test(dc)) throw new Error('Prefixo do servidor do Mailchimp inválido.')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(`https://${dc}.api.mailchimp.com/3.0${path}`, {
      ...init, signal: ctrl.signal, cache: 'no-store',
      headers: { Authorization: `Basic ${Buffer.from(`crm:${key}`).toString('base64')}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const text = await res.text()
    let json: Record<string, unknown> | null = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    return { status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

const mcError = (r: { status: number; json: Record<string, unknown> | null }) =>
  r.status === 401 ? 'O Mailchimp não aceitou a chave de API (confira a chave).'
    : `Mailchimp respondeu ${r.status}${r.json?.detail ? `: ${String(r.json.detail).slice(0, 200)}` : ''}`

export async function mailchimpAudiences(key: string, dc: string): Promise<{ id: string; name: string; members: number }[]> {
  const r = await mc(key, dc, '/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count')
  if (r.status !== 200) throw new Error(mcError(r))
  const lists = (r.json?.lists ?? []) as { id: string; name: string; stats?: { member_count?: number } }[]
  return lists.map(l => ({ id: l.id, name: l.name, members: l.stats?.member_count ?? 0 }))
}

export async function mailchimpUpsert(key: string, dc: string, listId: string, m: Member, tag: string, doubleOptin: boolean): Promise<void> {
  const hash = md5(m.email)
  const [first, ...rest] = m.name.trim().split(/\s+/)
  const r = await mc(key, dc, `/lists/${encodeURIComponent(listId)}/members/${hash}?skip_merge_validation=true`, {
    method: 'PUT',
    body: JSON.stringify({
      email_address: m.email,
      status_if_new: doubleOptin ? 'pending' : 'subscribed',
      merge_fields: { FNAME: first ?? '', LNAME: rest.join(' ') },
    }),
  })
  if (r.status !== 200) throw new Error(mcError(r))
  const t = await mc(key, dc, `/lists/${encodeURIComponent(listId)}/members/${hash}/tags`, {
    method: 'POST', body: JSON.stringify({ tags: [{ name: tag, status: 'active' }] }),
  })
  if (t.status !== 204 && t.status !== 200) throw new Error(mcError(t))
}

// Identificador das conversões que o CRM manda ao RD (o aviso de volta é ignorado)
export const RD_CRM_PREFIX = 'crm-lista-'

export async function rdConversion(key: string, m: Member, identifier: string, tag: string, legalBasis: string | null): Promise<void> {
  const payload: Record<string, unknown> = {
    conversion_identifier: identifier, email: m.email, name: m.name, tags: [tag],
  }
  if (m.company) payload.company_name = m.company
  if (m.phone) payload.mobile_phone = m.phone
  if (legalBasis) payload.legal_bases = [{ category: 'communications', type: legalBasis, status: 'granted' }]
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(`https://api.rd.services/platform/conversions?api_key=${encodeURIComponent(key)}`, {
      method: 'POST', signal: ctrl.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'CONVERSION', event_family: 'CDP', payload }),
    })
    if (res.status === 200) return
    const text = (await res.text()).slice(0, 300)
    throw new Error(res.status === 401 ? 'O RD Station não aceitou a chave de API (confira a chave e se está ativa).' : `RD Station respondeu ${res.status}${text ? `: ${text}` : ''}`)
  } finally {
    clearTimeout(timer)
  }
}

export function openKey(enc: string): string {
  return decryptSecret(enc)
}
