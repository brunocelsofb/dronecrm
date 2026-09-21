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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Atendimento & Tickets</h1>
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Ordenado por urgência do prazo (SLA vencido primeiro).</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/tickets/dashboard" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>📊 Dashboard</Link>
          <a href="/suporte" target="_blank" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>🔗 Formulário</a>
          <Link href="/tickets/new" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, background: '#1a1f36', color: '#fff', textDecoration: 'none', fontWeight: 500 }}>+ Novo Ticket</Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total de tickets', value: String(total), sub: 'histórico completo' },
          { label: 'Abertos', value: String(abertos), sub: 'aguardando resolução' },
          { label: 'SLA vencido', value: String(vencidos), sub: vencidos > 0 ? '⚠ ação necessária' : 'tudo em dia', alert: vencidos > 0 },
          { label: 'Resolvidos', value: String(countByStatus['resolvido'] ?? 0), sub: 'neste período' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: `0.5px solid ${k.alert ? '#fca5a5' : '#e8edf5'}` }}>
            <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 20, fontWeight: 500, color: k.alert ? '#b91c1c' : '#1a1f36', letterSpacing: '-0.5px' }}>{k.value}</p>
            <p style={{ fontSize: 11, color: k.alert ? '#b91c1c' : '#8892a4', marginTop: 3 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8', flexWrap: 'wrap' }}>
          <Link href="/tickets" style={{ padding: '4px 12px', fontSize: 11, borderRadius: 20, textDecoration: 'none', border: '0.5px solid', borderColor: !statusFilter ? '#1a1f36' : '#d1d8e8', background: !statusFilter ? '#1a1f36' : '#fff', color: !statusFilter ? '#fff' : '#8892a4' }}>
            Todos ({total})
          </Link>
          {STATUS_ORDER.map(s => (
            <Link key={s} href={`/tickets?status=${s}`} style={{ padding: '4px 12px', fontSize: 11, borderRadius: 20, textDecoration: 'none', border: '0.5px solid', borderColor: statusFilter === s ? '#1a1f36' : '#d1d8e8', background: statusFilter === s ? '#1a1f36' : '#fff', color: statusFilter === s ? '#fff' : '#8892a4' }}>
              {STATUS_LABELS[s]} ({countByStatus[s] ?? 0})
            </Link>
          ))}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Ticket', 'Conta', 'Solicitante', 'Prioridade', 'Status', 'SLA', 'Aberto em'].map((h, i) => (
                <th key={h} style={{ padding: '10px 16px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: i === 6 ? 'right' : 'left', borderBottom: '0.5px solid #f1f3f8' }}>{h}</th>
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
                <tr key={t.id} style={{ borderBottom: '0.5px solid #f8f9fb' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <Link href={`/tickets/${t.id}`} style={{ textDecoration: 'none' }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{t.subject}</p>
                      <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#b0b8c8', marginTop: 2 }}>{t.ticket_number}</p>
                    </Link>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12 }}>
                    {t.contract_id ? (
                      <Link href={`/contracts/${t.contract_id}`} style={{ color: '#4f86f7', textDecoration: 'none' }}>{contractNameById.get(t.contract_id) ?? '—'}</Link>
                    ) : <span style={{ fontSize: 11, color: '#f59e0b' }}>⚠ Sem vínculo</span>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#52514e' }}>{t.requester_name}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: priSt.bg, color: priSt.color }}>
                      {PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS]}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: statusSt.bg, color: statusSt.color }}>
                      {STATUS_LABELS[t.status]}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: slaSt.bg, color: slaSt.color }}>
                      {SLA_LABELS[sla]}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11, color: '#8892a4' }}>{new Date(t.created_at).toLocaleDateString('pt-BR')}</td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', fontSize: 13, color: '#8892a4' }}>Nenhum ticket nessa categoria.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
