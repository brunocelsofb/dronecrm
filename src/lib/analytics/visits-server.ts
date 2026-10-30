// Gravação das visitas (rotina pública: cliente admin com tenant_id explícito).
// O visitante vira um código diário: HMAC(chave do servidor + dia, empresa + IP + navegador).
// IP e navegador não são guardados; o código muda todo dia e não identifica ninguém.
import { createHmac } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { ENGAGED_MS, MAX_DURATION_MS, deviceOf, isBot, pageRef, referrerHost } from '@/lib/analytics/visits'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const spDate = (d = new Date()) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)

function dayKey(day: string): string {
  const base = process.env.SETTINGS_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'drone'
  return createHmac('sha256', base).update(`visitas:${day}`).digest('hex')
}
export function visitorDay(tenantId: string, ip: string, ua: string, day: string): string {
  return createHmac('sha256', dayKey(day)).update(`${tenantId}|${ip}|${ua}`).digest('hex').slice(0, 32)
}

export function clientIp(h: Headers, trusted?: string | null): string {
  return (trusted || h.get('x-forwarded-for')?.split(',')[0] || h.get('x-real-ip') || '').trim().slice(0, 64)
}

export type VisitInput = { tenantId: string; channel: 'site' | 'vitrine'; href: string; referrer?: string | null; title?: string | null; width?: number | null; ip: string; ua: string }
export async function recordVisit(v: VisitInput): Promise<{ id: string } | { skip: string }> {
  if (isBot(v.ua)) return { skip: 'robô' }
  const ref = pageRef(v.href)
  if (!ref) return { skip: 'endereço inválido' }
  const day = spDate()
  const { data, error } = await createAdminClient().from('page_visits').insert({
    tenant_id: v.tenantId, channel: v.channel, host: ref.host, path: ref.path, title: v.title ? String(v.title).slice(0, 200) : null,
    visitor_day: visitorDay(v.tenantId, v.ip, v.ua, day), visited_on: day,
    device: deviceOf(v.width, v.ua), ...ref.utm, campaign_code: ref.campaign_code, referrer_host: referrerHost(v.referrer, ref.host),
  }).select('id').single()
  if (error || !data) return { skip: error?.message ?? 'falha' }
  return { id: data.id as string }
}

// Fim da visita: tempo na página (visível) e se a pessoa interagiu. Só vale nas 2 primeiras horas.
export async function endVisit(id: string, durationMs: number, interacted: boolean): Promise<void> {
  if (!UUID.test(id)) return
  const d = Math.min(Math.max(Math.round(Number(durationMs) || 0), 0), MAX_DURATION_MS)
  const since = new Date(Date.now() - 2 * 3_600_000).toISOString()
  await createAdminClient().from('page_visits').update({ duration_ms: d, engaged: interacted || d >= ENGAGED_MS })
    .eq('id', id).gte('started_at', since).lte('duration_ms', d)
}
