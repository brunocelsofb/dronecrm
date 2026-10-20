// Rodada semanal do Hunter sobre as empresas inativas: resumo ao gestor por
// segmento e tarefa de reativação ao responsável da conta. Só servidor/cron —
// sem 'use server' de propósito (não pode virar ação chamável pelo navegador).

import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { loadInactiveCompanies, todayBr } from './inactive-data'
import { bySegment } from './inactive'

const MAX_TASKS_PER_RUN = 40          // por empresa (tenant) e por semana
const SKIP_AFTER_DONE_DAYS = 90       // tarefa concluída há menos que isso: não abre outra

// Rodada semanal (segunda-feira, horário de Brasília). Chamada pelo cron dentro
// de forEachActiveTenant. force = ignora o dia e a trava da semana (teste).
export async function runInactiveHunter(tenantId: string, opts: { force?: boolean } = {}) {
  const today = todayBr()
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  if (!opts.force && weekday !== 1) return { skipped: 'só às segundas' }
  const db = await createScopedAdmin(tenantId)
  const { data: org } = await db.from('organization_settings').select('inactive_hunter_last_run').eq('tenant_id', tenantId).maybeSingle()
  if (!opts.force && (org as { inactive_hunter_last_run?: string | null } | null)?.inactive_hunter_last_run === today) return { skipped: 'já rodou hoje' }

  const { list, settings } = await loadInactiveCompanies(tenantId)
  const out = { inactive: list.length, summary: 'desligado' as string, tasks: 0 }

  // Marca antes de enviar: se o envio falhar, não repete várias vezes no dia
  await db.from('organization_settings').update({ inactive_hunter_last_run: today }).eq('tenant_id', tenantId)

  // 1. Resumo ao gestor (WhatsApp do gestor configurado em Agentes IA)
  if (settings.hunter_weekly && list.length) {
    const groups = bySegment(list, settings.segments)
    const oldest = list.filter(c => c.lastWon).slice(0, 5)
    const text =
      `🔎 *Hunter — clientes inativos*\n` +
      `Sem contrato ativo e sem compra há ${settings.inactive_months} meses ou mais: *${list.length}*\n\n` +
      groups.map(g => `• ${g.segment}: ${g.count}${g.negotiating ? ` (${g.negotiating} já em negociação)` : ''}`).join('\n') +
      (oldest.length ? `\n\nHá mais tempo sem comprar:\n${oldest.map(c => `– ${c.tradeName || c.name} (${c.monthsSince} meses)`).join('\n')}` : '') +
      `\n\nPara campanha: Empresas → Inativas → filtre o segmento → Criar lista no Marketing.`
    try {
      const { sendWhatsApp } = await import('@/lib/agent/briefing-core')
      const r = await sendWhatsApp(text, tenantId)
      out.summary = r.sent ? 'enviado' : `falhou: ${r.error ?? ''}`
    } catch (e) {
      out.summary = `falhou: ${e instanceof Error ? e.message : String(e)}`
    }
  } else if (settings.hunter_weekly) out.summary = 'sem inativos'

  // 2. Tarefa de reativação ao responsável (sem negociação aberta; não repete)
  if (settings.hunter_tasks && list.length) {
    const candidates = list.filter(c => !c.negotiating && c.ownerId)
    const ids = candidates.map(c => c.id)
    const recent = new Set<string>()
    const cutoff = new Date(Date.now() - SKIP_AFTER_DONE_DAYS * 86_400_000).toISOString()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('activities').select('company_id, status, created_at')
        .in('company_id', ids.slice(i, i + 200)).eq('metadata->>kind', 'reactivation')
      for (const a of data ?? []) if (a.status !== 'done' || (a.created_at as string) > cutoff) recent.add(a.company_id as string)
    }
    for (const c of candidates.filter(c => !recent.has(c.id)).slice(0, MAX_TASKS_PER_RUN)) {
      const why = c.lastWon ? `última compra há ${c.monthsSince} meses` : 'cliente sem compra registrada no CRM'
      const { error } = await db.from('activities').insert({
        company_id: c.id, user_id: c.ownerId, assigned_to: c.ownerId,
        type: 'task', activity_type: 'call', status: 'planned', completed: false,
        title: `Reativar cliente: ${c.tradeName || c.name}`,
        content: `O Hunter identificou esta empresa como inativa (sem contrato ativo; ${why}). Segmento: ${c.segment ?? 'sem segmento'}. Retome o contato e, havendo interesse, abra uma oportunidade.`,
        activity_date: today,
        metadata: { kind: 'reactivation', source: 'hunter', segment: c.segment },
      })
      if (!error) out.tasks++
    }
  }
  return out
}
