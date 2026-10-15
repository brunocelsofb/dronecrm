'use client'

// NOTA DE INCERTEZA: a API abaixo (DndContext, useDraggable, useDroppable,
// PointerSensor) é a que eu conheço do @dnd-kit/core, mas não tenho certeza
// absoluta de que os nomes/assinaturas não mudaram nas versões mais recentes.
// Teste esta parte com atenção redobrada — se algo não bater, confira a
// documentação em dndkit.com.
//
// SIMPLIFICAÇÃO CONHECIDA: não uso <DragOverlay>, então o card arrastado se
// move dentro do próprio fluxo do documento em vez de "flutuar" livremente
// sobre as colunas. Funciona, mas uma versão mais polida usaria DragOverlay
// para um efeito visual mais suave — deixei de fora agora para reduzir a
// superfície de código incerto nesta primeira versão.

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { moveContractStage } from '@/lib/actions/pipeline'
import { deleteContract } from '@/lib/actions/contracts'
import { createClient } from '@/lib/supabase/client'
import { ValidityBadge } from '@/components/contracts/validity-badge'
import { Trash2 } from 'lucide-react'
import { RevenueTypeBadge } from '@/components/contracts/revenue-type-badge'
import { MONTHS_SHORT } from '@/lib/revenue/measurement'

export type RunCard = {
  runId: string
  contractId: string
  companyId: string | null
  stageId: string
  status: 'open' | 'won' | 'lost'
  processNumber: string
  clientName: string
  title: string
  value: number
  stageEnteredAt: string
  lastActivityAt: string | null
  validUntil: string | null
  freshness: 'fresh' | 'warning' | 'stale'
  tag: { id: string; name: string; color: string } | null
  lostReasonName?: string | null
  // Só no funil de Gestão de Contratos
  revenue?: {
    type: 'fixed' | 'metered'
    contractValue: number
    last?: { year: number; month: number; net: number; lost: number; lostPct: number | null; pending: boolean } | null
    refMissing?: { year: number; month: number; overdue: boolean } | null
  }
}

type Stage = {
  id: string
  name: string
  order_index: number
  sla_days: number | null
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function fmt(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

const FRESHNESS_STYLES = {
  fresh:   { border: '0.5px solid #e8edf5', background: '#fff', borderLeft: '0.5px solid #e8edf5' },
  warning: { border: '0.5px solid #ffe596', background: '#fffdf5', borderLeft: '3px solid #f59e0b' },
  stale:   { border: '0.5px solid #dcadb3', background: '#fff5f5', borderLeft: '3px solid #ef4444' },
} as const

function Card({ card, sla, showValidity, wonLabel, lostLabel, onTransfer }: {
  card: RunCard; sla: number | null; showValidity: boolean; wonLabel: string; lostLabel: string
  onTransfer?: (card: RunCard) => void
}) {
  const router = useRouter()
  const isClosed = card.status !== 'open'
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.runId,
    data: card,
    disabled: isClosed,
  })
  const days = daysSince(card.stageEnteredAt)
  const overdue = sla !== null && days > sla

  function openAccount(e: React.MouseEvent) {
    e.stopPropagation()
    router.push(card.companyId ? `/companies/${card.companyId}` : `/contracts/${card.contractId}`)
  }

  function openOpportunity() {
    router.push(`/contracts/${card.contractId}`)
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={openOpportunity}
      title={
        card.freshness === 'stale'
          ? 'Sem interação há um bom tempo — precisa de atenção'
          : card.freshness === 'warning'
            ? 'Começando a esfriar — considere um follow-up'
            : 'Interação recente'
      }
      style={{
        ...FRESHNESS_STYLES[isClosed ? 'fresh' : card.freshness],
        borderRadius: 10,
        padding: '12px',
        marginBottom: 8,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        cursor: isClosed ? 'default' : 'grab',
        opacity: isDragging ? 0.4 : isClosed ? 0.8 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <button
          type="button"
          onClick={openAccount}
          onPointerDown={(e) => e.stopPropagation()}
          title={card.companyId ? 'Abrir empresa' : 'Abrir contrato'}
          style={{ textAlign: 'left', fontSize: 13, fontWeight: 500, color: '#1a1f36', background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 1.3 }}
        >
          {card.clientName}
        </button>
        {card.status === 'won' && <span style={{ flexShrink: 0, borderRadius: 20, background: '#e3f5f1', color: '#1f8c7d', fontSize: 10, fontWeight: 500, padding: '2px 7px' }}>{wonLabel}</span>}
        {card.status === 'lost' && <span style={{ flexShrink: 0, borderRadius: 20, background: '#f6e9ea', color: '#8e4550', fontSize: 10, fontWeight: 500, padding: '2px 7px' }}>{lostLabel}</span>}
      </div>

      {card.tag && (
        <span style={{ display: 'inline-block', marginTop: 6, borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 500, color: '#fff', background: card.tag.color }}>
          {card.tag.name}
        </span>
      )}

      <p style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 10, color: '#b0b8c8' }}>{card.processNumber}</p>

      {card.revenue && card.status === 'open' && (
        <div style={{ marginTop: 6 }}>
          <RevenueTypeBadge billingType={card.revenue.type} size="sm" />
          {card.revenue.type === 'metered' && card.revenue.last && (
            <p style={{ marginTop: 4, fontSize: 10, lineHeight: 1.35, color: card.revenue.last.lost > 0 ? '#8e4550' : '#1f8c7d' }}>
              {MONTHS_SHORT[card.revenue.last.month - 1]}/{String(card.revenue.last.year).slice(2)}: {fmt(card.revenue.last.net)}
              {card.revenue.last.lost > 0 ? ` · perdemos ${fmt(card.revenue.last.lost)}${card.revenue.last.lostPct !== null ? ` (${card.revenue.last.lostPct}%)` : ''}` : ' · 100% do potencial'}
              {card.revenue.last.pending ? ' · aguardando aprovação' : ''}
            </p>
          )}
          {card.revenue.type === 'metered' && card.revenue.refMissing && (
            <p style={{ marginTop: 3, fontSize: 10, fontWeight: 500, color: card.revenue.refMissing.overdue ? '#8e4550' : '#c2683d' }}>
              {card.revenue.refMissing.overdue ? '⚠ ' : ''}Medição de {MONTHS_SHORT[card.revenue.refMissing.month - 1]} {card.revenue.refMissing.overdue ? 'atrasada' : 'pendente'}
            </p>
          )}
        </div>
      )}

      {showValidity && card.validUntil && (
        <div style={{ marginTop: 6 }}>
          <ValidityBadge validUntil={card.validUntil} />
        </div>
      )}

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #f1f3f8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1f36' }}>{fmt(card.value)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onTransfer && (
            <button
              onClick={e => { e.stopPropagation(); onTransfer(card) }}
              title="Transferir para outro funil"
              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
              ↔ Funil
            </button>
          )}
          <span style={{ borderRadius: 20, padding: '2px 7px', fontSize: 10, fontWeight: 500, background: overdue ? '#f6e9ea' : '#f1f3f8', color: overdue ? '#8e4550' : '#8892a4' }}>
            {days === 0 ? '< 1 dia' : `${days}d`}
          </span>
        </div>
      </div>
    </div>
  )
}

function Column({ stage, cards, showValidity, wonLabel, lostLabel, onTransfer }: {
  stage: Stage; cards: RunCard[]; showValidity: boolean; wonLabel: string; lostLabel: string
  onTransfer?: (card: RunCard) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = cards.reduce((sum, c) => sum + c.value, 0)

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 272,
        flexShrink: 0,
        borderRadius: 12,
        padding: '12px 10px',
        background: isOver ? '#e8e7f4' : '#f1f3f8',
        border: isOver ? '0.5px solid #b0c4f8' : '0.5px solid #e8edf5',
        transition: 'background 0.15s, border 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', marginBottom: 10 }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: '#1a1f36', margin: 0 }}>{stage.name}</p>
        <span style={{ fontSize: 10, color: '#8892a4', background: '#fff', border: '0.5px solid #e8edf5', borderRadius: 20, padding: '2px 7px' }}>{cards.length}</span>
      </div>
      <p style={{ fontSize: 11, color: '#8892a4', padding: '0 4px', marginBottom: 10 }}>{fmt(total)}</p>
      {cards.map((c) => (
        <Card key={c.runId} card={c} sla={stage.sla_days} showValidity={showValidity} wonLabel={wonLabel} lostLabel={lostLabel} onTransfer={onTransfer} />
      ))}
      {cards.length === 0 && (
        <p style={{ padding: '32px 0', textAlign: 'center', fontSize: 11, color: '#c8cdd8' }}>Vazio</p>
      )}
    </div>
  )
}

const TRASH_ZONE_ID = '__trash__'

function TrashDropzone() {
  const { setNodeRef, isOver } = useDroppable({ id: TRASH_ZONE_ID })
  return (
    <div ref={setNodeRef} style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderRadius: 12, border: `2px dashed ${isOver ? '#ef4444' : '#d1d8e8'}`,
      padding: '20px 16px', fontSize: 12, fontWeight: 500,
      background: isOver ? '#f6e9ea' : 'rgba(255,255,255,0.8)',
      color: isOver ? '#8e4550' : '#8892a4',
      transition: 'all 0.15s', cursor: 'copy',
      minWidth: 160,
    }}>
      <Trash2 size={22} />
      Excluir permanentemente
    </div>
  )
}

export function KanbanBoard({
  pipelineId,
  stages,
  initialCards,
  showValidity,
  wonLabel,
  lostLabel,
  isAdmin,
  otherPipelines,
  isGestao,
}: {
  pipelineId: string
  stages: Stage[]
  initialCards: RunCard[]
  showValidity: boolean
  wonLabel: string
  lostLabel: string
  isAdmin: boolean
  otherPipelines?: { id: string; name: string; stages: { id: string; name: string }[] }[]
  isGestao?: boolean
}) {
  const [cards, setCards] = useState(initialCards)
  const [isDraggingAny, setIsDraggingAny] = useState(false)
  const [transferCard, setTransferCard] = useState<RunCard | null>(null)
  const [transferPipelineId, setTransferPipelineId] = useState('')
  const [transferStageId, setTransferStageId] = useState('')

  // CORREÇÃO: sem isso, o botão "Atualizar" (router.refresh()) buscaria
  // dados novos do servidor, mas o estado local dos cards continuaria
  // com a versão antiga — useState só usa o valor inicial na primeira
  // renderização, não sincroniza sozinho quando a prop muda depois.
  useEffect(() => {
    setCards(initialCards)
  }, [initialCards])

  const router = useRouter()

  // Atualização em tempo real — quando algo muda em pipeline_runs deste
  // funil (por exemplo, a automação de renovação movendo um contrato
  // sozinha), a tela busca os dados novos automaticamente, sem precisar
  // de F5 ou clicar em "Atualizar".
  //
  // NOTA DE INCERTEZA: mesmo caso do sino de notificação — se isso não
  // atualizar sozinho, confira em Database → Replication →
  // supabase_realtime se a tabela "pipeline_runs" está habilitada.
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`pipeline_runs:${pipelineId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'contract_crm', table: 'pipeline_runs', filter: `pipeline_id=eq.${pipelineId}` },
        () => {
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [pipelineId, router])

  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const closedCount = cards.filter((c) => c.status !== 'open').length
  const visibleCards = showClosed ? cards : cards.filter((c) => c.status === 'open')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const card = active.data.current as RunCard | undefined
    if (!card) return

    if (over.id === TRASH_ZONE_ID) {
      if (!confirm(`Excluir "${card.clientName}" PARA SEMPRE? Isso apaga todo o histórico, arquivos e faturamento ligados a esse contrato. Não tem como desfazer.`)) {
        return
      }
      // Remove da tela imediatamente (otimista) — se falhar, o próximo
      // "Atualizar" traz de volta, já que revalidatePath só roda no
      // servidor depois da resposta.
      setCards((prev) => prev.filter((c) => c.runId !== card.runId))
      setError(null)
      startTransition(async () => {
        const result = await deleteContract(card.contractId)
        if (result?.error) {
          setError(result.error)
          setCards((prev) => [...prev, card])
        }
      })
      return
    }

    const newStageId = String(over.id)
    if (card.stageId === newStageId || card.status !== 'open') return

    const previousStageId = card.stageId

    // Atualização otimista: move o card na tela imediatamente, sem
    // esperar a resposta do servidor — sensação mais rápida de uso.
    setCards((prev) =>
      prev.map((c) =>
        c.runId === card.runId ? { ...c, stageId: newStageId, stageEnteredAt: new Date().toISOString() } : c
      )
    )
    setError(null)

    startTransition(async () => {
      const result = await moveContractStage(card.contractId, newStageId)
      if (result.error) {
        setError(result.error)
        // Reverte a posição do card se a Server Action falhar
        setCards((prev) =>
          prev.map((c) => (c.runId === card.runId ? { ...c, stageId: previousStageId } : c))
        )
      }
    })
  }

  function handleTransfer() {
    if (!transferCard || !transferPipelineId || !transferStageId) return
    const card = transferCard
    setCards(prev => prev.filter(c => c.runId !== card.runId))
    setTransferCard(null)
    startTransition(async () => {
      const { transferRunToPipeline } = await import('@/lib/actions/pipeline')
      const result = await transferRunToPipeline(card.contractId, transferPipelineId, transferStageId)
      if (result.error) {
        setError(result.error)
        setCards(prev => [...prev, card])
      } else {
        router.refresh()
      }
    })
  }

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }

  return (
    <>
    {/* Modal de transferência entre funis */}
    {transferCard && otherPipelines && otherPipelines.length > 0 && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
          <p style={{ fontSize: 15, fontWeight: 500, color: '#1a1f36', marginBottom: 4 }}>Transferir para outro funil</p>
          <p style={{ fontSize: 12, color: '#8892a4', marginBottom: 12 }}>{transferCard.clientName || transferCard.title}</p>
          {isGestao
            ? (
              <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: '#f6e9ea', border: '1.5px solid #dcadb3', fontSize: 12, color: '#8e4550' }}>
                🚨 <strong>Atenção redobrada:</strong> este contrato está em gestão ativa — já passou pelo funil de vendas e foi ganho. Transferi-lo irá movê-lo para outro funil e criará uma nova passagem. O histórico é preservado, mas o contrato sairá da gestão atual. <strong>Você confirma?</strong>
              </div>
            ) : (
              <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#fbeee5', border: '0.5px solid #ffe596', fontSize: 12, color: '#c2683d' }}>
                ⚠ <strong>Atenção:</strong> a oportunidade será movida para o funil de destino. O histórico é preservado. <strong>Você autoriza?</strong>
              </div>
            )
          }
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Funil de destino</p>
              <select value={transferPipelineId} style={{ ...inp, cursor: 'pointer' }}
                onChange={e => {
                  setTransferPipelineId(e.target.value)
                  setTransferStageId(otherPipelines.find(p => p.id === e.target.value)?.stages[0]?.id ?? '')
                }}>
                <option value="">Selecione...</option>
                {otherPipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {transferPipelineId && (
              <div>
                <p style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }}>Etapa inicial</p>
                <select value={transferStageId} onChange={e => setTransferStageId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  {(otherPipelines.find(p => p.id === transferPipelineId)?.stages ?? []).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setTransferCard(null)} style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>Cancelar</button>
            <button onClick={handleTransfer} disabled={!transferPipelineId || !transferStageId}
              style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: !transferPipelineId ? '#d1d8e8' : '#1a1f36', color: '#fff', cursor: 'pointer' }}>
              Transferir
            </button>
          </div>
        </div>
      </div>
    )}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {error && <p style={{ fontSize: 12, color: '#8e4550' }}>{error}</p>}
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8892a4', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
            style={{ borderRadius: 4 }}
          />
          Mostrar encerrados ({closedCount})
        </label>
      </div>
      <DndContext sensors={sensors} onDragStart={() => setIsDraggingAny(true)} onDragEnd={(event) => { setIsDraggingAny(false); handleDragEnd(event) }}>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
          {stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              cards={visibleCards.filter((c) => c.stageId === stage.id)}
              showValidity={showValidity}
              wonLabel={wonLabel}
              lostLabel={lostLabel}
              onTransfer={otherPipelines && otherPipelines.length > 0 ? (card: RunCard) => {
                setTransferCard(card)
                setTransferPipelineId(otherPipelines![0]?.id ?? '')
                setTransferStageId(otherPipelines![0]?.stages[0]?.id ?? '')
              } : undefined}
            />
          ))}
        </div>

        {/* Barra inferior estilo PipeRun — só aparece ao arrastar */}
        {isDraggingAny && (
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 500,
            padding: '12px 24px',
            background: 'rgba(26,31,54,0.97)',
            display: 'flex', gap: 12, alignItems: 'stretch',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.25)',
          }}>
            {isAdmin && <TrashDropzone />}
          </div>
        )}
      </DndContext>
    </div>
    </>
  )
}
