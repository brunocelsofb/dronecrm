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
  const color = score >= 60 ? '#1a7c3e' : score >= 30 ? '#f59e0b' : '#d1d8e8'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
      <div style={{ width: 48, height: 4, borderRadius: 2, background: '#f1f3f8', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, score)}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 500, color, minWidth: 24, textAlign: 'right' }}>{score}</span>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', margin: 0 }}>Leads & Captação</h1>
          <p style={{ fontSize: 12, color: '#8892a4', marginTop: 3 }}>Qualifique e converta quando fizer sentido.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/captura" target="_blank" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>
            🔗 Formulário público
          </a>
          <Link href="/leads/new" style={{ padding: '7px 14px', fontSize: 12, borderRadius: 8, background: '#1a1f36', color: '#fff', textDecoration: 'none', fontWeight: 500 }}>
            + Novo Lead
          </Link>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total de leads', value: String(totalLeads), sub: 'captados até hoje' },
          { label: 'Qualificados', value: String(qualificados), sub: 'prontos pra converter' },
          { label: 'Convertidos', value: String(convertidos), sub: 'viraram oportunidade' },
          { label: 'Score médio', value: String(avgScore), sub: 'pontuação média' },
        ].map(k => (
          <div key={k.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '0.5px solid #e8edf5' }}>
            <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>{k.label}</p>
            <p style={{ fontSize: 20, fontWeight: 500, color: '#1a1f36', letterSpacing: '-0.5px' }}>{k.value}</p>
            <p style={{ fontSize: 11, color: '#8892a4', marginTop: 3 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '0.5px solid #f1f3f8', flexWrap: 'wrap' }}>
          <Link href="/leads" style={{ padding: '4px 12px', fontSize: 11, borderRadius: 20, textDecoration: 'none', border: '0.5px solid', borderColor: !statusFilter ? '#1a1f36' : '#d1d8e8', background: !statusFilter ? '#1a1f36' : '#fff', color: !statusFilter ? '#fff' : '#8892a4' }}>
            Todos ({totalLeads})
          </Link>
          {STATUS_ORDER.map(s => (
            <Link key={s} href={`/leads?status=${s}`} style={{ padding: '4px 12px', fontSize: 11, borderRadius: 20, textDecoration: 'none', border: '0.5px solid', borderColor: statusFilter === s ? '#1a1f36' : '#d1d8e8', background: statusFilter === s ? '#1a1f36' : '#fff', color: statusFilter === s ? '#fff' : '#8892a4' }}>
              {STATUS_LABELS[s]} ({countByStatus[s] ?? 0})
            </Link>
          ))}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Nome / contato', 'Empresa', 'Origem', 'Status', 'Pontuação', 'Recebido', ''].map((h, i) => (
                <th key={h + i} style={{ padding: '10px 16px', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', fontWeight: 500, textAlign: i >= 4 && i < 6 ? 'right' : 'left', borderBottom: '0.5px solid #f1f3f8' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(lead => {
              const st = STATUS_STYLE[lead.status] ?? STATUS_STYLE.novo
              return (
                <tr key={lead.id} style={{ borderBottom: '0.5px solid #f8f9fb' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <Link href={`/leads/${lead.id}`} style={{ textDecoration: 'none' }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{lead.name}</p>
                      <p style={{ fontSize: 11, color: '#8892a4', marginTop: 2 }}>{lead.email ?? lead.phone ?? '—'}</p>
                    </Link>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#52514e' }}>{lead.company_name ?? '—'}</td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#8892a4' }}>{SOURCE_LABELS[lead.source ?? ''] ?? lead.source ?? 'Manual'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-flex', padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500, background: st.bg, color: st.color }}>
                      {STATUS_LABELS[lead.status]}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>{scoreBar(lead.score)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 11, color: '#8892a4' }}>{new Date(lead.created_at).toLocaleDateString('pt-BR')}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {isAdmin && <DeleteLeadButton leadId={lead.id} leadName={lead.name} />}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', fontSize: 13, color: '#8892a4' }}>Nenhum lead nessa categoria ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
