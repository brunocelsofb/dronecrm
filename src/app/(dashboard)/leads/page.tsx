import Link from 'next/link'
import { createClientForTenant } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/role'
import { DeleteLeadButton } from '@/components/leads/delete-lead-button'

const STATUS_LABELS: Record<string, string> = { novo: 'Novo', em_qualificacao: 'Em Qualificação', qualificado: 'Qualificado', descartado: 'Descartado', convertido: 'Convertido' }
const STATUS_ORDER = ['novo', 'em_qualificacao', 'qualificado', 'convertido', 'descartado']
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  novo:            { bg: '#eef3ff', color: '#3b5bdb' },
  em_qualificacao: { bg: '#fff8e6', color: '#92400e' },
  qualificado:     { bg: '#eaf5ee', color: '#1a7c3e' },
  convertido:      { bg: '#f0eeff', color: '#5f38c9' },
  descartado:      { bg: '#f1f3f8', color: '#8892a4' },
}
const SOURCE_LABELS: Record<string, string> = { indicacao: 'Indicação', evento: 'Evento', formulario_site: 'Site', ligacao: 'Ligação', anuncio: 'Anúncio', manual: 'Manual', whatsapp: 'WhatsApp', outro: 'Outro' }

function scoreBar(score: number) {
  const colorClass = score >= 60 ? '#1a7c3e' : score >= 30 ? '#f59e0b' : '#d1d8e8'
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="w-12 h-1 rounded-sm bg-gray-100 overflow-hidden">
        <div className="h-full rounded-sm" style={{ width: `${Math.min(100, score)}%`, background: colorClass }} />
      </div>
      <span className="text-xs font-medium min-w-[24px] text-right" style={{ color: colorClass }}>{score}</span>
    </div>
  )
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusFilter } = await searchParams
  const { client: supabase, tenantId } = await createClientForTenant()
  const profile = await getCurrentProfile()
  const isAdmin = profile?.role === 'admin'

  let leadsQ = supabase.from('leads').select('id, name, email, phone, company_name, status, score, source, created_at').order('score', { ascending: false })
  if (tenantId) leadsQ = leadsQ.eq('tenant_id', tenantId)
  const { data: leads } = await leadsQ

  const filtered = statusFilter ? (leads ?? []).filter(l => l.status === statusFilter) : leads ?? []
  const countByStatus: Record<string, number> = {}
  for (const l of leads ?? []) countByStatus[l.status] = (countByStatus[l.status] ?? 0) + 1

  const totalLeads = leads?.length ?? 0
  const qualificados = countByStatus['qualificado'] ?? 0
  const convertidos = countByStatus['convertido'] ?? 0
  const avgScore = totalLeads > 0 ? Math.round((leads ?? []).reduce((s, l) => s + l.score, 0) / totalLeads) : 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1B556B] tracking-tight">Leads & Captação</h1>
          <p className="text-xs text-gray-400 mt-0.5">Qualifique e converta quando fizer sentido.</p>
        </div>
        <div className="flex gap-2">
          <a href="/captura" target="_blank" className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white text-gray-600 no-underline">
            🔗 Formulário público
          </a>
          <Link href="/leads/new" className="px-4 py-2 text-xs font-medium rounded-xl bg-[#1B556B] text-white no-underline">
            + Novo Lead
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total de leads', value: String(totalLeads), sub: 'captados até hoje' },
          { label: 'Qualificados', value: String(qualificados), sub: 'prontos pra converter' },
          { label: 'Convertidos', value: String(convertidos), sub: 'viraram oportunidade' },
          { label: 'Score médio', value: String(avgScore), sub: 'pontuação média' },
        ].map(k => (
          <div key={k.label} className="rounded-3xl p-5 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-3">{k.label}</p>
            <p className="text-3xl font-bold text-[#1B556B] tracking-tight">{k.value}</p>
            <p className="text-xs text-gray-400 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl bg-white shadow-[0_2px_16px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center gap-2 p-4 border-b border-gray-100 flex-wrap">
          <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1">
            <Link href="/leads" className={!statusFilter ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline' : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
              Todos ({totalLeads})
            </Link>
            {STATUS_ORDER.map(s => (
              <Link key={s} href={`/leads?status=${s}`} className={statusFilter === s ? 'px-3.5 py-1.5 text-xs font-medium rounded-xl bg-[#1B556B] text-white shadow-sm no-underline' : 'px-3.5 py-1.5 text-xs font-medium rounded-xl text-gray-500 hover:text-gray-700 no-underline'}>
                {STATUS_LABELS[s]} ({countByStatus[s] ?? 0})
              </Link>
            ))}
          </div>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              {['Nome / contato', 'Empresa', 'Origem', 'Status', 'Pontuação', 'Recebido', ''].map((h, i) => (
                <th key={h + i} className={`text-xs font-medium uppercase tracking-wider text-gray-400 py-3 px-4 ${i >= 4 && i < 6 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(lead => {
              const st = STATUS_STYLE[lead.status] ?? STATUS_STYLE.novo
              return (
                <tr key={lead.id} className="border-b border-gray-50">
                  <td className="py-3 px-4">
                    <Link href={`/leads/${lead.id}`} className="no-underline">
                      <p className="text-sm font-medium text-gray-800 m-0">{lead.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{lead.email ?? lead.phone ?? '—'}</p>
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-600">{lead.company_name ?? '—'}</td>
                  <td className="py-3 px-4 text-xs text-gray-400">{SOURCE_LABELS[lead.source ?? ''] ?? lead.source ?? 'Manual'}</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex px-2.5 py-1 rounded-xl text-xs font-medium" style={{ background: st.bg, color: st.color }}>
                      {STATUS_LABELS[lead.status]}
                    </span>
                  </td>
                  <td className="py-3 px-4">{scoreBar(lead.score)}</td>
                  <td className="py-3 px-4 text-right text-xs text-gray-400">{new Date(lead.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="py-3 px-4">
                    {isAdmin && <DeleteLeadButton leadId={lead.id} leadName={lead.name} />}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="py-12 px-4 text-center text-sm text-gray-400">Nenhum lead nessa categoria ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
