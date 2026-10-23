'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ProposalRow = {
  id: string
  control_code: string
  version: number
  workflow_status: string | null
  proposal_value: number | null
  created_at: string
  updated_at: string | null
  proposal_validity_days: number | null
  status: string
  technical_snapshot?: any
  review_token?: string | null
  client_review_token?: string | null
  submitted_at?: string | null
  submitted_by_name?: string | null
  technical_approved_at?: string | null
  technical_approved_by_name?: string | null
  technical_approved_by_role?: string | null
  technical_comment?: string | null
  technical_restrictions?: string | null
  commercial_approved_at?: string | null
  commercial_approved_by_name?: string | null
  commercial_approved_by_role?: string | null
  client_status?: string | null
  client_approved_at?: string | null
  client_approved_by_name?: string | null
  texto_objetivos?: string | null
  texto_atividades?: string | null
  texto_estrutura_apoio?: string | null
}

type Props = {
  contractId: string
  proposals: ProposalRow[]
  priceUrl: string
  currentUserRole: string
  currentUserName: string
  catalogItems: any[]
}

function fmt(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR')
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  rascunho:               { label: 'Rascunho',             color: '#52514e', bg: '#f1f3f8' },
  em_aprovacao_tecnica:   { label: 'Análise Técnica',      color: '#c2683d', bg: '#fbeee5' },
  aprovado_tecnico:       { label: 'OK Técnico',           color: '#524e9c', bg: '#e8e7f4' },
  reprovado_tecnico:      { label: 'Reprovado',            color: '#8e4550', bg: '#f6e9ea' },
  em_aprovacao_comercial: { label: 'Aprov. Comercial',     color: '#c2683d', bg: '#fbeee5' },
  aprovado_comercial:     { label: 'Aguardando Cliente',   color: '#1f8c7d', bg: '#e3f5f1' },
  cliente_aprovado:       { label: '✅ Cliente Aprovou',   color: '#166534', bg: '#dcfce7' },
  cliente_recusado:       { label: '❌ Cliente Recusou',   color: '#8e4550', bg: '#f6e9ea' },
  declinada:              { label: '🚫 Declinada',         color: '#6b7280', bg: '#f3f4f6' },
}

// Bug 2: Reabrir só quando status final E cliente já interagiu (CPF preenchido)
const REOPEN_STATUSES = ['cliente_aprovado', 'cliente_recusado', 'declinada']

// Dropdown de ações por proposta
function ActionsMenu({
  proposal, onEdit, onDelete, onReopen, onDecline, contractId, currentUserRole, currentUserName
}: {
  proposal: ProposalRow
  onEdit: () => void
  onDelete: () => void
  onReopen: () => void
  onDecline: () => void
  contractId: string
  currentUserRole: string
  currentUserName: string
}) {
  const [open, setOpen] = useState(false)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const wStatus = proposal.workflow_status ?? 'rascunho'

  // Regra 2: proposta aprovada = documento fechado
  const isApproved   = wStatus === 'cliente_aprovado'
  // Regra 3: aguardando cliente = pode editar mas não reabrir
  const isDeclined   = wStatus === 'cliente_recusado' || wStatus === 'declinada'
  // Reabrir: declinada interna não exige client_approved_by_name
  const canReopen    = (isApproved || isDeclined) &&
    (wStatus === 'declinada' || !!proposal.client_approved_by_name)
  // Editar: bloqueado se aprovado (documento assinado)
  const canEdit      = !isApproved
  const publicToken  = proposal.client_review_token

  async function handleGeneratePdf() {
    setGeneratingPdf(true); setOpen(false)
    window.open(`/api/proposals/generate-pdf/${contractId}?proposal_id=${proposal.id}`, '_blank')
    setGeneratingPdf(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '5px 12px', fontSize: 11, fontWeight: 600,
          borderRadius: 6, border: '0.5px solid #d1d8e8',
          background: '#fff', color: '#1a1f36', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
        Ações <span style={{ fontSize: 9 }}>▾</span>
      </button>

      {open && (
        <>
          {/* Overlay para fechar */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50,
            background: '#fff', borderRadius: 10, border: '0.5px solid #e8edf5',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 180, overflow: 'hidden' }}>

            {/* Regra 2: aprovada = não editar; Regra 3: outros = pode editar */}
            {canEdit && (
              <MenuItem icon="✏️" label="Visualizar / Editar" onClick={() => { setOpen(false); onEdit() }} />
            )}
            {isApproved && (
              <MenuItem icon="👁️" label="Visualizar proposta assinada" onClick={() => { setOpen(false); onEdit() }} />
            )}

            {/* Declinar — propostas ativas que não foram aprovadas pelo cliente */}
            {!isApproved && !isDeclined && wStatus !== 'declinada' && ['admin', 'member', 'aprovador_comercial'].includes(currentUserRole) && (
              <MenuItem icon="🚫" label="Declinar proposta" onClick={() => { setOpen(false); onDecline() }} />
            )}

            {/* Reabrir */}
            {canReopen && ['admin', 'member', 'aprovador_comercial'].includes(currentUserRole) && (
              <MenuItem icon="🔄" label="Reabrir proposta" onClick={() => { setOpen(false); onReopen() }} />
            )}

            {/* Ver link público */}
            {publicToken && (
              <MenuItem icon="🔗" label="Ver link público" onClick={() => {
                setOpen(false)
                window.open(`${window.location.origin}/proposals/client/${publicToken}`, '_blank')
              }} />
            )}

            {/* Gerar PDF */}
            <MenuItem icon={generatingPdf ? '⏳' : '📄'} label="Gerar PDF" onClick={handleGeneratePdf} />

            {/* Excluir — só admin */}
            {currentUserRole === 'admin' && (
              <>
                <div style={{ height: '0.5px', background: '#f1f3f8', margin: '4px 0' }} />
                <MenuItem icon="🗑️" label="Excluir" onClick={() => { setOpen(false); onDelete() }} danger />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '9px 14px', fontSize: 12, fontWeight: 500, textAlign: 'left',
        background: hover ? (danger ? '#fef2f2' : '#f8f9fb') : 'transparent',
        border: 'none', cursor: 'pointer',
        color: danger ? '#8e4550' : '#1a1f36',
      }}>
      <span style={{ fontSize: 13 }}>{icon}</span> {label}
    </button>
  )
}

import { ProposalWorkflow } from './proposal-workflow'
import { ProposalTextsEditor } from './proposal-texts-editor'
import { ProposalsSection } from './proposals-section'

export function ProposalTab({ contractId, proposals, priceUrl, currentUserRole, currentUserName, catalogItems }: Props) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const selected = proposals.find(p => p.id === selectedId)

  async function handleNewProposal() {
    setCreating(true)
    const res = await fetch('/api/proposals/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract_id: contractId }),
    })
    const data = await res.json()
    if (data.id) {
      router.refresh()
      setTimeout(() => setSelectedId(data.id), 500)
    }
    setCreating(false)
  }

  async function handleDelete(id: string, code: string) {
    if (!confirm(`Excluir ${code}? Esta ação não pode ser desfeita.`)) return
    await fetch(`/api/proposals/${id}/delete`, { method: 'POST' })
    router.refresh()
  }

  const [declineModal, setDeclineModal] = useState<{ proposal: ProposalRow } | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [decliningId, setDecliningId] = useState<string | null>(null)

  async function handleDecline(p: ProposalRow) {
    setDeclineModal({ proposal: p })
    setDeclineReason('')
  }

  async function confirmDecline() {
    if (!declineModal) return
    const p = declineModal.proposal
    setDecliningId(p.id)
    await fetch(`/api/proposals/${p.id}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_name: currentUserName, reason: declineReason.trim() || null }),
    })
    setDeclineModal(null)
    setDecliningId(null)
    router.refresh()
  }

  async function handleReopen(p: ProposalRow) {
    if (!confirm(`Reabrir "${p.control_code}"? Os dados de assinatura do cliente serão apagados — a proposta precisará ser assinada novamente.`)) return

    // Volta para rascunho E limpa dados de assinatura (invalida assinatura anterior)
    await fetch(`/api/proposals/${p.id}/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_name: currentUserName }),
    })
    router.refresh()
  }

  // Vista de detalhes
  if (selectedId && selected) {
    const wStatus = selected.workflow_status ?? 'rascunho'
    const isReadOnly = ['cliente_aprovado', 'declinada', 'cliente_recusado'].includes(wStatus)
    const initialData = {
      status: (selected.workflow_status ?? 'rascunho') as any,
      proposal_value: selected.proposal_value,
      actor_name: null,
      updated_at: selected.updated_at,
      technical_snapshot: selected.technical_snapshot,
      review_token: selected.review_token,
      client_review_token: selected.client_review_token,
      submitted_at: selected.submitted_at,
      submitted_by_name: selected.submitted_by_name,
      technical_approved_at: selected.technical_approved_at,
      technical_approved_by_name: selected.technical_approved_by_name,
      technical_approved_by_role: selected.technical_approved_by_role,
      technical_comment: selected.technical_comment,
      technical_restrictions: selected.technical_restrictions,
      commercial_approved_at: selected.commercial_approved_at,
      commercial_approved_by_name: selected.commercial_approved_by_name,
      commercial_approved_by_role: selected.commercial_approved_by_role,
      client_status: selected.client_status,
      client_approved_at: selected.client_approved_at,
      client_approved_by_name: selected.client_approved_by_name,
    }

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1f36', margin: 0 }}>
              {selected.control_code}
            </p>
            <p style={{ fontSize: 12, color: '#8892a4', margin: '2px 0 0' }}>
              Criada em {fmtDate(selected.created_at)}
            </p>
          </div>
          <button onClick={() => setSelectedId(null)} style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 500,
            borderRadius: 8, border: '0.5px solid #d1d8e8',
            background: '#fff', color: '#52514e', cursor: 'pointer'
          }}>
            ← Voltar para lista
          </button>
        </div>

        {/* Banner somente leitura */}
        {isReadOnly && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
            borderRadius: 8, background: '#fffbeb', border: '0.5px solid #ffe596',
            marginBottom: 16, fontSize: 12, color: '#c2683d', fontWeight: 500,
          }}>
            🔒 Esta proposta está <strong style={{ marginLeft: 4 }}>
              {wStatus === 'cliente_aprovado' ? 'assinada pelo cliente' : 'encerrada'}
            </strong>. Modo somente leitura — consulte o histórico abaixo.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ProposalWorkflow
            key={`workflow-${selectedId}`}
            contractId={contractId}
            proposalId={selectedId}
            initialData={initialData}
            priceUrl={priceUrl}
            currentUserRole={isReadOnly ? 'aprovador_tecnico' : currentUserRole}
            currentUserName={currentUserName}
          />
          {!isReadOnly && currentUserRole !== 'aprovador_tecnico' && (
            <div id="montagem-proposta">
              <ProposalTextsEditor
                key={`texts-${selectedId}`}
                contractId={contractId}
                proposalId={selectedId}
                initialData={{
                  texto_objetivos: selected.texto_objetivos,
                  texto_atividades: selected.texto_atividades,
                  texto_estrutura_apoio: selected.texto_estrutura_apoio,
                }}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  // Lista
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1f36', margin: 0 }}>Propostas</p>
          <p style={{ fontSize: 12, color: '#8892a4', margin: '2px 0 0' }}>
            {proposals.length === 0 ? 'Nenhuma proposta criada ainda' : `${proposals.length} proposta${proposals.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => router.refresh()} title="Atualizar lista" style={{
            padding: '8px 12px', fontSize: 13, borderRadius: 8,
            border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer'
          }}>↻</button>
          <button onClick={handleNewProposal} disabled={creating} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            borderRadius: 8, border: 'none',
            background: '#1B556B', color: '#fff', cursor: creating ? 'not-allowed' : 'pointer',
            opacity: creating ? 0.7 : 1
          }}>
            {creating ? 'Criando...' : '+ Nova Proposta'}
          </button>
        </div>
      </div>

      {proposals.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '64px 24px', background: '#fff', borderRadius: 12,
          border: '0.5px dashed #d1d8e8', textAlign: 'center'
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1f36', margin: '0 0 6px' }}>Nenhuma proposta ainda</p>
          <p style={{ fontSize: 12, color: '#8892a4', margin: '0 0 20px', maxWidth: 320 }}>
            Crie uma proposta para iniciar o fluxo de aprovação técnica e comercial.
          </p>
          <button onClick={handleNewProposal} disabled={creating} style={{
            padding: '10px 24px', fontSize: 13, fontWeight: 600, borderRadius: 8,
            border: 'none', background: '#1B556B', color: '#fff', cursor: 'pointer'
          }}>
            {creating ? 'Criando...' : '+ Nova Proposta'}
          </button>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'visible' }}>
          <div className="hidden md:grid md:[grid-template-columns:140px_2fr_1fr_1fr_100px]" style={{
            padding: '10px 20px', background: '#f8f9fb', borderBottom: '0.5px solid #e8edf5',
            borderRadius: '12px 12px 0 0',
          }}>
            {['Código', 'Status', 'Data', 'Valor', 'Ações'].map((h, i) => (
              <span key={i} style={{ fontSize: 10, fontWeight: 700, color: '#b0b8c8', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{h}</span>
            ))}
          </div>

          {proposals.map(p => {
            const wStatus = p.workflow_status ?? 'rascunho'
            const s = STATUS_LABEL[wStatus] ?? STATUS_LABEL['rascunho']
            return (
              <div key={p.id} className="grid grid-cols-2 gap-2 md:gap-0 md:[grid-template-columns:140px_2fr_1fr_1fr_100px]" style={{
                padding: '14px 20px', borderBottom: '0.5px solid #f1f3f8', overflow: 'visible',
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#1a1f36', fontFamily: 'monospace', display: 'flex', alignItems: 'center' }}>
                  {p.control_code}
                </span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
                    {s.label}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: '#52514e', display: 'flex', alignItems: 'center' }}>
                  {p.updated_at ? fmtDate(p.updated_at) : fmtDate(p.created_at)}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1f8c7d', display: 'flex', alignItems: 'center' }}>
                  {p.proposal_value ? fmt(p.proposal_value) : '—'}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <ActionsMenu
                    proposal={p}
                    contractId={contractId}
                    currentUserRole={currentUserRole}
                    currentUserName={currentUserName}
                    onEdit={() => setSelectedId(p.id)}
                    onDelete={() => handleDelete(p.id, p.control_code)}
                    onReopen={() => handleReopen(p)}
                    onDecline={() => handleDecline(p)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de declínio */}
      {declineModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1f36', margin: '0 0 4px' }}>Declinar proposta</p>
            <p style={{ fontSize: 12, color: '#8892a4', margin: '0 0 16px' }}>{declineModal.proposal.control_code}</p>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#52514e', display: 'block', marginBottom: 6 }}>
              Motivo do cancelamento <span style={{ fontWeight: 400, color: '#b0b8c8' }}>(opcional)</span>
            </label>
            <textarea
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Ex: Cliente escolheu outro fornecedor, orçamento cortado..."
              rows={3}
              autoFocus
              style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '0.5px solid #d1d8e8', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeclineModal(null)} style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={confirmDecline} disabled={!!decliningId} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', background: '#8e4550', color: '#fff', cursor: 'pointer', opacity: decliningId ? 0.6 : 1 }}>
                {decliningId ? 'Declinando...' : 'Confirmar declínio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
