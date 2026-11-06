// Dimensionamento técnico da proposta — para a aprovação técnica, SEM nenhum valor financeiro.
// Os dados saem do servidor já filtrados: o navegador do aprovador não recebe preço, custo ou margem.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TechnicalDocument } from '@/components/proposals/technical-document'
import { readApresentacao } from '@/lib/proposals/price-sections'

// Seções da Apresentação do Price que são dimensionamento (nunca investimento/resumo)
const TECH_SECTIONS = ['objeto', 'escopo', 'equipe', 'sla', 'intervencoes', 'diretrizes']

const STATUS: Record<string, string> = {
  rascunho: 'Rascunho', em_aprovacao_tecnica: 'Em análise técnica', aprovado_tecnico: 'Aprovada tecnicamente',
  reprovado_tecnico: 'Reprovada na análise técnica', em_aprovacao_comercial: 'Em aprovação comercial',
  aprovado_comercial: 'Aprovada comercialmente', cliente_aprovado: 'Aprovada pelo cliente',
  cliente_recusado: 'Recusada pelo cliente', declinada: 'Declinada',
}

type Snap = Record<string, unknown> & {
  clientName?: string; projectName?: string; tipoEngenharia?: string; hospitalBeds?: number
  escopoServicos?: string[]; professionals?: { role: string; quantity: number; contractType: string; hoursPerMonth: number }[]
  totalFTE?: number; cltCount?: number; pjCount?: number; dimensionamento?: unknown; sentAt?: string
}

export default async function TechnicalReviewPage({ params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id: contractId, proposalId } = await params
  const supabase = await createClient()
  const [{ data: proposal }, { data: contract }] = await Promise.all([
    supabase.from('proposals').select('id, control_code, version, workflow_status, technical_snapshot, technical_comment, technical_restrictions')
      .eq('id', proposalId).eq('contract_id', contractId).maybeSingle(),
    supabase.from('contracts').select('client_name, title').eq('id', contractId).maybeSingle(),
  ])
  if (!proposal) notFound()

  const raw = (proposal.technical_snapshot ?? null) as Snap | null
  // Só campos técnicos (lista fechada): nada de receita, preço, margem ou estado completo do Price
  const snap = raw ? {
    clientName: raw.clientName ?? contract?.client_name ?? '', projectName: raw.projectName ?? '',
    tipoEngenharia: raw.tipoEngenharia ?? '', hospitalBeds: Number(raw.hospitalBeds) || 0,
    escopoServicos: raw.escopoServicos ?? [],
    professionals: (raw.professionals ?? []).map(p => ({ role: p.role, quantity: p.quantity, contractType: p.contractType, hoursPerMonth: p.hoursPerMonth })),
    totalFTE: Number(raw.totalFTE) || 0, cltCount: Number(raw.cltCount) || 0, pjCount: Number(raw.pjCount) || 0,
    dimensionamento: raw.dimensionamento as never, sentAt: raw.sentAt ?? '',
  } : null
  const secoes = (readApresentacao(raw)?.secoes ?? []).filter(s => TECH_SECTIONS.includes(s.chave))
  const isHospitalar = (snap?.tipoEngenharia ?? '').toLowerCase().includes('hospitalar')

  return (
    <div className="max-w-3xl space-y-5">
      <Link href={`/contracts/${contractId}?tab=proposta&proposta=${proposalId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">
        ← Voltar para a proposta
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Dimensionamento técnico — {proposal.control_code}</h1>
        <p className="text-sm text-gray-500">
          {contract?.client_name ?? ''} · Versão {proposal.version} · {STATUS[proposal.workflow_status ?? 'rascunho'] ?? proposal.workflow_status}
        </p>
        <p className="mt-1 text-xs text-gray-400">Só o dimensionamento, sem valores. O parecer (aprovar ou reprovar) é registrado na proposta.</p>
      </div>

      {snap ? (
        <TechnicalDocument snapshot={snap as never} showFinancials={false} isHospitalar={isHospitalar} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          Ainda não há dimensionamento: o Price não enviou a precificação desta proposta.
        </div>
      )}

      {secoes.map(s => (
        <div key={s.chave} className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-brand-700">{s.titulo}</h2>
          {s.texto && <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{s.texto.replace(/\*\*(.+?)\*\*/g, '$1')}</p>}
          {s.tabela && s.tabela.length > 1 && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead><tr className="bg-gray-50">{s.tabela[0].map((h, i) => <th key={i} className="px-2 py-1.5 text-left font-semibold text-gray-600">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {s.tabela.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="px-2 py-1.5 text-gray-700">{c}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {(proposal.technical_comment || proposal.technical_restrictions) && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Parecer técnico registrado</h2>
          {proposal.technical_comment && <p className="mt-1 text-sm text-gray-700">{proposal.technical_comment}</p>}
          {proposal.technical_restrictions && <p className="mt-2 text-sm text-gray-700"><b>Restrições:</b> {proposal.technical_restrictions}</p>}
        </div>
      )}
    </div>
  )
}
