'use client'

// Receita do contrato:
//   - Recorrente: entra automática todo mês pelo valor do contrato (nada a lançar)
//   - Medição: lançar o relatório do mês (medido − glosa = líquido) e ver quanto
//     do potencial do contrato foi perdido. Sem relatório, só vale com aprovação do admin.

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setBillingType } from '@/lib/actions/billing'
import { saveMeasurement, approveMeasurement } from '@/lib/actions/measurements'
import { sanitizeStorageFileName } from '@/lib/utils/storage'
import { measurementLoss, brl, MONTHS_LONG } from '@/lib/revenue/measurement'
import { RevenueTypeBadge } from '@/components/contracts/revenue-type-badge'

export type BillingRecord = {
  id: string
  year: number
  month: number
  amount: number
  measured_amount: number | null
  glosa_amount: number | null
  glosa_reason: string | null
  contract_value: number | null
  status: 'validado' | 'aguardando_aprovacao' | string
  file_storage_path: string | null
  file_name: string | null
  notes: string | null
  confirmed_at: string
  approved_at: string | null
}

function parseMoney(s: string): number {
  const t = s.trim()
  if (!t) return 0
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(norm)
  return Number.isFinite(n) ? n : NaN
}

export function BillingSection({
  contractId,
  billingType,
  contractValue,
  records,
  isAdmin,
}: {
  contractId: string
  billingType: string
  contractValue: number
  records: BillingRecord[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const now = new Date()
  const defMonth = now.getMonth() === 0 ? 12 : now.getMonth()       // mês anterior
  const defYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const [type, setType] = useState(billingType === 'metered' ? 'metered' : 'fixed')
  const [year, setYear] = useState(defYear)
  const [month, setMonth] = useState(defMonth)
  const [measured, setMeasured] = useState('')
  const [glosa, setGlosa] = useState('')
  const [glosaReason, setGlosaReason] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const measuredN = parseMoney(measured)
  const glosaN = parseMoney(glosa)
  const preview = measured && !Number.isNaN(measuredN) && !Number.isNaN(glosaN)
    ? measurementLoss(contractValue, measuredN, glosaN)
    : null
  const existing = records.find(r => r.year === year && r.month === month)

  async function handleTypeChange(newType: string) {
    if (newType === type) return
    const msg = newType === 'metered'
      ? 'Mudar para MEDIÇÃO? A receita deste contrato só vai contar quando a medição de cada mês for lançada e validada.'
      : 'Mudar para RECORRENTE? A receita passa a entrar automática todo mês pelo valor do contrato.'
    if (!window.confirm(msg)) return
    setType(newType)
    await setBillingType(contractId, newType as 'fixed' | 'metered')
    router.refresh()
  }

  async function handleSave() {
    setError(null)
    setOkMsg(null)
    if (!measured || Number.isNaN(measuredN)) { setError('Informe o valor medido do mês.'); return }
    if (Number.isNaN(glosaN)) { setError('Glosa inválida.'); return }
    if (glosaN > measuredN) { setError('A glosa não pode ser maior que o valor medido.'); return }
    if (glosaN > 0 && !glosaReason.trim()) { setError('Informe o motivo da glosa.'); return }
    setBusy(true)
    try {
      let filePath: string | null = null
      let fileNameToSave: string | null = null
      if (file) {
        const supabase = createClient()
        const storagePath = `billing/${contractId}/${year}-${month}-${Date.now()}-${sanitizeStorageFileName(file.name)}`
        const { error: uploadError } = await supabase.storage.from('contract-files').upload(storagePath, file)
        if (uploadError) throw new Error(`Falha no upload: ${uploadError.message}`)
        filePath = storagePath
        fileNameToSave = file.name
      }
      const r = await saveMeasurement({
        contractId, year, month,
        measured: measuredN, glosa: glosaN, glosaReason, notes,
        filePath, fileName: fileNameToSave,
      })
      if (!r.ok) { setError(r.error); return }
      setOkMsg(r.status === 'validado' ? 'Medição validada (com relatório).' : 'Medição salva sem relatório — aguardando aprovação do administrador para entrar na receita.')
      setMeasured(''); setGlosa(''); setGlosaReason(''); setNotes(''); setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar a medição.')
    } finally {
      setBusy(false)
    }
  }

  async function handleApprove(id: string) {
    if (!window.confirm('Aprovar esta medição SEM relatório? Ela passa a contar na receita do mês.')) return
    setBusy(true)
    const r = await approveMeasurement(id)
    setBusy(false)
    if (!r.ok) setError(r.error)
    else router.refresh()
  }

  function handleEdit(r: BillingRecord) {
    setYear(r.year)
    setMonth(r.month)
    setMeasured(String(r.measured_amount ?? r.amount).replace('.', ','))
    setGlosa(r.glosa_amount ? String(r.glosa_amount).replace('.', ',') : '')
    setGlosaReason(r.glosa_reason ?? '')
    setNotes(r.notes ?? '')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-gray-900">Receita do contrato</h2>
          <RevenueTypeBadge billingType={type} />
        </div>
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs focus:border-brand-700 focus:outline-none"
          aria-label="Tipo de receita"
        >
          <option value="fixed">Recorrente (valor fixo)</option>
          <option value="metered">Por medição</option>
        </select>
      </div>

      {type === 'fixed' ? (
        <div className="rounded-lg border border-brand-100 bg-brand-100 p-4 text-sm text-brand-800">
          <p className="font-medium">Receita recorrente automática: {brl(contractValue)} por mês</p>
          <p className="mt-1 text-xs text-brand-700">
            Entra sozinha na receita de cada mês enquanto o contrato estiver ativo no funil (só sai se for rescindido). Não precisa lançar nada.
            Para mudar o valor, use &quot;Mudança de valor&quot; na Visão Geral.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-orange-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-700">
            {existing ? `Corrigindo a medição de ${MONTHS_LONG[month - 1]}/${year} (já lançada)` : 'Lançar medição do mês'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Potencial do contrato: <strong>{brl(contractValue)}</strong>/mês. Com o relatório anexado a medição já vale; sem relatório, precisa da aprovação do administrador.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] text-gray-500">Mês de referência</label>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                {MONTHS_LONG.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500">Ano</label>
              <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500">Valor medido (R$)</label>
              <input inputMode="decimal" value={measured} onChange={(e) => setMeasured(e.target.value)} placeholder="0,00" className="mt-1 w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500">Glosa (R$)</label>
              <input inputMode="decimal" value={glosa} onChange={(e) => setGlosa(e.target.value)} placeholder="0,00" className="mt-1 w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            {glosaN > 0 && (
              <div className="min-w-[180px] flex-1">
                <label className="block text-[10px] text-gray-500">Motivo da glosa *</label>
                <input value={glosaReason} onChange={(e) => setGlosaReason(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
            )}
          </div>

          {preview && (
            <div className={`mt-3 rounded-md p-3 text-sm ${preview.lost > 0 ? 'bg-red-50 text-red-900' : 'bg-green-50 text-green-900'}`}>
              <p>Líquido do mês: <strong>{brl(preview.net)}</strong> (medido {brl(measuredN)}{glosaN > 0 ? ` − glosa ${brl(glosaN)}` : ''})</p>
              {preview.lost > 0 ? (
                <p className="mt-0.5 font-medium">Perdemos {brl(preview.lost)}{preview.lostPct !== null ? ` (${preview.lostPct}%)` : ''} do potencial do contrato ({brl(contractValue)}).</p>
              ) : preview.above > 0 ? (
                <p className="mt-0.5 font-medium">Medição {brl(preview.above)} acima do potencial do contrato.</p>
              ) : (
                <p className="mt-0.5 font-medium">Atingiu 100% do potencial do contrato.</p>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[160px] flex-1">
              <label className="block text-[10px] text-gray-500">Observação (opcional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500">Relatório de medição {existing?.file_name ? `(atual: ${existing.file_name})` : ''}</label>
              <input ref={fileInputRef} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 text-xs" />
            </div>
          </div>

          <button onClick={handleSave} disabled={busy} className="mt-3 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
            {busy ? 'Salvando...' : existing ? 'Salvar correção' : 'Lançar medição'}
          </button>
          {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
          {okMsg && <p role="status" className="mt-1 text-xs text-green-700">{okMsg}</p>}
        </div>
      )}

      {records.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-gray-500">{type === 'fixed' ? 'Lançamentos antigos (não contam: contrato recorrente)' : 'Medições lançadas'}</p>
          {records.map((r) => {
            const cv = Number(r.contract_value ?? contractValue) || 0
            const measuredV = Number(r.measured_amount ?? r.amount)
            const glosaV = Number(r.glosa_amount ?? 0)
            const l = measurementLoss(cv, measuredV, glosaV)
            const pending = r.status === 'aguardando_aprovacao'
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{MONTHS_LONG[r.month - 1]}/{r.year}</span>
                  <span className="ml-2 text-gray-700">{brl(Number(r.amount))}</span>
                  {glosaV > 0 && <span className="ml-2 text-xs text-gray-500">glosa {brl(glosaV)}{r.glosa_reason ? ` — ${r.glosa_reason}` : ''}</span>}
                  {type === 'metered' && l.lost > 0 && <span className="ml-2 text-xs font-medium text-red-700">perdemos {brl(l.lost)}{l.lostPct !== null ? ` (${l.lostPct}%)` : ''}</span>}
                  {r.file_name && <span className="ml-2 text-xs text-brand-700">📎 {r.file_name}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {pending ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">Aguardando aprovação</span>
                  ) : (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Validada</span>
                  )}
                  {pending && isAdmin && (
                    <button onClick={() => handleApprove(r.id)} disabled={busy} className="text-xs font-medium text-green-700 hover:underline">Aprovar sem relatório</button>
                  )}
                  {type === 'metered' && <button onClick={() => handleEdit(r)} className="text-xs text-brand-700 hover:underline">Corrigir</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
