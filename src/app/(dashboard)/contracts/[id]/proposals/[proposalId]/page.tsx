import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ProposalPageOrderEditor } from '@/components/proposals/proposal-page-order-editor'
import { ProposalApprovalPanel } from '@/components/proposals/proposal-approval-panel'
import { CopyLinkButton } from '@/components/nps/copy-link-button'
import { NewVersionButton } from '@/components/proposals/new-version-button'
import { ProposalContentBlocksEditor } from '@/components/proposals/proposal-content-blocks-editor'
import { ProposalItemsEditor } from '@/components/proposals/proposal-items-editor'
import { readApresentacao } from '@/lib/proposals/price-sections'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  pending_technical: 'Aguardando pré-aprovação técnica',
  pending_commercial: 'Aguardando aprovação comercial',
  declined_internal: 'Declinada internamente',
  pending_client: 'Aguardando o cliente',
  approved: 'Aprovada pelo cliente',
  declined_client: 'Declinada pelo cliente',
}

function fmt(v: number, currency: string) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v)
  } catch {
    return `${currency} ${v.toFixed(2)}`
  }
}

export default async function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string; proposalId: string }>
}) {
  const { id: contractId, proposalId } = await params
  const supabase = await createClient()

  const [{ data: proposal }, { data: items }, { data: pages }, { data: templates }, { data: approvals }, { data: allProfiles }, { data: contentBlocks }] = await Promise.all([
    supabase.from('proposals').select('*').eq('id', proposalId).maybeSingle(),
    supabase.from('proposal_items').select('*').eq('proposal_id', proposalId).order('position'),
    supabase.from('proposal_pages').select('template_id, is_standard_proposal').eq('proposal_id', proposalId).order('position'),
    supabase.from('proposal_templates').select('id, name'),
    supabase.from('proposal_approvals').select('*').eq('proposal_id', proposalId).order('decided_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, department'),
    supabase.from('proposal_content_blocks').select('id, block_type, image_storage_path, table_data, header_color, image_size, introduction, show_totals, text_align, source, section_key, title').eq('proposal_id', proposalId).order('position'),
  ])

  if (!proposal) notFound()

  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'

  const total = (items ?? []).reduce((sum, it) => sum + Number(it.subtotal), 0)
  const canEditPages = proposal.status === 'draft'

  // Modo leitura para propostas finalizadas (novo ou legado)
  const READONLY_STATUSES = ['cliente_aprovado', 'cliente_recusado', 'declinada']
  const READONLY_LEGACY   = ['approved', 'declined_client', 'declined_internal']
  const isReadOnly = READONLY_STATUSES.includes(proposal.workflow_status ?? '')
    || READONLY_LEGACY.includes(proposal.status ?? '')

  const profileById = new Map((allProfiles ?? []).map((p) => [p.id, p.full_name]))
  const technicalUsers = (allProfiles ?? []).filter((p) => p.department === 'tecnico').map((p) => ({ id: p.id, full_name: p.full_name }))
  const commercialUsers = (allProfiles ?? []).filter((p) => p.department === 'comercial').map((p) => ({ id: p.id, full_name: p.full_name }))

  const canCreateNewVersion = proposal.status === 'declined_internal' || proposal.status === 'declined_client' || proposal.status === 'approved'
  const publicLink = `${protocol}://${host}/proposal/${proposal.token}`

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/contracts/${contractId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">
        ← Voltar para a oportunidade
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{proposal.control_code}</h1>
          <p className="text-sm text-gray-500">Versão {proposal.version} · {STATUS_LABELS[proposal.status]}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <a
            href={`/api/proposals/${proposal.id}/preview`}
            target="_blank"
            className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
          >
            🔍 Pré-visualizar PDF
          </a>
          {proposal.pdf_storage_path && (
            <a
              href={`/api/proposals/${proposal.id}/pdf`}
              target="_blank"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              📄 Ver PDF enviado ao cliente
            </a>
          )}
          {canCreateNewVersion && <NewVersionButton proposalId={proposal.id} contractId={contractId} />}
        </div>
      </div>

      {proposal.token && proposal.status === 'pending_client' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs font-medium text-blue-800">Link público de aprovação (cliente) — ainda não foi enviado automaticamente, copie e mande você mesmo</p>
          <div className="mt-1.5 flex items-center gap-2">
            <input readOnly value={publicLink} className="flex-1 truncate rounded-md border border-blue-200 bg-white px-2 py-1 font-mono text-xs text-blue-700" />
            <CopyLinkButton link={publicLink} />
          </div>
        </div>
      )}

      {isReadOnly && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          🔒 <strong>Modo somente leitura</strong> — esta proposta está encerrada. Nenhuma alteração é permitida.
        </div>
      )}

      {!isReadOnly && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-900">Montagem do documento</h2>
          {canEditPages ? (
            <ProposalPageOrderEditor
              proposalId={proposal.id}
              contractId={contractId}
              templates={templates ?? []}
              initialPages={pages ?? []}
            />
          ) : (
            <p className="text-sm text-gray-400">A montagem não pode mais ser alterada (a proposta já saiu do rascunho).</p>
          )}
        </div>
      )}

      {!isReadOnly && (
        <>
          <ProposalItemsEditor
            proposalId={proposal.id}
            contractId={contractId}
            initialItems={items ?? []}
            initialConditions={{
              discount_type: proposal.discount_type ?? null,
              discount_value: Number(proposal.discount_value) ?? 0,
              payment_terms: proposal.payment_terms ?? null,
              installments: proposal.installments ?? 1,
              is_recurring: proposal.is_recurring ?? false,
              currency: proposal.currency ?? 'BRL',
            }}
            canEdit={canEditPages}
          />

          <ProposalContentBlocksEditor
            proposalId={proposal.id}
            contractId={contractId}
            initialBlocks={contentBlocks ?? []}
            canEdit={canEditPages}
            hasPriceApresentacao={!!readApresentacao(proposal.technical_snapshot)}
            hiddenPriceSections={(proposal.price_sections_hidden ?? []).length}
          />
        </>
      )}

      {/* Histórico de decisões do sistema legado — mantido para auditoria */}
      {approvals && approvals.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-900">Histórico de decisões (lastro)</h2>
          <div className="space-y-1.5">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    {a.stage === 'technical' ? 'Técnico' : a.stage === 'commercial' ? 'Comercial' : 'Cliente'} —{' '}
                    <span className={a.decision === 'approved' ? 'text-positive-700' : 'text-negative-700'}>
                      {a.decision === 'approved' ? 'Aprovou' : 'Declinou'}
                    </span>
                  </span>
                  <span className="text-xs text-gray-400">{new Date(a.decided_at).toLocaleString('pt-BR')}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Por: <span className="font-medium text-gray-700">{a.decided_by ? profileById.get(a.decided_by) ?? 'Usuário removido' : 'Cliente (externo)'}</span>
                </p>
                <p className="mt-1 text-gray-600">&ldquo;{a.comment}&rdquo;</p>
                {a.signer_name && (
                  <p className="mt-1 text-xs text-gray-400">
                    Assinado por {a.signer_name} ({a.signer_role}) — {a.signer_email} · {a.signer_phone} · CPF {a.signer_cpf}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
