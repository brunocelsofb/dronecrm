'use client'

// Farmer · leitura do contrato: escolhe o PDF, a IA lê e indica os próximos
// passos da renovação. Datas-chave conferidas pelo CRM.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readContractWithAI, createActivityFromStep } from '@/lib/actions/contract-reading'
import type { ContractReading, ReadingChecks, ReadingStep, SimNao } from '@/lib/agent/contract-reader'
import { fmtBRL } from '@/lib/format'

const br = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : iso || '—')
const RESP: Record<string, string> = { contratada: 'Contratada', contratante: 'Contratante', compartilhado: 'Compartilhado', nao_claro: 'Não está claro' }
const SIMNAO = (v: SimNao, sim = 'Sim', nao = 'Não') => (v === 'sim' ? sim : v === 'nao' ? nao : 'Não encontrado no contrato')
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

function ListTable({ title, head, rows }: { title: string; head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <p className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-900">{title} <span className="font-normal text-gray-400">· {rows.length}</span></p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
            <tr>{head.map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j} className={`px-3 py-2 align-top ${j === 0 ? 'font-medium text-gray-900' : j === r.length - 1 ? 'whitespace-nowrap text-brand-700' : 'text-gray-700'}`}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ContractReadingSection({
  contractId, docs, isAdmin, reading, readingMeta, checks, hasAiKey,
}: {
  contractId: string
  docs: { id: string; file_name: string; created_at: string; kind: 'contrato' | 'aditivo' }[]
  isAdmin: boolean
  reading: ContractReading | null
  readingMeta: { created_at: string; file_name: string | null; status: string; error: string | null } | null
  checks: ReadingChecks | null
  hasAiKey: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Record<number, boolean>>({})

  const hasContract = docs.some(d => d.kind === 'contrato')
  const nAd = docs.filter(d => d.kind === 'aditivo').length

  async function run() {
    setError(null)
    if (!hasContract) { setError('Anexe o contrato em PDF acima, como "Contrato".'); return }
    setBusy(true)
    try {
      const r = await readContractWithAI(contractId)
      if (!r.ok) { setError(r.error); router.refresh(); return }
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
            <p className="text-xs text-gray-600">A IA lê o contrato e os aditivos em PDF (vigência, renovação, reajuste, repactuação, equipe, atendimento 24h/sobreaviso, equipamentos, tabela de aplicabilidade, responsabilidades de manutenção, serviços de terceiros, serviços, infraestrutura, normas, SLA, prazos, rescisão, multas e pontos não claros) e indica os caminhos e próximos passos da renovação, citando a cláusula. Confira sempre o trecho citado.</p>
          </div>
          {hasContract ? (
            <div className="flex flex-col items-end gap-1">
              <button onClick={run} disabled={busy || !hasAiKey || !isAdmin} className="rounded-md bg-positive-700 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
                {busy ? 'Lendo o contrato… (pode levar até 2 min)' : reading ? 'Ler de novo' : 'Ler contrato'}
              </button>
              <p className="text-[11px] text-gray-500">Lê o contrato{nAd ? ` + ${nAd} aditivo(s)` : ''} em PDF, juntos.</p>
            </div>
          ) : (
            <p className="text-xs text-gray-600">Anexe o contrato em <strong>PDF</strong> acima, como “Contrato”, para o Farmer ler.</p>
          )}
        </div>
        {!isAdmin && hasContract && <p className="mt-2 text-xs text-gray-600">🔒 Só o Admin do CRM pode pedir a leitura (cada leitura tem custo de IA). Você pode ver o resultado e criar atividades.</p>}
        {!hasAiKey && <p className="mt-2 text-xs text-warn-700">A empresa ainda não cadastrou a chave da IA (Configurações → Agentes IA).</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
        {readingMeta && (
          <p className="mt-2 text-[11px] text-gray-500">
            Última leitura: {new Date(readingMeta.created_at).toLocaleString('pt-BR')} · {readingMeta.file_name}
            {readingMeta.status === 'erro' && <span className="text-red-700"> · falhou: {readingMeta.error}</span>}
          </p>
        )}
        {readingMeta && docs.some(d => d.created_at > readingMeta.created_at) && (
          <p className="mt-1 text-[11px] font-medium text-warn-700">Há documento anexado depois da última leitura — clique em “Ler de novo” para incluí-lo.</p>
        )}
      </div>

      {reading && checks && (
        <>
          {reading.avisos.length > 0 && (
            <div role="alert" className="rounded-xl border border-warn-600/40 bg-warn-600/10 p-3 text-xs text-warn-700">
              {reading.avisos.map((a, i) => <p key={i}>⚠ {a}</p>)}
            </div>
          )}
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
                {reading.aviso_previo.dias ? ` · ${reading.aviso_previo.dias} dias antes do fim` : ''}
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
            {reading.proximos_passos.length ? (
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

          {/* Caminhos de renovação */}
          {reading.caminhos_renovacao.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white">
              <p className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-900">Caminhos possíveis para renovar</p>
              <div className="grid gap-3 p-3 sm:grid-cols-2">
                {reading.caminhos_renovacao.map((c, i) => (
                  <div key={i} className="rounded-xl border border-brand-100 bg-brand-100/50 p-3">
                    <p className="text-sm font-semibold text-brand-800">{c.caminho}</p>
                    {c.quando && <p className="mt-1 text-xs text-gray-700"><span className="text-gray-500">Quando:</span> {c.quando}</p>}
                    {c.requisitos && <p className="mt-0.5 text-xs text-gray-700"><span className="text-gray-500">Precisa:</span> {c.requisitos}</p>}
                    {c.clausula && <p className="mt-1 text-[11px] text-brand-700">{c.clausula}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* O que foi lido */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Vigência (início e fim)" value={`${br(reading.vigencia.inicio)} a ${br(reading.vigencia.fim)}${reading.vigencia.prazo_meses ? ` (${reading.vigencia.prazo_meses} meses)` : ''}`} clause={reading.vigencia.clausula} quote={reading.vigencia.trecho} />
            <Fact label="Renovação" value={<>
              <span className="block">Automática: {SIMNAO(reading.renovacao.automatica)}</span>
              <span className="block">Precisa de aditivo: {SIMNAO(reading.renovacao.exige_aditivo)}</span>
              {reading.renovacao.limite && <span className="block text-xs font-normal text-gray-600">Limite: {reading.renovacao.limite}</span>}
              {reading.renovacao.regra && <span className="block text-xs font-normal text-gray-600">{reading.renovacao.regra}</span>}
            </>} clause={reading.renovacao.clausula} quote={reading.renovacao.trecho} />
            <Fact label="Aviso prévio" value={<>{reading.aviso_previo.dias ? `${reading.aviso_previo.dias} dias` : 'Não encontrado'}{reading.aviso_previo.regra && <span className="block text-xs font-normal text-gray-600">{reading.aviso_previo.regra}</span>}</>} clause={reading.aviso_previo.clausula} quote={reading.aviso_previo.trecho} />
            <Fact label="Reajuste (índice)" value={<>{reading.reajuste.indice ?? 'Não encontrado'}{reading.reajuste.periodicidade && <span className="block text-xs font-normal text-gray-600">{reading.reajuste.periodicidade}</span>}{reading.reajuste.data_base && <span className="block text-xs font-normal text-gray-600">Data-base: {br(reading.reajuste.data_base)}</span>}{reading.reajuste.regra && <span className="block text-xs font-normal text-gray-600">{reading.reajuste.regra}</span>}</>} clause={reading.reajuste.clausula} quote={reading.reajuste.trecho} />
            <Fact label="Repactuação" value={<>{SIMNAO(reading.repactuacao.prevista, 'Prevista', 'Não prevista')}{reading.repactuacao.regra && <span className="block text-xs font-normal text-gray-600">{reading.repactuacao.regra}</span>}</>} clause={reading.repactuacao.clausula} quote={reading.repactuacao.trecho} />
            <Fact label="Reequilíbrio econômico-financeiro" value={<>{SIMNAO(reading.reequilibrio.previsto, 'Previsto', 'Não previsto')}{reading.reequilibrio.regra && <span className="block text-xs font-normal text-gray-600">{reading.reequilibrio.regra}</span>}</>} clause={reading.reequilibrio.clausula} quote={reading.reequilibrio.trecho} />
            <Fact label="Valor" value={<>{reading.valor.mensal ? `${fmtBRL(reading.valor.mensal)}/mês` : 'Mensal não encontrado'}{reading.valor.total ? <span className="block text-xs font-normal text-gray-600">Total: {fmtBRL(reading.valor.total)}</span> : null}</>} clause={reading.valor.clausula} />
            <Fact label="Rescisão" value={<>
              {reading.rescisao.multa ? <span className="block">Multa: {reading.rescisao.multa}</span> : <span className="block">Multa não encontrada</span>}
              {reading.rescisao.aviso_dias ? <span className="block text-xs font-normal text-gray-600">Aviso: {reading.rescisao.aviso_dias} dias</span> : null}
              {reading.rescisao.hipoteses.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs font-normal text-gray-600">{reading.rescisao.hipoteses.map((h, i) => <li key={i}>{h}</li>)}</ul>}
            </>} clause={reading.rescisao.clausula} quote={reading.rescisao.trecho} />
            <Fact label="Equipe do projeto" value={reading.equipe.length || reading.equipe_total
              ? `${reading.equipe_total ?? reading.equipe.reduce((a, e) => a + (e.quantidade ?? 0), 0)} pessoa(s)`
              : 'Não encontrada'} />
          </div>

          {reading.nao_claros.length > 0 && (
            <div className="rounded-2xl border border-warn-600/40 bg-white">
              <p className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-warn-700">O que não está claro no contrato <span className="font-normal text-gray-400">· {reading.nao_claros.length}</span></p>
              <ul className="divide-y divide-gray-50">
                {reading.nao_claros.map((x, i) => (
                  <li key={i} className="px-4 py-2.5 text-xs">
                    <p className="font-medium text-gray-900">{x.ponto}</p>
                    {x.por_que && <p className="mt-0.5 text-gray-600">{x.por_que}</p>}
                    {x.sugestao && <p className="mt-0.5 text-gray-700"><span className="text-gray-500">Esclarecer:</span> {x.sugestao}</p>}
                    {x.clausula && <p className="mt-0.5 text-[11px] text-brand-700">{x.clausula}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {reading.versao >= 4 && (
            <>
              <p className="pt-2 text-sm font-semibold text-gray-900">Operação e manutenção</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Fact label="Atendimento" value={<>
                  <span className="block">24 horas: {SIMNAO(reading.atendimento.atendimento_24h, 'Sim', 'Não')}</span>
                  <span className="block">Sobreaviso: {reading.atendimento.sobreaviso === 'sim' ? 'Sim' : reading.atendimento.sobreaviso === 'nao' ? 'Não' : 'O contrato não fala de sobreaviso'}</span>
                  {reading.atendimento.horario && <span className="block text-xs font-normal text-gray-600">Horário: {reading.atendimento.horario}</span>}
                  {reading.atendimento.regra && <span className="block text-xs font-normal text-gray-600">{reading.atendimento.regra}</span>}
                </>} clause={reading.atendimento.clausula} quote={reading.atendimento.trecho} />
                <Fact label="Equipamentos" value={<>
                  <span className="block">Lista no contrato: {SIMNAO(reading.equipamentos.possui_lista, 'Sim', 'Não')}</span>
                  {reading.equipamentos.total && <span className="block text-xs font-normal text-gray-600">Total: {reading.equipamentos.total}</span>}
                  {reading.equipamentos.onde && <span className="block text-xs font-normal text-gray-600">Onde: {reading.equipamentos.onde}</span>}
                </>} />
                <Fact label="Tabela de aplicabilidade" value={<>
                  <span className="block">{SIMNAO(reading.tabela_aplicabilidade.possui, 'Possui', 'Não possui')}</span>
                  {reading.tabela_aplicabilidade.onde && <span className="block text-xs font-normal text-gray-600">Onde: {reading.tabela_aplicabilidade.onde}</span>}
                  {reading.tabela_aplicabilidade.resumo && <span className="block text-xs font-normal text-gray-600">{reading.tabela_aplicabilidade.resumo}</span>}
                </>} clause={reading.tabela_aplicabilidade.clausula} />
              </div>
              <ListTable title="Equipamentos cobertos" head={['Equipamento', 'Qtd.', 'Observação', 'Cláusula']}
                rows={reading.equipamentos.itens.map(x => [x.equipamento, x.quantidade ?? '—', x.observacao ?? '—', x.clausula ?? '—'])} />
              <ListTable title="Responsabilidades de manutenção" head={['Item', 'Quem responde', 'Detalhe', 'Cláusula']}
                rows={reading.responsabilidades_manutencao.map(x => [x.item, RESP[x.responsavel], x.detalhe ?? '—', x.clausula ?? '—'])} />
              <ListTable title="Serviços de terceiros" head={['Serviço', 'Responsável', 'Detalhe', 'Cláusula']}
                rows={reading.servicos_terceiros.map(x => [x.servico, RESP[x.responsavel], x.detalhe ?? '—', x.clausula ?? '—'])} />
            </>
          )}

          <ListTable title="O que os aditivos mudaram" head={['Documento', 'Alteração', 'Cláusula']}
            rows={reading.alteracoes_aditivos.map(x => [x.documento, x.alteracao, x.clausula ?? '—'])} />
          <ListTable title="Serviços aplicáveis" head={['Serviço', 'Previsto', 'Detalhe', 'Periodicidade', 'Cláusula']}
            rows={reading.servicos.map(x => [x.servico, SIMNAO(x.previsto, 'Sim', 'Não'), x.detalhe ?? '—', x.periodicidade ?? '—', x.clausula ?? '—'])} />
          <ListTable title="Infraestrutura necessária" head={['Recurso', 'Quem fornece', 'Detalhe', 'Cláusula']}
            rows={reading.infraestrutura.map(x => [x.item, RESP[x.responsavel], x.detalhe ?? '—', x.clausula ?? '—'])} />
          <ListTable title="Normas a cumprir" head={['Norma', 'Exigência', 'Cláusula']}
            rows={reading.normativas.map(x => [x.norma, x.exigencia ?? '—', x.clausula ?? '—'])} />
          <ListTable title="Equipe do projeto" head={['Função', 'Qtd.', 'Regime', 'Cláusula']}
            rows={reading.equipe.map(e => [e.funcao, e.quantidade ?? '—', e.regime ?? '—', e.clausula ?? '—'])} />
          <ListTable title="Quantitativos contratados" head={['Item', 'Quantidade', 'Cláusula']}
            rows={reading.quantitativos.map(q => [q.item, q.quantidade, q.clausula ?? '—'])} />
          <ListTable title="Principais ações do objeto" head={['Ação', 'Frequência', 'Cláusula']}
            rows={reading.acoes_objeto.map(a => [a.acao, a.frequencia ?? '—', a.clausula ?? '—'])} />
          <ListTable title="SLA (níveis de serviço)" head={['Indicador', 'Meta', 'Prazo', 'Penalidade', 'Cláusula']}
            rows={reading.sla.map(x => [x.indicador, x.meta ?? '—', x.prazo ?? '—', x.penalidade ?? '—', x.clausula ?? '—'])} />
          <ListTable title="Prazos do contrato" head={['O quê', 'Prazo', 'Cláusula']}
            rows={reading.prazos.map(x => [x.descricao, br(x.prazo), x.clausula ?? '—'])} />
          <ListTable title="Multas e penalidades" head={['Situação', 'Penalidade', 'Cláusula']}
            rows={reading.multas.map(x => [x.situacao, x.penalidade, x.clausula ?? '—'])} />

          {(reading.riscos.length > 0 || reading.obrigacoes_relevantes.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {reading.riscos.length > 0 && (
                <div className="rounded-xl border border-negative-100 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-negative-700">Pontos de atenção</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-700">{reading.riscos.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
              {reading.obrigacoes_relevantes.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Obrigações que pesam na renovação</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-700">{reading.obrigacoes_relevantes.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          {reading.objeto && <p className="text-xs text-gray-500"><strong>Objeto:</strong> {reading.objeto}{reading.numero ? ` · Nº ${reading.numero}` : ''}{reading.contratante ? ` · Contratante: ${reading.contratante}` : ''}{reading.contratada ? ` · Contratada: ${reading.contratada}` : ''}</p>}
          {reading.versao < 4 && <p className="text-[11px] text-warn-700">Esta leitura foi feita numa versão anterior e não traz {reading.versao < 3 ? 'infraestrutura, serviços aplicáveis, normas, pontos não claros, ' : ''}atendimento 24h/sobreaviso, equipamentos, tabela de aplicabilidade, responsabilidades de manutenção e serviços de terceiros. Clique em “Ler de novo” para a leitura completa.</p>}
        </>
      )}
    </div>
  )
}
