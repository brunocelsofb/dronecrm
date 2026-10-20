import Link from 'next/link'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getUserAccess } from '@/lib/auth/access'
import { loadInactiveCompanies } from '@/lib/companies/inactive-data'
import { bySegment } from '@/lib/companies/inactive'
import { InactiveListButton } from '@/components/companies/inactive-list-button'

const NO_SEG = 'Sem segmento'

// Inativa = já comprou, sem contrato ativo (gestão de contratos) e sem compra
// há N meses (Configurações → Segmentos e inativos). Regra em lib/companies/inactive.ts.
export default async function InactiveCompaniesPage({ searchParams }: { searchParams: Promise<{ seg?: string }> }) {
  const { seg } = await searchParams
  const tenantId = await resolveTenantId()
  const [{ list, settings }, me] = await Promise.all([loadInactiveCompanies(tenantId), getUserAccess()])
  const groups = bySegment(list, settings.segments)
  const filtered = seg ? list.filter(c => (c.segment ?? NO_SEG) === seg) : list
  const canMarketing = !!me && (me.isAdmin || me.features.includes('marketing'))

  const ownerIds = [...new Set(filtered.map(c => c.ownerId).filter(Boolean))] as string[]
  const db = await createScopedAdmin(tenantId)
  const { data: owners } = ownerIds.length ? await db.from('profiles').select('id, full_name').in('id', ownerIds) : { data: [] as { id: string; full_name: string | null }[] }
  const ownerName = new Map((owners ?? []).map(o => [o.id as string, (o.full_name as string | null) ?? '—']))

  const chip = (active: boolean) => `rounded-full border px-3 py-1 text-xs ${active ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-brand-700'}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Clientes inativos</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Já compraram, estão sem contrato ativo e sem compra há {settings.inactive_months} meses ou mais — base para campanhas de reativação.
          </p>
        </div>
        <Link href="/companies" className="text-sm text-gray-500 hover:text-brand-700">← Todas as empresas</Link>
      </div>

      {list.length > 0 && (
        <div className="rounded-lg border border-warn-600/40 bg-warn-100 px-4 py-3 text-sm text-warn-700">
          <strong>{list.length}</strong> cliente(s) inativo(s){list.some(c => c.negotiating) && <> · {list.filter(c => c.negotiating).length} já com negociação aberta</>}.
          {' '}O Hunter {settings.hunter_weekly ? 'manda o resumo por segmento ao gestor toda segunda' : 'não manda resumo semanal (desligado)'}
          {settings.hunter_tasks ? ' e abre tarefa de reativação para o responsável da conta.' : '; tarefas de reativação desligadas.'}
          {me?.isAdmin && <> <Link href="/settings/segmentos" className="underline">Ajustar</Link></>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href="/companies/inactive" className={chip(!seg)}>Todos ({list.length})</Link>
        {groups.map(g => (
          <Link key={g.segment} href={`/companies/inactive?seg=${encodeURIComponent(g.segment)}`} className={chip(seg === g.segment)}>
            {g.segment} ({g.count})
          </Link>
        ))}
      </div>

      {canMarketing && filtered.length > 0 && <InactiveListButton segment={seg ?? null} />}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Empresa</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Segmento</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Última compra</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Meses sem comprar</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Responsável</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/companies/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.tradeName || c.name}</Link>
                  {c.tradeName && <div className="text-xs text-gray-400">{c.name}</div>}
                </td>
                <td className="px-4 py-3 text-gray-700">{c.segment ?? <span className="text-warn-700">Sem segmento</span>}</td>
                <td className="px-4 py-3 text-gray-700">
                  {c.lastWon ? new Date(`${c.lastWon}T12:00:00`).toLocaleDateString('pt-BR') : <span className="text-gray-400">Sem compra registrada no CRM</span>}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">{c.monthsSince ?? '—'}</td>
                <td className="px-4 py-3 text-gray-700">{c.ownerId ? ownerName.get(c.ownerId) ?? '—' : <span className="text-warn-700">Sem responsável</span>}</td>
                <td className="px-4 py-3">
                  {c.negotiating
                    ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">Em negociação</span>
                    : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Para reativar</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum cliente inativo{seg ? ' neste segmento' : ''}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">Contam como cliente quem já teve negócio ganho no CRM ou está cadastrado com status de cliente. Leads e prospects que nunca compraram ficam de fora.</p>
    </div>
  )
}
