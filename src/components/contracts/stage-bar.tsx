'use client'

import { fmtPct, fmtNum1 } from '@/lib/format'
import { useState, useTransition } from 'react'
import { moveContractStage, reopenRun, closeRun, transferRunToPipeline } from '@/lib/actions/pipeline'
import { contractEndDate, renewalStartDate } from '@/lib/utils/date'
import { createClient } from '@/lib/supabase/client'
import { registerContractFile } from '@/lib/actions/files'
import { attachAvulsoReport } from '@/lib/actions/avulso'
import { useRouter } from 'next/navigation'
import { sanitizeStorageFileName, tenantStoragePath } from '@/lib/utils/storage'

type Stage = {
  id: string; name: string; order_index: number
  is_won: boolean; is_lost: boolean; sla_days: number | null; color: string | null
}
type StageTiming = { stageId: string; days: number | null; isOverdue: boolean }
type OtherPipeline = { id: string; name: string; stages: { id: string; name: string }[] }

const MONTH_SHORTCUTS = [1, 2, 3, 6, 12, 24, 36, 48, 60]
const CONTRACT_TYPES = [
  { value: 'fixo', label: 'Fixo' },
  { value: 'medicao', label: 'Por Medição' },
]

export function StageBar({
  contractId, stages, currentStageId, timings, status,
  wonLabel, lostLabel, canChangeStage, pipelineType,
  contractNature, contractValue, otherPipelines, lostReasons,
  accountOwnerOptions, currentOwnerId, billingCnpjs = [],
  currentMonthlyValue, currentValidUntil, currentReportName = null,
}: {
  contractId: string; stages: Stage[]; currentStageId: string
  timings: StageTiming[]; status: string; wonLabel: string; lostLabel: string
  canChangeStage: boolean; pipelineType?: string
  contractNature?: string | null
  contractValue?: number
  otherPipelines?: OtherPipeline[]
  lostReasons?: { id: string; name: string }[]
  accountOwnerOptions?: { id: string; full_name: string }[]   // consultores para assumir a conta no ganho
  currentOwnerId?: string | null
  billingCnpjs?: { value: string; label: string }[]   // CNPJs de faturamento da empresa (Configurações)
  currentMonthlyValue?: number          // valor mensal do contrato hoje (antes da renovação)
  currentValidUntil?: string | null     // vigência atual (antes da renovação)
  currentReportName?: string | null     // avulso: relatório final já anexado na passagem aberta
}) {
  const router = useRouter()
  const [reportBusy, setReportBusy] = useState(false)
  const [reportMsg, setReportMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showWonModal, setShowWonModal] = useState(false)
  const [showLostModal, setShowLostModal] = useState(false)
  const [selectedLostReason, setSelectedLostReason] = useState('')
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferPipelineId, setTransferPipelineId] = useState('')
  const [transferStageId, setTransferStageId] = useState('')
  const [validFrom, setValidFrom] = useState(currentValidUntil ? renewalStartDate(String(currentValidUntil).slice(0, 10)) : '')
  const [validUntil, setValidUntil] = useState('')
  const [cnpjBilling, setCnpjBilling] = useState(billingCnpjs[0]?.value ?? '')
  const [contractType, setContractType] = useState('')
  const [monthlyValue, setMonthlyValue] = useState(contractValue ? String(contractValue) : '')
  const [accountOwnerId, setAccountOwnerId] = useState('')
  const [renewalValue, setRenewalValue] = useState('')
  const [reportFile, setReportFile] = useState<File | null>(null)

  const currentIndex = stages.findIndex((s) => s.id === currentStageId)
  const currentStage = stages[currentIndex]
  const canMarkWon  = currentStage?.is_won === true
  const canMarkLost = currentStage?.is_lost === true
  const isGestaoContratos = pipelineType === 'gestao_contratos'
  const isVendas = pipelineType === 'vendas'
  const isAvulso = pipelineType === 'servico_avulso'

  const inp: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#f8f9fb', color: '#1a1f36', outline: 'none' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 4 }
  const renewalValueN = (() => {
    const t = renewalValue.trim()
    if (!t) return NaN
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
    return Number.isFinite(n) ? n : NaN
  })()
  // Avulso: só o relatório final (sem vigência nem tipo de contrato)
  const modalValid = isAvulso
    ? (!!reportFile || !!currentReportName) && (Number(contractValue) || 0) > 0
    : !!validFrom && !!validUntil && (isGestaoContratos || !!contractType)
      && (!isVendas || !!accountOwnerId)
      && (!isGestaoContratos || renewalValueN > 0)
  const prevValue = Number(currentMonthlyValue) || 0
  const renewalPct = isGestaoContratos && prevValue > 0 && renewalValueN > 0
    ? Math.round(((renewalValueN - prevValue) / prevValue) * 1000) / 10
    : null

  const selectedTransferPipeline = (otherPipelines ?? []).find(p => p.id === transferPipelineId)

  function handleTransferPipelineChange(pid: string) {
    setTransferPipelineId(pid)
    setTransferStageId(((otherPipelines ?? []).find(p => p.id === pid)?.stages ?? [])[0]?.id ?? '')
  }

  function handleTransfer() {
    if (!transferPipelineId || !transferStageId) return
    setError(null)
    startTransition(async () => {
      const result = await transferRunToPipeline(contractId, transferPipelineId, transferStageId)
      if (result.error) setError(result.error)
      else setShowTransferModal(false)
    })
  }

  function timingFor(stageId: string) { return timings.find((t) => t.stageId === stageId) }

  function handleMove(stageId: string) {
    setError(null)
    startTransition(async () => {
      const result = await moveContractStage(contractId, stageId)
      if (result.error) setError(result.error)
    })
  }

  function handleReopen() {
    setError(null)
    startTransition(async () => {
      const result = await reopenRun(contractId)
      if (result.error) setError(result.error)
    })
  }

  function handleWonClick() { setShowWonModal(true) }

  // Avulso: anexa o relatório final antes do ganho → Hunter abre a tarefa "dar ganho"
  async function handleAttachReport(file: File) {
    setReportMsg(null); setError(null); setReportBusy(true)
    try {
      const supabase = createClient()
      const storagePath = await tenantStoragePath(supabase, `${contractId}/${Date.now()}-relatorio-${sanitizeStorageFileName(file.name)}`)
      const { error: upErr } = await supabase.storage.from('contract-files').upload(storagePath, file)
      if (upErr) { setError(`Falha no upload do relatório: ${upErr.message}`); return }
      const reg = await registerContractFile(contractId, file.name, storagePath, file.size, file.type)
      if ('error' in reg) { setError(reg.error ?? 'Falha ao registrar o relatório.'); return }
      const r = await attachAvulsoReport(contractId, storagePath, file.name)
      if (!r.ok) { setError(r.error); return }
      setReportMsg('Relatório anexado. O consultor recebeu a tarefa para dar ganho; no ganho, o envio para faturamento é automático.')
      router.refresh()
    } catch {
      setError('Falha de conexão ao anexar o relatório. Tente de novo.')
    } finally {
      setReportBusy(false)
    }
  }

  function handleClose(outcome: 'won' | 'lost', extraData?: {
    validFrom?: string; validUntil?: string
    cnpjBilling?: string; contractType?: string; monthlyValue?: string
    lostReason?: string
    accountOwnerId?: string
  }) {
    setError(null)
    startTransition(async () => {
      if (extraData && (extraData.validFrom || extraData.validUntil || extraData.cnpjBilling)) {
        try {
          const patch: Record<string, any> = {}
          if (extraData.validFrom)    patch.valid_from    = extraData.validFrom
          if (extraData.validUntil)   patch.valid_until   = extraData.validUntil
          if (extraData.cnpjBilling)  patch.cnpj_billing  = extraData.cnpjBilling
          if (extraData.contractType) patch.contract_type = extraData.contractType
          // Na renovação o novo valor vai pelo closeRun (para guardar o antes x depois)
          if (extraData.monthlyValue && !isGestaoContratos) patch.monthly_value = Number(extraData.monthlyValue)
          const res = await fetch(`/api/carteira/${contractId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
          if (!res.ok) {
            const json = await res.json().catch(() => ({}))
            setError(json.error ?? 'Erro ao salvar dados.')
            return
          }
        } catch { setError('Erro de conexão.'); return }
      }
      // Avulso: envia o relatório final antes de faturar
      let avulsoReport: { storagePath: string; fileName: string } | null = null
      if (outcome === 'won' && isAvulso) {
        if (!reportFile && !currentReportName) { setError('Anexe o relatório final do serviço.'); return }
      }
      if (outcome === 'won' && isAvulso && reportFile) {
        const supabase = createClient()
        const storagePath = await tenantStoragePath(supabase, `${contractId}/${Date.now()}-relatorio-${sanitizeStorageFileName(reportFile.name)}`)
        const { error: upErr } = await supabase.storage.from('contract-files').upload(storagePath, reportFile)
        if (upErr) { setError(`Falha no upload do relatório: ${upErr.message}`); return }
        const reg = await registerContractFile(contractId, reportFile.name, storagePath, reportFile.size, reportFile.type)
        if ('error' in reg) { setError(reg.error ?? 'Falha ao registrar o relatório.'); return }
        avulsoReport = { storagePath, fileName: reportFile.name }
      }
      const result = await closeRun(contractId, outcome, extraData?.lostReason, extraData?.accountOwnerId || null, {
        renewalNewValue: outcome === 'won' && isGestaoContratos ? renewalValueN : null,
        renewalPreviousValidUntil: currentValidUntil ?? null,
        avulsoReport,
      })
      if (result.error) setError(result.error)
      else setShowWonModal(false)
    })
  }

  return (
    <div className="space-y-3">
      {!canChangeStage && (
        <p className="rounded-md bg-yellow-50 px-3 py-1.5 text-xs text-yellow-800">
          Só o dono da conta (ou um admin) pode mudar a etapa.
        </p>
      )}
      <div className="flex gap-1 overflow-x-auto">
        {stages.map((stage, i) => {
          const timing = timingFor(stage.id)
          const isCurrent = stage.id === currentStageId
          const isFuture  = i > currentIndex
          const color = stage.color ?? '#1B556B'
          return (
            <button key={stage.id}
              disabled={isPending || isCurrent || status !== 'open' || !canChangeStage}
              onClick={() => handleMove(stage.id)}
              title={!canChangeStage ? 'Só o dono da conta (ou admin) pode mudar a etapa' : status !== 'open' ? 'Este contrato já está encerrado' : `Mover para "${stage.name}"`}
              style={{ backgroundColor: color }}
              className="flex min-w-[130px] flex-1 flex-col items-center justify-center gap-1 rounded-sm px-3 py-2 text-xs font-medium text-white opacity-90 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-90"
            >
              <span className="text-center leading-tight">{stage.name}</span>
              {timing?.days !== null && timing?.days !== undefined && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${timing.isOverdue ? 'bg-negative-700/80' : 'bg-black/15'}`}>
                  {timing.days === 0 ? 'Menos de 1 dia' : `${timing.days} dias`}
                </span>
              )}
              {isFuture && <span className="text-[9px] text-white/70">ainda não visitada</span>}
            </button>
          )
        })}
      </div>

      {isAvulso && status === 'open' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
          <span className="font-medium text-gray-700">Relatório final do serviço:</span>
          {currentReportName
            ? <span className="text-positive-700">✓ {currentReportName}</span>
            : <span className="text-warn-700">ainda não anexado</span>}
          <label className={`ml-auto cursor-pointer rounded-md border border-brand-700 px-2.5 py-1 font-medium text-brand-700 hover:bg-brand-100 ${reportBusy || !canChangeStage ? 'pointer-events-none opacity-50' : ''}`}>
            {reportBusy ? 'Enviando…' : currentReportName ? 'Trocar relatório' : '📎 Anexar relatório'}
            <input type="file" className="hidden" disabled={reportBusy || !canChangeStage} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleAttachReport(f) }} />
          </label>
          {reportMsg && <p className="w-full text-positive-700">{reportMsg}</p>}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Modal ao dar ganho */}
      {showWonModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: '#1a1f36', marginBottom: 4 }}>
              {isGestaoContratos ? 'Confirmar Renovação' : `Confirmar ${wonLabel}`}
            </h2>
            <p style={{ fontSize: 12, color: '#8892a4', marginBottom: 20 }}>
              {isGestaoContratos ? 'Preencha a nova vigência e o novo valor antes de confirmar.' : isAvulso ? 'Com o relatório anexado, o ganho envia o valor fechado automaticamente para faturamento.' : 'Preencha os dados obrigatórios para transferir ao funil de contratos.'}
            </p>

            {!isAvulso && (<>
            <p style={{ fontSize: 10, fontWeight: 600, color: '#1a1f36', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Vigência</p>
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12, marginBottom: 10 }}>
              <div><label style={lbl}>Início <span style={{ color: '#8e4550' }}>*</span></label>
                <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Fim <span style={{ color: '#8e4550' }}>*</span></label>
                <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} style={inp} /></div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16 }}>
              {MONTH_SHORTCUTS.map(m => (
                <button key={m} type="button" disabled={!validFrom}
                  onClick={() => validFrom && setValidUntil(contractEndDate(validFrom, m))}
                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 20, border: '0.5px solid #d1d8e8', background: '#fff', color: validFrom ? '#1a1f36' : '#b0b8c8', cursor: validFrom ? 'pointer' : 'not-allowed', opacity: validFrom ? 1 : 0.5 }}>
                  +{m}m
                </button>
              ))}
            </div>
            </>)}

            {isVendas && (
              <>
                <p style={{ fontSize: 10, fontWeight: 600, color: '#1a1f36', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10, paddingTop: 8, borderTop: '0.5px solid #f1f3f8' }}>Dados do contrato</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={lbl}>CNPJ de Faturamento <span style={{ color: '#8e4550' }}>*</span></label>
                    {billingCnpjs.length > 0 ? (
                      <select value={cnpjBilling} onChange={e => setCnpjBilling(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                        {billingCnpjs.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    ) : (
                      <input value={cnpjBilling} onChange={e => setCnpjBilling(e.target.value.replace(/\D/g, '').slice(0, 14))} placeholder="Somente números" style={inp} />
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 12 }}>
                    <div>
                      <label style={lbl}>Tipo de contrato <span style={{ color: '#8e4550' }}>*</span></label>
                      <select value={contractType} onChange={e => setContractType(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                        <option value="">Selecione...</option>
                        {CONTRACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Valor mensal (R$)</label>
                      <input type="number" value={monthlyValue} onChange={e => setMonthlyValue(e.target.value)} style={inp} />
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Consultor responsável pela conta <span style={{ color: '#8e4550' }}>*</span></label>
                    <select value={accountOwnerId} onChange={e => setAccountOwnerId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                      <option value="">Selecione quem assume a conta (retenção)...</option>
                      {(accountOwnerOptions ?? []).map(p => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}{p.id === currentOwnerId ? ' (responsável atual)' : ''}
                        </option>
                      ))}
                    </select>
                    <p style={{ fontSize: 10, color: '#8892a4', marginTop: 4 }}>
                      Quem cuidará da conta depois do ganho — renovação, alertas e relacionamento.
                    </p>
                  </div>
                  {contractNature && (
                    <div style={{ padding: '8px 12px', borderRadius: 8, background: '#e8e7f4', fontSize: 11, color: '#524e9c' }}>
                      📋 Natureza: <strong>{contractNature === 'eng_clinica' ? 'Engenharia Clínica' : 'Engenharia Hospitalar'}</strong> — pré-preenchida pela tag
                    </div>
                  )}
                </div>
              </>
            )}

            {isGestaoContratos && (
              <div style={{ marginBottom: 16, paddingTop: 8, borderTop: '0.5px solid #f1f3f8' }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: '#1a1f36', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Valor do novo período</p>
                <label style={lbl}>Novo valor mensal (R$) <span style={{ color: '#8e4550' }}>*</span></label>
                <input inputMode="decimal" value={renewalValue} onChange={e => setRenewalValue(e.target.value)} placeholder={prevValue > 0 ? String(prevValue).replace('.', ',') : '0,00'} style={inp} />
                <p style={{ fontSize: 11, color: '#52514e', marginTop: 6 }}>
                  Valor atual: <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prevValue)}</strong>
                  {renewalPct !== null && (
                    <span style={{ marginLeft: 8, fontWeight: 600, color: renewalPct > 0 ? '#1f8c7d' : renewalPct < 0 ? '#8e4550' : '#52514e' }}>
                      {renewalPct > 0 ? `▲ aumento de ${fmtPct(renewalPct)}` : renewalPct < 0 ? `▼ redução de ${fmtPct(Math.abs(renewalPct))}` : 'sem alteração de valor'}
                    </span>
                  )}
                </p>
              </div>
            )}

            {isAvulso && (
              <div style={{ marginBottom: 16, paddingTop: 8, borderTop: '0.5px solid #f1f3f8' }}>
                <p style={{ fontSize: 10, fontWeight: 600, color: '#1a1f36', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Relatório final</p>
                {currentReportName && <p style={{ fontSize: 12, color: '#1f8c7d', marginBottom: 8 }}>✓ Relatório já anexado: {currentReportName}</p>}
                <label style={lbl}>{currentReportName ? 'Trocar relatório (opcional)' : <>Relatório do serviço <span style={{ color: '#8e4550' }}>*</span></>}</label>
                <input type="file" onChange={e => setReportFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
                <p style={{ fontSize: 10, color: '#8892a4', marginTop: 4 }}>Valor fechado que vai para faturamento: <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(Number(contractValue) || 0)}</strong>. O relatório também fica em Arquivos.</p>
              </div>
            )}

            {!modalValid && <p style={{ fontSize: 11, color: '#c2683d', marginBottom: 12 }}>
              ⚠ {isAvulso ? ((Number(contractValue) || 0) > 0 ? 'Anexe o relatório final do serviço.' : 'Informe o valor fechado do serviço antes do ganho.')
                : !validFrom || !validUntil ? 'Preencha início e fim da vigência.'
                : !isGestaoContratos && !contractType ? 'Selecione o tipo de contrato.'
                : isVendas && !accountOwnerId ? 'Indique o consultor responsável pela conta.'
                : isGestaoContratos ? 'Informe o novo valor mensal do contrato.'
                : 'Anexe o relatório final do serviço.'}
            </p>}
            {error && <p style={{ fontSize: 12, color: '#8e4550', marginBottom: 8 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowWonModal(false)}
                style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button disabled={isPending || !modalValid}
                onClick={() => handleClose('won', { validFrom, validUntil, cnpjBilling, contractType, monthlyValue, accountOwnerId })}
                style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: !modalValid ? '#d1d8e8' : '#1f8c7d', color: '#fff', cursor: !modalValid ? 'not-allowed' : 'pointer' }}>
                {isPending ? 'Salvando...' : `Confirmar ${wonLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Perda — motivo obrigatório */}
      {showLostModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1f36', margin: '0 0 4px' }}>Marcar como {lostLabel}</p>
            <p style={{ fontSize: 12, color: '#8892a4', margin: '0 0 16px' }}>Selecione o motivo oficial para registrar esta perda.</p>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#52514e', display: 'block', marginBottom: 6 }}>
              Motivo de perda <span style={{ color: '#8e4550' }}>*</span>
            </label>
            {(lostReasons ?? []).length === 0 ? (
              <p style={{ fontSize: 12, color: '#b0b8c8', marginBottom: 16 }}>
                Nenhum motivo cadastrado. Acesse Configurações → Motivos de Perda.
              </p>
            ) : (
              <select
                value={selectedLostReason}
                onChange={e => setSelectedLostReason(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, borderRadius: 8, border: '0.5px solid #d1d8e8', marginBottom: 16, outline: 'none' }}>
                <option value="">Selecione um motivo...</option>
                {(lostReasons ?? []).map(r => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowLostModal(false); setSelectedLostReason('') }}
                style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button
                disabled={!selectedLostReason || isPending}
                onClick={() => {
                  setShowLostModal(false)
                  handleClose('lost', { lostReason: selectedLostReason } as any)
                  setSelectedLostReason('')
                }}
                style={{ padding: '8px 20px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', cursor: !selectedLostReason ? 'not-allowed' : 'pointer', background: !selectedLostReason ? '#d1d8e8' : '#8e4550', color: '#fff' }}>
                {isPending ? 'Salvando...' : `Confirmar ${lostLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Etapa atual: <span className="font-medium text-gray-900">{stages[currentIndex]?.name ?? '—'}</span>
        </p>
        {status === 'open' && (
          <div className="flex gap-2">
            {(otherPipelines ?? []).length > 0 && (
              <button onClick={() => { setShowTransferModal(true); handleTransferPipelineChange((otherPipelines ?? [])[0]?.id ?? '') }}
                disabled={isPending}
                style={{ padding: '6px 12px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
                ↔ Transferir funil
              </button>
            )}
            <button onClick={handleWonClick} disabled={isPending || !canMarkWon}
              title={canMarkWon ? undefined : `Só é possível marcar "${wonLabel}" numa etapa habilitada`}
              className="rounded-md bg-positive-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-positive-700 disabled:cursor-not-allowed disabled:opacity-40">
              {wonLabel}
            </button>
            <button onClick={() => setShowLostModal(true)} disabled={isPending || !canMarkLost}
              title={canMarkLost ? undefined : `Só é possível marcar "${lostLabel}" numa etapa habilitada`}
              className="rounded-md bg-negative-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-negative-700 disabled:cursor-not-allowed disabled:opacity-40">
              {lostLabel}
            </button>
          </div>
        )}
        {status !== 'open' && (
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${status === 'won' ? 'text-positive-700' : 'text-negative-700'}`}>
              {status === 'won' ? wonLabel : lostLabel}
            </span>
            <button onClick={handleReopen} disabled={isPending}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {isPending ? 'Reabrindo...' : 'Reabrir'}
            </button>
          </div>
        )}
      </div>

      {/* Modal de transferência entre funis */}
      {showTransferModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 500, color: '#1a1f36', marginBottom: 4 }}>Transferir para outro funil</h2>
            <p style={{ fontSize: 12, color: '#8892a4', marginBottom: 20 }}>
              A oportunidade será movida para o funil selecionado. O histórico é preservado.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Funil de destino <span style={{ color: '#8e4550' }}>*</span></label>
                <select value={transferPipelineId} onChange={e => handleTransferPipelineChange(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">Selecione...</option>
                  {(otherPipelines ?? []).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {selectedTransferPipeline && (
                <div>
                  <label style={lbl}>Etapa inicial <span style={{ color: '#8e4550' }}>*</span></label>
                  <select value={transferStageId} onChange={e => setTransferStageId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                    {selectedTransferPipeline.stages.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {error && <p style={{ fontSize: 12, color: '#8e4550', marginTop: 12 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowTransferModal(false)}
                style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={handleTransfer} disabled={isPending || !transferPipelineId || !transferStageId}
                style={{ padding: '8px 20px', fontSize: 12, fontWeight: 500, borderRadius: 8, border: 'none', background: !transferPipelineId ? '#d1d8e8' : '#1a1f36', color: '#fff', cursor: 'pointer', opacity: isPending ? 0.6 : 1 }}>
                {isPending ? 'Transferindo...' : 'Confirmar transferência'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
