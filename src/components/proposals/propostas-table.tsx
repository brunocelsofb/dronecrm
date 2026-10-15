'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
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
  client_review_token: string | null
  client_approved_by_name: string | null
  contract_id: string
  contract_title: string
  pipeline_stage: string | null
  responsible: string
  mrr: number
  pontual: number
  item_summary: string
}

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  em_aprovacao_tecnica:   { label: 'Análise Téc.',     color: '#c2683d', bg: '#fbeee5' },
  aprovado_tecnico:       { label: 'OK Técnico',       color: '#524e9c', bg: '#e8e7f4' },
  reprovado_tecnico:      { label: 'Reprovado',        color: '#8e4550', bg: '#f6e9ea' },
  em_aprovacao_comercial: { label: 'Aprov. Comercial', color: '#c2683d', bg: '#fbeee5' },
  aprovado_comercial:     { label: 'Ag. Cliente',      color: '#1f8c7d', bg: '#e3f5f1' },
  cliente_aprovado:       { label: '✅ Aprovada',      color: '#166534', bg: '#dcfce7' },
  cliente_recusado:       { label: '❌ Recusada',      color: '#8e4550', bg: '#f6e9ea' },
  rascunho:               { label: 'Rascunho',         color: '#52514e', bg: '#f1f3f8' },
}

const FILTERS = [
  { key: 'all',                    label: 'Todas' },
  { key: 'cliente_aprovado',       label: '✅ Aprovadas' },
  { key: 'aprovado_comercial',     label: '⏳ Ag. Cliente' },
  { key: 'em_aprovacao_tecnica',   label: '🔧 Análise Téc.' },
  { key: 'em_aprovacao_comercial', label: '💼 Aprov. Comercial' },
  { key: 'cliente_recusado',       label: '❌ Recusadas' },
]

function fmt(v: number) {
  if (!v) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function validityDate(created: string, days: number | null) {
  if (!days) return null
  const d = new Date(created); d.setDate(d.getDate() + days); return d
}
function isExpired(created: string, days: number | null) {
  const v = validityDate(created, days); return v ? v < new Date() : false
}

function Item({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px',
        fontSize: 12, fontWeight: 500, textAlign: 'left', border: 'none', cursor: 'pointer',
        background: hov ? (danger ? '#fef2f2' : '#f8f9fb') : 'transparent', color: danger ? '#8e4550' : '#1a1f36' }}>
      <span>{icon}</span>{label}
    </button>
  )
}

function DropdownMenu({ p, currentUserRole }: { p: ProposalRow; currentUserRole: string }) {
  const router = useRouter()
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const wStatus    = p.workflow_status ?? 'rascunho'
  const isApproved = wStatus === 'cliente_aprovado'
  const isDeclined = wStatus === 'cliente_recusado'
  const canReopen  = (isApproved || isDeclined) && !!p.client_approved_by_name &&
    ['admin', 'member', 'aprovador_comercial'].includes(currentUserRole)

  function handleOpen() {
    if (menuPos) { setMenuPos(null); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }

  async function handleReopen() {
    setMenuPos(null)
    if (!confirm(`Reabrir ${p.control_code}? A assinatura será invalidada.`)) return
    await fetch(`/api/proposals/${p.id}/reopen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_name: 'Gestor' }),
    })
    router.refresh()
  }

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} onClick={handleOpen} style={{
        padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
        border: '0.5px solid #d1d8e8', background: '#fff', color: '#1a1f36',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
        Ações <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {menuPos && (
        <>
          <div onClick={() => setMenuPos(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999,
            background: '#fff', borderRadius: 10, border: '0.5px solid #e8edf5',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 190, overflow: 'hidden',
          }}>
            {!isApproved && (
              <Item icon="✏️" label="Ver na oportunidade"
                onClick={() => { setMenuPos(null); window.open(`/contracts/${p.contract_id}`, '_blank') }} />
            )}
            {isApproved && (
              <Item icon="👁️" label="Visualizar proposta assinada"
                onClick={() => { setMenuPos(null); window.open(`/contracts/${p.contract_id}/proposals/${p.id}`, '_blank') }} />
            )}
            {canReopen && <Item icon="🔄" label="Reabrir proposta" onClick={handleReopen} />}
            {p.client_review_token && (
              <Item icon="🔗" label="Ver link público"
                onClick={() => { setMenuPos(null); window.open(`/proposals/client/${p.client_review_token}`, '_blank') }} />
            )}
            <Item icon="📄" label="Gerar PDF"
              onClick={() => { setMenuPos(null); window.open(`/api/proposals/generate-pdf/${p.contract_id}?proposal_id=${p.id}`, '_blank') }} />
          </div>
        </>
      )}
    </div>
  )
}

export function PropostasTable({ proposals, currentUserRole }: { proposals: ProposalRow[]; currentUserRole: string }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const rows = proposals.filter(p => {
    const matchFilter = filter === 'all' || p.workflow_status === filter
    const q = search.toLowerCase()
    const matchSearch = !q || p.control_code.toLowerCase().includes(q) ||
      p.contract_title.toLowerCase().includes(q) || p.responsible.toLowerCase().includes(q) ||
      p.item_summary.toLowerCase().includes(q)
    return matchFilter && matchSearch
  })

  const th: React.CSSProperties = {
    padding: '10px 14px', fontSize: 10, fontWeight: 700, color: '#b0b8c8',
    textTransform: 'uppercase', letterSpacing: '0.8px', borderBottom: '0.5px solid #e8edf5',
    background: '#f8f9fb', whiteSpace: 'nowrap', textAlign: 'left',
  }
  const td: React.CSSProperties = {
    padding: '11px 14px', fontSize: 12, color: '#1a1f36',
    borderBottom: '0.5px solid #f1f3f8', verticalAlign: 'middle',
  }

  return (
    <div>
      {/* Filtros + busca */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0, background: '#f1f3f8', borderRadius: 8, padding: 3, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: '5px 11px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              background: filter === f.key ? '#fff' : 'transparent',
              color: filter === f.key ? '#1a1f36' : '#8892a4',
              boxShadow: filter === f.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}>{f.label}</button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar cliente, código, item..."
          style={{ flex: 1, minWidth: 200, padding: '7px 12px', fontSize: 12,
            borderRadius: 8, border: '0.5px solid #d1d8e8', outline: 'none' }} />
        <span style={{ fontSize: 11, color: '#b0b8c8', whiteSpace: 'nowrap' }}>
          {rows.length} resultado{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ borderRadius: 12, border: '0.5px solid #e8edf5', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
          <thead>
            <tr>
              <th style={th}>Status</th>
              <th style={th}>Código</th>
              <th style={th}>Oportunidade</th>
              <th style={th}>Etapa do Funil</th>
              <th style={th}>Itens</th>
              <th style={th}>Responsável</th>
              <th style={th}>Validade</th>
              <th style={{ ...th, textAlign: 'right' }}>MRR</th>
              <th style={{ ...th, textAlign: 'right' }}>P&S</th>
              <th style={{ ...th, textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ ...td, textAlign: 'center', color: '#b0b8c8', padding: '48px 0' }}>
                  Nenhuma proposta encontrada.
                </td>
              </tr>
            ) : rows.map(p => {
              const s = STATUS[p.workflow_status ?? 'rascunho'] ?? STATUS['rascunho']
              const expired = isExpired(p.created_at, p.proposal_validity_days)
              const vDate = validityDate(p.created_at, p.proposal_validity_days)
              const itemPreview = p.item_summary.length > 48
                ? p.item_summary.slice(0, 48) + '…'
                : p.item_summary || '—'

              return (
                <tr key={p.id} style={{ background: '#fff' }}
                  onMouseOver={e => (e.currentTarget.style.background = '#fafbfc')}
                  onMouseOut={e => (e.currentTarget.style.background = '#fff')}>
                  <td style={td}>
                    <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10,
                      fontWeight: 700, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
                      {s.label}
                    </span>
                  </td>
                  <td style={td}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1B556B' }}>
                      {p.control_code}
                    </span>
                  </td>
                  <td style={td}>
                    <Link href={`/contracts/${p.contract_id}`}
                      style={{ color: '#524e9c', textDecoration: 'none', fontWeight: 500, fontSize: 12 }}>
                      {p.contract_title}
                    </Link>
                  </td>
                  <td style={{ ...td, color: '#8892a4', fontSize: 11 }}>
                    {p.pipeline_stage ?? '—'}
                  </td>
                  <td style={{ ...td, color: '#52514e', maxWidth: 200 }}>
                    <span title={p.item_summary || undefined}>{itemPreview}</span>
                  </td>
                  <td style={{ ...td, color: '#52514e' }}>{p.responsible}</td>
                  <td style={td}>
                    {vDate ? (
                      <span style={{ color: expired ? '#8e4550' : '#52514e', fontWeight: expired ? 700 : 400, fontSize: 11 }}>
                        {fmtDate(vDate.toISOString())}
                        {expired && <div style={{ fontSize: 9, color: '#8e4550', fontWeight: 700 }}>VENCIDA</div>}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: p.mrr > 0 ? '#1f8c7d' : '#b0b8c8' }}>
                    {fmt(p.mrr)}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: p.pontual > 0 ? '#524e9c' : '#b0b8c8' }}>
                    {fmt(p.pontual)}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <DropdownMenu p={p} currentUserRole={currentUserRole} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
