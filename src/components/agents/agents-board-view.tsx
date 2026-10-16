// Tela dos agentes: Farmer (carteira) de um lado, Hunter (novos negócios) do outro.
// Cada item é um cliente com os dados dele — sem resumo em texto.

import Link from 'next/link'
import type { AgentsBoard, BoardRow } from '@/lib/agent/agents-board'
import { fmtBRL } from '@/lib/format'

const MONEY = new Set(['Valor/mês', 'Potencial', 'Valor perdido', 'Receita/mês perdida', 'Valor'])
const VISIBLE = 6

function fmtCell(key: string, v: string | number | null) {
  if (v === null || v === undefined || v === '') return '—'
  if (MONEY.has(key) && typeof v === 'number') return fmtBRL(v)
  return String(v)
}

function Row({ r }: { r: BoardRow }) {
  const bar = r.tone === 'bad' ? 'bg-negative-600' : r.tone === 'warn' ? 'bg-warn-600' : r.tone === 'good' ? 'bg-positive-600' : 'bg-gray-200'
  const entries = Object.entries(r.cols)
  const main = entries.find(([k]) => MONEY.has(k))
  const rest = entries.filter(e => e !== main)
  const inner = (
    <div className="relative flex gap-3 py-2.5 pl-3 pr-2">
      <span aria-hidden="true" className={`absolute inset-y-2 left-0 w-1 rounded-full ${bar}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">
          {r.client}
          {r.number && <span className="ml-1.5 font-mono text-[10px] font-normal text-gray-400">{r.number}</span>}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
          {rest.map(([k, v]) => (
            <span key={k}><span className="text-gray-400">{k}:</span> <span className="text-gray-700">{fmtCell(k, v)}</span></span>
          ))}
        </div>
      </div>
      {main && <span className="shrink-0 self-center text-sm font-semibold tabular-nums text-gray-900">{fmtCell(main[0], main[1])}</span>}
    </div>
  )
  return r.href
    ? <Link href={r.href} className="block rounded-lg hover:bg-gray-50">{inner}</Link>
    : <div>{inner}</div>
}

function Block({ title, hint, rows, empty }: { title: string; hint: string; rows: BoardRow[]; empty: string }) {
  const first = rows.slice(0, VISIBLE)
  const more = rows.slice(VISIBLE)
  const bad = rows.filter(r => r.tone === 'bad').length
  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="text-[11px] text-gray-500">{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {bad > 0 && <span className="rounded-full bg-negative-100 px-2 py-0.5 text-[11px] font-semibold text-negative-700">{bad} crítico(s)</span>}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${rows.length ? 'bg-gray-100 text-gray-700' : 'bg-positive-100 text-positive-700'}`}>{rows.length}</span>
        </div>
      </div>
      <div className="px-2 py-1">
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-xs text-positive-700">✓ {empty}</p>
        ) : (
          <>
            <div className="divide-y divide-gray-50">{first.map((r, i) => <Row key={i} r={r} />)}</div>
            {more.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-brand-700 hover:underline">
                  <span className="group-open:hidden">Ver mais {more.length}</span>
                  <span className="hidden group-open:inline">Mostrar menos</span>
                </summary>
                <div className="divide-y divide-gray-50">{more.map((r, i) => <Row key={i} r={r} />)}</div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function ColumnHeader({ agent, title, subtitle, chips }: { agent: 'farmer' | 'hunter'; title: string; subtitle: string; chips: { label: string; n: number }[] }) {
  const bg = agent === 'farmer' ? 'bg-positive-600' : 'bg-warn-600'
  return (
    <div className={`rounded-2xl ${bg} p-4 text-white`}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">{agent === 'farmer' ? '🌱' : '🎯'}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <p className="mt-0.5 text-xs text-white/85">{subtitle}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map(c => (
          <span key={c.label} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${c.n ? 'bg-white text-gray-900' : 'bg-white/20 text-white'}`}>
            {c.n} {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function AgentsBoardView({ board }: { board: AgentsBoard }) {
  const f = board.farmer
  const h = board.hunter
  const refLabel = `${String(board.reference.month).padStart(2, '0')}/${board.reference.year}`
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Agentes IA</h1>
          <p className="text-sm text-gray-500">
            O que cada agente está acompanhando agora, cliente por cliente. Clique em um item para abrir.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Atualizado às {new Date(board.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span>
          <Link href="/briefing" className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50">↻ Atualizar</Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* FARMER */}
        <div className="flex min-w-0 flex-col gap-4">
          <ColumnHeader agent="farmer" title="Farmer · Carteira" subtitle="Contratos, renovações, medição, satisfação e atendimento"
            chips={[
              { label: 'renovações', n: f.renewals.length },
              { label: 'medições', n: f.measurements.length },
              { label: 'perdas', n: f.losses.length },
              { label: 'rescisões', n: f.churn.length },
              { label: 'tarefas', n: f.tasks.length },
            ]} />
          <Block title="Renovações" hint="Contratos vencidos e a vencer em até 120 dias" rows={f.renewals} empty="Nenhum contrato vencendo." />
          <Block title={`Medições pendentes (${refLabel})`} hint="Sem medição validada — ainda não faturado" rows={f.measurements} empty="Medições do mês validadas." />
          <Block title="Perdas no faturamento" hint="Descontos, glosas e medição abaixo do valor do contrato" rows={f.losses} empty="Nenhuma perda registrada." />
          <Block title="Rescisões (90 dias)" hint="Contratos perdidos e a receita mensal que saiu" rows={f.churn} empty="Nenhuma rescisão recente." />
          <Block title="Tarefas abertas do Farmer" hint="Avisos de renovação, e-mails internos, implantação e medição" rows={f.tasks} empty="Nenhuma tarefa aberta." />
          <Block title="Planos de ação pendentes" hint="Itens em aberto por cliente" rows={f.actionPlans} empty="Nenhum plano pendente." />
          <Block title="Clientes insatisfeitos (NPS ≤ 6)" hint="Respostas dos últimos 90 dias" rows={f.detractors} empty="Nenhum detrator recente." />
          <Block title="Chamados fora do prazo" hint="Atendimentos abertos com prazo vencido" rows={f.overdueTickets} empty="Nenhum chamado atrasado." />
        </div>

        {/* HUNTER */}
        <div className="flex min-w-0 flex-col gap-4">
          <ColumnHeader agent="hunter" title="Hunter · Novos negócios" subtitle="Oportunidades, propostas, leads e serviços avulsos"
            chips={[
              { label: 'paradas', n: h.stalled.length },
              { label: 'propostas', n: h.proposals.length },
              { label: 'leads', n: h.leads.length },
              { label: 'fechadas no mês', n: h.closed.length },
              { label: 'tarefas', n: h.tasks.length },
            ]} />
          <Block title="Oportunidades paradas" hint="7+ dias sem interação ou acima do prazo da etapa" rows={h.stalled} empty="Nenhuma oportunidade parada." />
          <Block title="Propostas paradas" hint="Sem movimento há 5 dias ou mais" rows={h.proposals} empty="Nenhuma proposta parada." />
          <Block title="Leads sem andamento" hint="Novos ou em qualificação sem atualização (3+ dias)" rows={h.leads} empty="Leads em dia." />
          <Block title="Fechamentos do mês" hint="Vendas e avulsos ganhos ou perdidos neste mês" rows={h.closed} empty="Nenhum fechamento ainda neste mês." />
          <Block title="Avulsos em andamento" hint="Serviços avulsos abertos por etapa" rows={h.avulsos} empty="Nenhum avulso em andamento." />
          <Block title="Tarefas abertas do Hunter" hint="Retomar oportunidades e cobrar propostas" rows={h.tasks} empty="Nenhuma tarefa aberta." />
        </div>
      </div>
    </div>
  )
}
