// ─── Leitura de leads vindos de integrações ──────────────────────────────────
// Cada ferramenta manda os dados de um jeito (JSON, formulário, nomes de campo
// em português ou inglês, perguntas do Google Forms…). Aqui tudo vira o mesmo
// formato do CRM. Cálculo puro (sem banco) para poder testar.

import { readTracking, type Tracking } from '@/lib/marketing/tracking'

export type IntegrationKind = 'site' | 'wordpress' | 'google_forms' | 'google_ads_form' | 'whatsapp_button' | 'zapier' | 'rd_station' | 'mailchimp' | 'meta_lead_ads' | 'linkedin_lead_forms'

export type ParsedLead = {
  name: string | null
  email: string | null
  phone: string | null
  company_name: string | null
  cnpj: string | null
  message: string | null
  tracking: Tracking
  conversion: string | null      // nome do formulário/conversão na ferramenta de origem
  unsubscribe?: boolean          // Mailchimp: pessoa saiu da lista
}

type Flat = [string, string][]

const norm = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Achata objetos/listas em pares [caminho, valor]; formulário do Elementor
// (fields: { id: { title, value } }) também vira [título, valor]
export function flatten(input: unknown, prefix = '', out: Flat = []): Flat {
  if (input === null || input === undefined) return out
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    out.push([prefix, String(input)])
    return out
  }
  if (Array.isArray(input)) {
    if (input.every(v => typeof v === 'string' || typeof v === 'number')) out.push([prefix, input.join(', ')])
    else input.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
    return out
  }
  if (typeof input === 'object') {
    const o = input as Record<string, unknown>
    if ('value' in o && ('title' in o || 'id' in o || 'label' in o) && (typeof o.value === 'string' || typeof o.value === 'number')) {
      const v = String(o.value)
      for (const k of ['title', 'label', 'id']) if (typeof o[k] === 'string' && o[k]) out.push([String(o[k]), v])
      return out
    }
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}[${k}]` : k, out)
  }
  return out
}

// Últimos segmentos do caminho: "data[merges][FNAME]" → "fname"; "fields[name][value]" → "name"
function keyCandidates(path: string): string[] {
  const parts = path.split(/[[\].]+/).filter(Boolean).filter(p => !/^\d+$/.test(p))
  const meaningful = parts.filter(p => !['value', 'raw_value', 'data', 'fields', 'merges', 'answers'].includes(p.toLowerCase()))
  const last = meaningful[meaningful.length - 1] ?? parts[parts.length - 1] ?? path
  return [norm(last), norm(path)]
}

type Field = 'first' | 'last' | 'name' | 'email' | 'phone' | 'company' | 'cnpj' | 'message'
function classify(k: string): Field | null {
  if (!k) return null
  if (k.includes('cnpj')) return 'cnpj'
  if (/^(utm|gclid|fbclid|landingpage|referrer|empresa_slug)/.test(k)) return null
  if (/(e?mail)/.test(k) && !/(mailchimp|tipo|optin|consent|permit)/.test(k)) return 'email'
  if (/^(firstname|fname|primeironome|givenname)$/.test(k)) return 'first'
  if (/^(lastname|lname|sobrenome|ultimonome|familyname|surname)$/.test(k)) return 'last'
  if (/(telefone|celular|whats|phone|fone|mobile|tel$|^tel|contato$)/.test(k)) return 'phone'
  if (/(empresa|company|organiza|instituicao|razaosocial|hospital|clinica|nomedaempresa)/.test(k)) return 'company'
  if (/(mensagem|message|msg|comentario|observa|duvida|descricao|pergunta|ajuda|necessidade)/.test(k)) return 'message'
  if (/^(name|nome|fullname|nomecompleto|yourname|seunome|nomedocontato|responsavel|nomeesobrenome)$/.test(k) || /(^|seu|your|full)nome|name$/.test(k)) return 'name'
  return null
}

const clean = (v: string | null | undefined, max = 300) => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

// Leitura genérica (site, WordPress, Google Forms, Zapier/Make…)
export function parseGeneric(payload: unknown, extraTracking: Record<string, string> = {}): ParsedLead {
  const flat = flatten(payload)
  const got: Partial<Record<Field, string>> = {}
  const msgs: string[] = []
  const trackingSrc: Record<string, string> = { ...extraTracking }
  for (const [path, value] of flat) {
    if (!value.trim()) continue
    // Dados técnicos do formulário (Elementor/WordPress: form[…], meta[…]) não são do lead
    if (/^(form|meta|page|post|_wp|_wpcf7|action|submit)(\[|_|$)/i.test(path)) continue
    const cands = keyCandidates(path)
    const rawLast = path.split(/[[\].]+/).filter(Boolean).pop() ?? path
    if (/^(utm_[a-z]+|gclid|fbclid|landing_page|referrer)$/i.test(rawLast)) { trackingSrc[rawLast.toLowerCase()] = value; continue }
    let f: Field | null = null
    for (const c of cands) { f = classify(c); if (f) break }
    if (!f) continue
    if (f === 'message') { msgs.push(value); continue }
    if (f === 'email' && !value.includes('@')) continue
    if (f === 'phone' && value.replace(/\D/g, '').length < 8) continue
    if (!got[f]) got[f] = value
  }
  const name = clean(got.name) ?? clean([got.first, got.last].filter(Boolean).join(' '))
  const email = clean(got.email, 200)?.toLowerCase() ?? null
  return {
    name, email: email && /.+@.+\..+/.test(email) ? email : null,
    phone: clean(got.phone, 40), company_name: clean(got.company), cnpj: clean(got.cnpj, 30),
    message: clean(msgs.join('\n'), 4000),
    tracking: readTracking(k => trackingSrc[k]),
    conversion: null,
  }
}

// Formulário de lead do Google Ads (webhook): user_column_data [{ column_id, string_value }]
export function parseGoogleAdsForm(payload: Record<string, unknown>): ParsedLead {
  const cols = Array.isArray(payload.user_column_data) ? payload.user_column_data as Record<string, unknown>[] : []
  const map: Record<string, string> = {}
  const extras: string[] = []
  for (const c of cols) {
    const id = String(c.column_id ?? '').toUpperCase()
    const v = String(c.string_value ?? '').trim()
    if (!v) continue
    if (['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'EMAIL', 'WORK_EMAIL', 'PHONE_NUMBER', 'WORK_PHONE', 'COMPANY_NAME'].includes(id)) map[id] = v
    else extras.push(`${String(c.column_name ?? id)}: ${v}`)
  }
  const generic = parseGeneric(Object.fromEntries(extras.map(e => { const i = e.indexOf(':'); return [e.slice(0, i), e.slice(i + 1).trim()] })))
  const tracking: Record<string, string> = { utm_source: 'google', utm_medium: 'cpc' }
  if (payload.gcl_id) tracking.gclid = String(payload.gcl_id)
  if (payload.campaign_id) tracking.utm_campaign = String(payload.campaign_id)
  return {
    name: clean(map.FULL_NAME ?? [map.FIRST_NAME, map.LAST_NAME].filter(Boolean).join(' ')),
    email: clean(map.EMAIL ?? map.WORK_EMAIL, 200)?.toLowerCase() ?? null,
    phone: clean(map.PHONE_NUMBER ?? map.WORK_PHONE, 40),
    company_name: clean(map.COMPANY_NAME) ?? generic.company_name,
    cnpj: generic.cnpj,
    message: clean(extras.join('\n'), 4000),
    tracking: readTracking(k => tracking[k]),
    conversion: payload.form_id ? `Formulário do Google Ads ${String(payload.form_id)}` : 'Formulário do Google Ads',
  }
}

// RD Station Marketing (webhook de conversão): { leads: [ { name, email, company, personal_phone, mobile_phone, last_conversion: { content, conversion_origin } } ] }
export function parseRdStation(payload: Record<string, unknown>): ParsedLead[] {
  const list = Array.isArray(payload.leads) ? payload.leads as Record<string, unknown>[] : [payload]
  return list.map(l => {
    const conv = (l.last_conversion ?? l.first_conversion ?? {}) as Record<string, unknown>
    const content = (conv.content ?? {}) as Record<string, unknown>
    const origin = (conv.conversion_origin ?? {}) as Record<string, unknown>
    const custom: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(l)) if (k.startsWith('cf_')) custom[k.slice(3)] = v
    const generic = parseGeneric({ ...content, ...custom })
    const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)
    const tracking: Record<string, string> = {}
    if (s(origin.source)) tracking.utm_source = s(origin.source)!
    if (s(origin.medium)) tracking.utm_medium = s(origin.medium)!
    if (s(origin.campaign)) tracking.utm_campaign = s(origin.campaign)!
    if (s(origin.value)) tracking.utm_content = s(origin.value)!
    for (const k of ['traffic_source', 'traffic_medium', 'traffic_campaign']) { const v = s(content[k]); if (v) tracking[k.replace('traffic_', 'utm_')] ??= v }
    return {
      name: clean(s(l.name)) ?? generic.name,
      email: clean(s(l.email), 200)?.toLowerCase() ?? generic.email,
      phone: clean(s(l.mobile_phone) ?? s(l.personal_phone), 40) ?? generic.phone,
      company_name: clean(s(l.company)) ?? generic.company_name,
      cnpj: generic.cnpj,
      message: generic.message,
      tracking: readTracking(k => tracking[k]),
      conversion: clean(s(content.identificador) ?? s(conv.conversion_identifier) ?? s(content.conversion_identifier)),
    }
  })
}

// Mailchimp (webhook do público): type=subscribe|profile|unsubscribe&data[email]=…&data[merges][FNAME]=…
export function parseMailchimp(payload: Record<string, unknown>): ParsedLead {
  const flat = Object.fromEntries(flatten(payload))
  const type = String(flat.type ?? '').toLowerCase()
  const g = (k: string) => flat[`data[merges][${k}]`] ?? null
  const generic = parseGeneric(payload)
  return {
    name: clean([g('FNAME'), g('LNAME')].filter(Boolean).join(' ')) ?? generic.name,
    email: clean(flat['data[email]'] ?? g('EMAIL'), 200)?.toLowerCase() ?? generic.email,
    phone: clean(g('PHONE'), 40) ?? generic.phone,
    company_name: clean(g('COMPANY')) ?? generic.company_name,
    cnpj: generic.cnpj,
    message: null,
    tracking: readTracking(() => undefined),
    conversion: flat['data[list_id]'] ? `Lista do Mailchimp ${flat['data[list_id]']}` : 'Mailchimp',
    unsubscribe: type === 'unsubscribe' || type === 'cleaned',
  }
}

export function parseIntegrationPayload(kind: IntegrationKind, payload: unknown, query: Record<string, string> = {}): ParsedLead[] {
  const obj = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  if (kind === 'rd_station') return parseRdStation(obj)
  if (kind === 'mailchimp') return [parseMailchimp(obj)]
  if (kind === 'google_ads_form') return [parseGoogleAdsForm(obj)]
  const p = parseGeneric(obj, query)
  // Canal padrão quando a ferramenta não manda origem
  const def: Partial<Record<IntegrationKind, { s: string; m: string }>> = { meta_lead_ads: { s: 'meta', m: 'lead_ads' }, linkedin_lead_forms: { s: 'linkedin', m: 'lead_gen' } }
  const d = def[kind]
  if (d && !p.tracking.utm_source) p.tracking = { ...p.tracking, utm_source: d.s, utm_medium: p.tracking.utm_medium ?? d.m }
  return [p]
}
