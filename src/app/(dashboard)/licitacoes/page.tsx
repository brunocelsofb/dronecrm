// Licitações (PNCP): radar do que bateu com os monitoramentos da empresa e os monitoramentos.
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { LicitacoesView, type MatchView, type WatcherView } from '@/components/licitacoes/licitacoes-view'
import type { PncpRow } from '@/lib/pncp/catalog'

export const dynamic = 'force-dynamic'

export default async function LicitacoesPage() {
  const access = await getUserAccess()
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ data: matchRows }, { data: watcherRows }, { data: people }, { data: areas }, { data: pipes }] = await Promise.all([
    db.from('pncp_matches').select('id, numero_controle, watcher_ids, status, assigned_to, contract_id, ai_score, ai_summary, ai_at, note, created_at')
      .order('created_at', { ascending: false }).limit(400),
    db.from('pncp_watchers').select('*').order('created_at'),
    db.from('profiles').select('id, full_name').order('full_name'),
    db.from('org_areas').select('id, name').order('name'),
    db.from('pipelines').select('id, name, type, is_default').eq('type', 'vendas').order('name'),
  ])
  const ms = (matchRows ?? []) as Omit<MatchView, 'row'>[]
  const ids = ms.map(m => m.numero_controle)
  const rows: PncpRow[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await createAdminClient().from('pncp_contratacoes').select('*').in('numero_controle', ids.slice(i, i + 200))
    rows.push(...((data ?? []) as PncpRow[]))
  }
  const byId = new Map(rows.map(r => [r.numero_controle, r]))
  const matches: MatchView[] = ms.filter(m => byId.has(m.numero_controle)).map(m => ({ ...m, row: byId.get(m.numero_controle)! }))
  const watchers = ((watcherRows ?? []) as Record<string, unknown>[]).map(w => ({
    id: String(w.id), name: String(w.name), keywords: (w.keywords as string[]) ?? [], exclude: (w.exclude as string[]) ?? [],
    ufs: (w.ufs as string[]) ?? [], modalidades: (w.modalidades as number[]) ?? [],
    min_value: w.min_value === null ? null : Number(w.min_value), max_value: w.max_value === null ? null : Number(w.max_value),
    recipient_ids: (w.recipient_ids as string[]) ?? [], area_ids: (w.area_ids as string[]) ?? [],
    channels: { sino: true, whatsapp: false, email: false, ...((w.channels ?? {}) as object) } as WatcherView['channels'],
    ai_analysis: w.ai_analysis === true, remind_days: Number(w.remind_days ?? 3), enabled: w.enabled !== false,
    last_run_at: (w.last_run_at as string | null) ?? null,
  })) as WatcherView[]
  const nowMs = new Date().getTime()
  const pipelines = ((pipes ?? []) as { id: string; name: string; is_default: boolean | null }[])
    .sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default))
  return (
    <LicitacoesView
      isAdmin={!!access?.isAdmin}
      matches={matches}
      watchers={watchers}
      people={((people ?? []) as { id: string; full_name: string | null }[]).filter(p => p.full_name).map(p => ({ id: p.id, name: p.full_name as string }))}
      areas={(areas ?? []) as { id: string; name: string }[]}
      pipelines={pipelines.map(p => ({ id: p.id, name: p.name }))}
      nowMs={nowMs}
    />
  )
}
