// ─── Origem do lead (de onde veio) ───────────────────────────────────────────
// Parâmetros que os anúncios e links colocam no endereço (UTM, gclid do Google,
// fbclid do Meta) e as informações da página. Sem dependências de servidor.

export const TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'landing_page', 'referrer'] as const
export type TrackingKey = typeof TRACKING_KEYS[number]
export type Tracking = Partial<Record<TrackingKey, string>>

export function readTracking(get: (k: string) => unknown): Tracking {
  const out: Tracking = {}
  for (const k of TRACKING_KEYS) {
    const v = get(k)
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 500)
  }
  if (out.utm_campaign) out.utm_campaign = campaignCode(out.utm_campaign)
  return out
}

// Código da campanha no link (utm_campaign): minúsculo, sem acento, só letras, números, - e _
export function campaignCode(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

export const CHANNELS: { id: string; label: string; utmSource: string; utmMedium: string }[] = [
  { id: 'meta', label: 'Meta (Facebook / Instagram)', utmSource: 'meta', utmMedium: 'cpc' },
  { id: 'google', label: 'Google Ads', utmSource: 'google', utmMedium: 'cpc' },
  { id: 'linkedin', label: 'LinkedIn', utmSource: 'linkedin', utmMedium: 'cpc' },
  { id: 'email', label: 'E-mail marketing', utmSource: 'email', utmMedium: 'email' },
  { id: 'whatsapp', label: 'WhatsApp', utmSource: 'whatsapp', utmMedium: 'mensagem' },
  { id: 'evento', label: 'Evento / feira', utmSource: 'evento', utmMedium: 'presencial' },
  { id: 'organico', label: 'Orgânico (redes / site)', utmSource: 'organico', utmMedium: 'social' },
  { id: 'indicacao', label: 'Indicação', utmSource: 'indicacao', utmMedium: 'indicacao' },
  { id: 'outro', label: 'Outro', utmSource: 'outro', utmMedium: 'outro' },
]

export function channelLabel(id: string | null | undefined): string {
  return CHANNELS.find(c => c.id === id)?.label ?? 'Outro'
}

// Canal de um lead sem campanha cadastrada: pelo que veio no link ou no formulário
export function inferChannel(l: { utm_source?: string | null; utm_medium?: string | null; gclid?: string | null; fbclid?: string | null; source?: string | null }): string {
  const s = `${l.utm_source ?? ''} ${l.utm_medium ?? ''}`.toLowerCase()
  if (l.gclid || /google|adwords/.test(s)) return 'google'
  if (l.fbclid || /meta|facebook|instagram|\bfb\b|\big\b/.test(s)) return 'meta'
  if (/linkedin/.test(s)) return 'linkedin'
  if (/e-?mail|newsletter/.test(s)) return 'email'
  if (/whats|wpp/.test(s)) return 'whatsapp'
  const src = (l.source ?? '').toLowerCase()
  if (src === 'indicacao') return 'indicacao'
  if (src === 'evento') return 'evento'
  if (src === 'anuncio') return 'outro'
  if (src === 'formulario_site' || /organic|social|site/.test(s)) return 'organico'
  if (src.includes('whatsapp')) return 'whatsapp'
  return 'outro'
}
