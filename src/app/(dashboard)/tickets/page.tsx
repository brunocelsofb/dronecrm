import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { getSlaStatus, SLA_LABELS } from '@/lib/utils/sla'
import { PRIORITY_LABELS } from '@/lib/utils/gut-matrix'

const STATUS_LABELS: Record<string, string> = { aberto: 'Aberto', em_andamento: 'Em andamento', aguardando_cliente: 'Ag. cliente', resolvido: 'Resolvido', fechado: 'Fechado' }
const STATUS_ORDER = ['aberto', 'em_andamento', 'aguardando_cliente', 'resolvido', 'fechado']
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  aberto:             { bg: '#eef3ff', color: '#3b5bdb' },
  em_andamento:       { bg: '#fff8e6', color: '#92400e' },
  aguardando_cliente: { bg: '#f0eeff', color: '#5f38c9' },
  resolvido:          { bg: '#eaf5ee', color: '#1a7c3e' },
  fechado:            { bg: '#f1f3f8', color: '#8892a4' },
}
const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  nao_critica:  { bg: '#f1f3f8', color: '#8892a4' },
  pouco_critica:{ bg: '#eef3ff', color: '#3b5bdb' },
  critica:      { bg: '#fff8e6', color: '#92400e' },
  muito_critica:{ bg: '#fdecea', color: '#b91c1c' },
}
const SLA_STYLE: Record<string, { bg: string; color: string }> = {
  ok:       { bg: '#eaf5ee', color: '#1a7c3e' },
  atencao:  { bg: '#fff8e6', color: '#92400e' },
  vencido:  { bg: '#fdecea', color: '#b91c1c' },
  sem_prazo:{ bg: '#f1f3f8', color: '#8892a4' },
}

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusFilter } = await searchParams
  const { client: supabase, tenantId } = await createClientForTenant()

  let ticketsQ = supabase.from('tickets').select('id, ticket_number, subject, status, priority, requester_name, contract_id, sla_due_at, resolved_at, created_at').order('created_at', { ascending: false })
  if (tenantId) ticketsQ = ticketsQ.eq('tenant_id', tenantId)
  const { data: tickets } = await ticketsQ

  const contractIds = [...new Set((tickets ?? []).map(t => t.contract_id).filter((id): id is string => !!id))]
  const { data: linkedContracts } = contractIds.length
    ? await supabase.from('contracts').select('id, client_name').in('id', contractIds)
    : { data: [] as { id: string; client_name: string }[] }
  const contractNameById = new Map((linkedContracts ?? []).map(c => [c.id, c.client_name]))

  const countByStatus: Record<string, number> = {}
  for (const t of tickets ?? []) countByStatus[t.status] = (countByStatus[t.status] ?? 0) + 1

  const filtered = statusFilter ? (tickets ?? []).filter(t => t.status === statusFilter) : tickets ?? []
  const slaWeight: Record<string, number> = { vencido: 0, atencao: 1, ok: 2, sem_prazo: 3 }
  const sorted = [...filtered].sort((a, b) => slaWeight[getSlaStatus(a.sla_due_at, a.resolved_at)] - slaWeight[getSlaStatus(b.sla_due_at, b.resolved_at)])

  const total = tickets?.length ?? 0
  const abertos = countByStatus['aberto'] ?? 0
  const vencidos = (tickets ?? []).filter(t => getSlaStatus(t.sla_due_at, t.resolved_at) === 'vencido').length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1B556B] tracking-tight">Atendimento & Tickets</h1>
          <p className="text-xs text-gray-400 mt-0.5">Ordenado por urgência do prazo (SLA vencido primeiro).</p>
        </div>
        <div className="flex gap-2">
          <Link href="/tickets/dashboard" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 no-underline">📊 Dashboard</Link>
          <a href="/suporte" target="_blank" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 no-underline">🔗 Formulário</a>
          <Link href="/tickets/new" className="px-4 py-2 text-xs font-medium rounded-xl bg-[#1B556B] text-white no-underline">+ Novo Ticket</Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total de tickets', value: String(total), sub: 'histórico completo', alert: false },
          { label: 'Abertos', value: String(abertos), sub: 'aguardando resolução', alert: false },
          { label: 'SLA vencido', value: String(vencidos), sub: vencidos > 0 ? '⚠ ação necessária' : 'tudo em dia', alert: vencidos > 0 },
          { label: 'Resolvidos', value: String(countByStatus['resolvido'] ?? 0), sub: 'neste período', alert: false },
        ].map(k => (
          <div key={k.label} className={`rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]${k.alert ? ' ring-1 ring-red-200' : ''}`}>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">{k.label}</p>
            <p className={`text-3xl font-bold tracking-tight${k.alert ? ' text-red-600' : ' text-[#1B556B]'}`}>{k.value}</p>
            <p className={`text-xs mt-1${k.alert ? ' text-red-500' : ' text-gray-400'}`}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-gray-100 flex-wrap">
          <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1">
            <Link href="/tickets" className={!statusFilter ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline' : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
              Todos ({total})
            </Link>
            {STATUS_ORDER.map(s => (
              <Link key={s} href={`/tickets?status=${s}`} className={statusFilter === s ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline' : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
                {STATUS_LABELS[s]} ({countByStatus[s] ?? 0})
              </Link>
            ))}
          </div>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              {['Ticket', 'Conta', 'Solicitante', 'Prioridade', 'Status', 'SLA', 'Aberto em'].map((h, i) => (
                <th key={h} className={`text-xs font-medium uppercase tracking-wider text-gray-400 py-3 px-4 ${i === 6 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => {
              const sla = getSlaStatus(t.sla_due_at, t.resolved_at)
              const slaSt = SLA_STYLE[sla] ?? SLA_STYLE.sem_prazo
              const statusSt = STATUS_STYLE[t.status] ?? STATUS_STYLE.aberto
              const priSt = PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.nao_critica
              return (
                <tr key={t.id} className="border-b border-gray-50">
                  <td className="py-3 px-4">
                    <Link href={`/tickets/${t.id}`} className="no-underline">
                      <p className="text-sm font-medium text-gray-800 m-0">{t.subject}</p>
                      <p className="text-xs font-mono text-gray-300 mt-0.5">{t.ticket_number}</p>
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {t.contract_id ? (
                      <Link href={`/contracts/${t.contract_id}`} className="text-[#1B556B] no-underline">{contractNameById.get(t.contract_id) ?? '—'}</Link>
                    ) : <span className="text-xs text-amber-500">⚠ Sem vínculo</span>}
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-600">{t.requester_name}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex px-2.5 py-1 rounded-xl text-xs font-medium" style={{ background: priSt.bg, color: priSt.color }}>
                      {PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS]}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex px-2.5 py-1 rounded-xl text-xs font-medium" style={{ background: statusSt.bg, color: statusSt.color }}>
                      {STATUS_LABELS[t.status]}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex px-2.5 py-1 rounded-xl text-xs font-medium" style={{ background: slaSt.bg, color: slaSt.color }}>
                      {SLA_LABELS[sla]}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-xs text-gray-400">{new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="py-12 px-4 text-center text-sm text-gray-400">Nenhum ticket nessa categoria.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
