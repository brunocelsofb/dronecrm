// ─── Estatísticas de página (regras puras, sem imports) ──────────────────────
// Site da empresa (código colado no site) e vitrine da loja. Sem cookies e sem dado pessoal:
// o visitante é um código diário (muda todo dia), então "visitantes únicos" conta a mesma
// pessoa uma vez por dia.

export const ENGAGED_MS = 10_000 // abandono = saiu em menos de 10 s sem rolar nem clicar
export const MAX_DURATION_MS = 30 * 60_000

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|axios|node-fetch|monitor|pingdom|uptime/i
export const isBot = (ua: string | null | undefined) => !ua || BOT.test(ua)

export type PageRef = { host: string; path: string; utm: Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content', string | null>; campaign_code: string | null }
// Endereço da página → host e caminho normalizados + origem do link
export function pageRef(href: string): PageRef | null {
  let u: URL
  try { u = new URL(String(href ?? '')) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  let path = decodeSafe(u.pathname).toLowerCase().replace(/\/index\.html?$/, '/').replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  const q = u.searchParams
  const clean = (v: string | null, n = 80) => (v ? v.trim().toLowerCase().slice(0, n) || null : null)
  const code = clean(q.get('c'), 40)
  return {
    host: u.hostname.toLowerCase().replace(/^www\./, '').slice(0, 200),
    path: path.slice(0, 300) || '/',
    utm: { utm_source: clean(q.get('utm_source')), utm_medium: clean(q.get('utm_medium')), utm_campaign: clean(q.get('utm_campaign')), utm_content: clean(q.get('utm_content')) },
    campaign_code: code && /^[a-z0-9][a-z0-9-]*$/.test(code) ? code : null,
  }
}
function decodeSafe(s: string) { try { return decodeURIComponent(s) } catch { return s } }

export function referrerHost(ref: string | null | undefined, ownHost: string): string | null {
  if (!ref) return null
  try {
    const h = new URL(ref).hostname.toLowerCase().replace(/^www\./, '')
    return h && h !== ownHost ? h.slice(0, 200) : null
  } catch { return null }
}

export function deviceOf(width: number | null | undefined, ua: string | null | undefined): 'celular' | 'tablet' | 'computador' {
  if (/ipad|tablet/i.test(ua ?? '')) return 'tablet'
  if (/mobi|android|iphone/i.test(ua ?? '')) return 'celular'
  const w = Number(width) || 0
  return w && w < 768 ? 'celular' : w && w < 1100 ? 'tablet' : 'computador'
}

// De onde veio: campanha/utm vence; senão o site que mandou; senão "Direto"
const KNOWN: [RegExp, string][] = [
  [/(^|\.)instagram\.com$|^l\.instagram\.com$/, 'Instagram'], [/(^|\.)facebook\.com$|^l\.facebook\.com$|^lm\.facebook\.com$|^m\.facebook\.com$/, 'Facebook'],
  [/(^|\.)google\.[a-z.]+$/, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'LinkedIn'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)whatsapp\.com$|^wa\.me$/, 'WhatsApp'],
  [/(^|\.)t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X (Twitter)'],
]
export function sourceLabel(v: { utm_source?: string | null; utm_medium?: string | null; referrer_host?: string | null }): string {
  const s = (v.utm_source ?? '').toLowerCase()
  if (s) {
    const paid = /cpc|ppc|paid|ads?$|lead_ads/.test((v.utm_medium ?? '').toLowerCase())
    const name = s === 'meta' || s === 'fb' || s === 'facebook' ? 'Meta (Facebook/Instagram)' : s === 'ig' || s === 'instagram' ? 'Instagram' : s === 'google' ? 'Google' : s.charAt(0).toUpperCase() + s.slice(1)
    return paid ? `${name} — anúncio` : name
  }
  const h = v.referrer_host ?? ''
  if (!h) return 'Direto ou link sem origem'
  for (const [re, label] of KNOWN) if (re.test(h)) return label
  return h
}

export type VisitRow = { started_at: string; visited_on: string; visitor_day: string; duration_ms: number; engaged: boolean; host: string; path: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; campaign_code: string | null; referrer_host: string | null; device: string | null }
export type VisitMetrics = { visits: number; uniques: number; bounceRate: number | null; avgMs: number | null }
export function visitMetrics(rows: VisitRow[]): VisitMetrics {
  const uniq = new Set(rows.map(r => `${r.visited_on}|${r.visitor_day}`))
  const timed = rows.map(r => Math.min(Math.max(Number(r.duration_ms) || 0, 0), MAX_DURATION_MS))
  return {
    visits: rows.length, uniques: uniq.size,
    bounceRate: rows.length ? rows.filter(r => !r.engaged).length / rows.length : null,
    avgMs: rows.length ? timed.reduce((t, v) => t + v, 0) / rows.length : null,
  }
}

// Variação em relação ao período anterior (null = sem base de comparação)
export function change(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null
  return (now - before) / before
}

// Períodos: este mês, mês passado ou últimos 30 dias (datas de São Paulo, fim exclusivo)
export type Period = { key: 'mes' | 'mes-passado' | '30d'; from: string; to: string; prevFrom: string; prevTo: string; label: string }
export function periodOf(key: string | null | undefined, todayIso: string): Period {
  const d = (s: string) => new Date(`${s}T00:00:00Z`)
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  const add = (s: string, days: number) => { const x = d(s); x.setUTCDate(x.getUTCDate() + days); return iso(x) }
  const firstOf = (s: string, monthDelta = 0) => { const x = d(s); return iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + monthDelta, 1))) }
  const tomorrow = add(todayIso, 1)
  if (key === '30d') return { key: '30d', from: add(tomorrow, -30), to: tomorrow, prevFrom: add(tomorrow, -60), prevTo: add(tomorrow, -30), label: 'Últimos 30 dias' }
  if (key === 'mes-passado') return { key: 'mes-passado', from: firstOf(todayIso, -1), to: firstOf(todayIso), prevFrom: firstOf(todayIso, -2), prevTo: firstOf(todayIso, -1), label: 'Mês passado' }
  // Este mês × o mesmo trecho do mês anterior (do dia 1 até o mesmo dia)
  const from = firstOf(todayIso), days = Math.round((d(tomorrow).getTime() - d(from).getTime()) / 86_400_000)
  const prevFrom = firstOf(todayIso, -1)
  return { key: 'mes', from, to: tomorrow, prevFrom, prevTo: add(prevFrom, days) < from ? add(prevFrom, days) : from, label: 'Este mês' }
}

// Dias do período (para o gráfico)
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const x = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`)
  while (x < end && out.length < 400) { out.push(x.toISOString().slice(0, 10)); x.setUTCDate(x.getUTCDate() + 1) }
  return out
}

// "Página" como aparece na lista: host + caminho
export const pageKey = (host: string, path: string) => `${host}${path === '/' ? '' : path}`
