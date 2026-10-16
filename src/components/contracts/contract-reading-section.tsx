'use client'

// Farmer · leitura do contrato: escolhe o PDF, a IA lê e indica os próximos
// passos da renovação. Datas-chave conferidas pelo CRM.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readContractWithAI, createActivityFromStep } from '@/lib/actions/contract-reading'
import type { ContractReading, ReadingChecks, ReadingStep } from '@/lib/agent/contract-reader'

const br = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso || '—')
const RENOV: Record<string, string> = { automatica: 'Automática', por_aditivo: 'Por aditivo', nao_prevista: 'Não prevista', nao_encontrado: 'Não encontrado no contrato' }
const AREA: Record<string, string> = { comercial: 'Comercial', juridico: 'Jurídico', tecnico: 'Técnico', financeiro: 'Financeiro', cliente: 'Cliente' }

function Fact({ label, value, clause, quote }: { label: string; value: React.ReactNode; clause?: string | null; quote?: string | null }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-1 text-sm font-medium text-gray-900">{value}</div>
      {clause && <p className="mt-1 text-[11px] text-brand-700">{clause}</p>}
      {quote && <p className="mt-0.5 text-[11px] italic text-gray-500">“{quote}”</p>}
    </div>
  )
}

export function ContractReadingSection({
  contractId, pdfFiles, reading, readingMeta, checks, hasAiKey,
}: {
  contractId: string
  pdfFiles: { id: string; file_name: string; created_at: string }[]
  reading: ContractReading | null
  readingMeta: { created_at: string; file_name: string | null; status: string; error: string | null } | null
  checks: ReadingChecks | null
  hasAiKey: boolean
}) {
  const router = useRouter()
  const [fileId, setFileId] = useState(pdfFiles[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Record<number, boolean>>({})

  // A lista de PDFs pode mudar depois de anexar um arquivo (a tela não remonta):
  // se a escolha guardada não existe mais, usa o primeiro PDF da lista.
  const selectedId = pdfFiles.some(f => f.id === fileId) ? fileId : (pdfFiles[0]?.id ?? '')

  async function run() {
    setError(null)
    if (!selectedId) { setError('Escolha o PDF do contrato.'); return }
    setBusy(true)
    try {
      const r = await readContractWithAI(contractId, selectedId)
      if (!r.ok) { setError(r.error); return }
      setCreated({})
      router.refresh()
    } catch (e) {
      setError(`Não foi possível concluir a leitura (${e instanceof Error ? e.message : 'falha de conexão ou tempo esgotado'}). Tente de novo.`)
    } finally {
      setBusy(false)
    }
  }

  async function addStep(i: number, s: ReadingStep) {
    const r = await createActivityFromStep(contractId, s)
    if (!r.ok) { setError(r.error); return }
    setCreated(c => ({ ...c, [i]: true }))
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-positive-100 bg-positive-100/60 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">🌱 Farmer · leitura do contrato</p>
            <p className="text-xs text-gray-600">A IA lê o PDF do contrato e indica os próximos passos da renovação, citando a cláusula. Confira sempre o trecho citado.</p>
          </div>
          {pdfFiles.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select value={selectedId} onChange={e => setFileId(e.target.value)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs" aria-label="PDF do contrato">
                {pdfFiles.map(f => <option key={f.id} value={f.id}>{f.file_name}</option>)}
              </select>
              <button onClick={run} disabled={busy || !hasAiKey} className="rounded-md bg-positive-700 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                {busy ? 'Lendo o contrato… (até 1 min)' : reading ? 'Ler de novo' : 'Ler contrato'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-600">Anexe o contrato em <strong>PDF</strong> na aba Arquivos para o Farmer ler.</p>
          )}
        </div>
        {!hasAiKey && <p className="mt-2 text-xs text-warn-700">A empresa ainda não cadastrou a chave da IA (Configurações → Agentes IA).</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
        {readingMeta && (
          <p className="mt-2 text-[11px] text-gray-500">
            Última leitura: {new Date(readingMeta.created_at).toLocaleString('pt-BR')} · {readingMeta.file_name}
            {readingMeta.status === 'erro' && <span className="text-red-700"> · falhou: {readingMeta.error}</span>}
          </p>
        )}
      </div>

      {reading && checks && (
        <>
          {/* Datas calculadas pelo CRM */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-brand-700 p-3 text-white">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/70">Fim da vigência</p>
              <p className="mt-1 text-lg font-semibold">{br(checks.fimContrato)}</p>
              <p className="text-xs text-white/80">{checks.diasAteFim === null ? '—' : checks.diasAteFim < 0 ? `vencido há ${-checks.diasAteFim} dia(s)` : `faltam ${checks.diasAteFim} dia(s)`}</p>
            </div>
            <div className={`rounded-xl p-3 ${checks.diasAtePrazoAviso !== null && checks.diasAtePrazoAviso < 0 ? 'bg-negative-600 text-white' : 'bg-warn-600 text-white'}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-white/80">Prazo do aviso prévio</p>
              <p className="mt-1 text-lg font-semibold">{br(checks.prazoAvisoPrevio)}</p>
              <p className="text-xs text-white/90">
                {checks.prazoAvisoPrevio === null ? 'Aviso prévio não encontrado no contrato'
                  : checks.diasAtePrazoAviso! < 0 ? `passou há ${-checks.diasAtePrazoAviso!} dia(s)` : `faltam ${checks.diasAtePrazoAviso} dia(s)`}
                {reading.aviso_previo?.dias ? ` · ${reading.aviso_previo.dias} dias antes do fim` : ''}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Conferência com o CRM</p>
              {checks.divergencias.length === 0
                ? <p className="mt-1 text-sm font-medium text-positive-700">✓ Vigência e valor batem</p>
                : <ul className="mt-1 space-y-1 text-xs text-negative-700">{checks.divergencias.map((d, i) => <li key={i}>⚠ {d}</li>)}</ul>}
            </div>
          </div>
          <p className="text-[11px] text-gray-400">As datas acima são calculadas pelo CRM a partir do que foi lido (fim − dias de aviso prévio), não pela IA.</p>

          {/* Próximos passos */}
          <div className="rounded-2xl border border-gray-200 bg-white">
            <p className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-900">Próximos passos para a renovação</p>
            {reading.proximos_passos?.length ? (
              <ol className="divide-y divide-gray-50">
                {reading.proximos_passos.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-positive-100 text-xs font-semibold text-positive-700">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{s.acao}</p>
                      <p className="mt-0.5 text-xs text-gray-600">{s.motivo}</p>
                      <p className="mt-1 text-[11px] text-gray-500">
                        {s.prazo ? <>Até <strong className="text-gray-700">{br(s.prazo)}</strong> · </> : null}
                        {AREA[s.area] ?? s.area}{s.clausula ? ` · ${s.clausula}` : ''}
                      </p>
                    </div>
                    <button onClick={() => addStep(i, s)} disabled={!!created[i]} className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:border-positive-100 disabled:bg-positive-100 disabled:text-positive-700">
                      {created[i] ? '✓ Atividade criada' : '+ Criar atividade'}
                    </button>
                  </li>
                ))}
              </ol>
            ) : <p className="px-4 py-3 text-xs text-gray-500">A leitura não indicou passos.</p>}
          </div>

          {/* O que foi lido */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Vigência" value={`${br(reading.vigencia?.inicio)} a ${br(reading.vigencia?.fim)}${reading.vigencia?.prazo_meses ? ` (${reading.vigencia.prazo_meses} meses)` : ''}`} clause={reading.vigencia?.clausula} quote={reading.vigencia?.trecho} />
            <Fact label="Renovação" value={<>{RENOV[reading.renovacao?.tipo] ?? '—'}{reading.renovacao?.regra && <span className="block text-xs font-normal text-gray-600">{reading.renovacao.regra}</span>}{reading.renovacao?.limite && <span className="block text-xs font-normal text-gray-600">Limite: {reading.renovacao.limite}</span>}</>} clause={reading.renovacao?.clausula} quote={reading.renovacao?.trecho} />
            <Fact label="Aviso prévio" value={<>{reading.aviso_previo?.dias ? `${reading.aviso_previo.dias} dias` : 'Não encontrado'}{reading.aviso_previo?.regra && <span className="block text-xs font-normal text-gray-600">{reading.aviso_previo.regra}</span>}</>} clause={reading.aviso_previo?.clausula} quote={reading.aviso_previo?.trecho} />
            <Fact label="Reajuste" value={<>{reading.reajuste?.indice ?? 'Não encontrado'}{reading.reajuste?.periodicidade && <span className="block text-xs font-normal text-gray-600">{reading.reajuste.periodicidade}</span>}{reading.reajuste?.data_base && <span className="block text-xs font-normal text-gray-600">Data-base: {br(reading.reajuste.data_base)}</span>}</>} clause={reading.reajuste?.clausula} quote={reading.reajuste?.trecho} />
            <Fact label="Valor" value={<>{typeof reading.valor?.mensal === 'number' ? `R$ ${reading.valor.mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês` : 'Mensal não encontrado'}{typeof reading.valor?.total === 'number' && <span className="block text-xs font-normal text-gray-600">Total: R$ {reading.valor.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}</>} clause={reading.valor?.clausula} />
            <Fact label="Rescisão" value={<>{reading.rescisao?.multa ?? 'Multa não encontrada'}{reading.rescisao?.aviso_dias ? <span className="block text-xs font-normal text-gray-600">Aviso: {reading.rescisao.aviso_dias} dias</span> : null}</>} clause={reading.rescisao?.clausula} />
          </div>

          {(reading.riscos?.length > 0 || reading.obrigacoes_relevantes?.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {reading.riscos?.length > 0 && (
                <div className="rounded-xl border border-negative-100 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-negative-700">Pontos de atenção</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-700">{reading.riscos.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
              {reading.obrigacoes_relevantes?.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Obrigações que pesam na renovação</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-700">{reading.obrigacoes_relevantes.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {reading.objeto && <p className="text-xs text-gray-500"><strong>Objeto:</strong> {reading.objeto}{reading.contratante ? ` · Contratante: ${reading.contratante}` : ''}{reading.contratada ? ` · Contratada: ${reading.contratada}` : ''}</p>}
        </>
      )}
    </div>
  )
}
