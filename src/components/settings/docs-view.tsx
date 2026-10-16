'use client'

// Documentação do sistema — 6 abas (Produto, Técnico, Fluxos, Design System,
// Banco de dados, Plano de implementação). Conteúdo neutro: vale para qualquer
// empresa que use o CRM.

import { useMemo, useState } from 'react'
import { fmtBRL, fmtPct } from '@/lib/format'
import type { PageHelp } from '@/lib/help/page-help'

export type SchemaTable = {
  table: string; rls: boolean; tenant: boolean
  columns: { name: string; type: string; nullable: boolean }[] | null
  fks: { column: string; ref: string }[]
}

type Tab = 'prd' | 'trd' | 'fluxos' | 'design' | 'banco' | 'plano'
const TABS: { id: Tab; n: number; label: string; sub: string }[] = [
  { id: 'prd', n: 1, label: 'Produto (PRD)', sub: 'Ideia, público, objetivos e funcionalidades' },
  { id: 'trd', n: 2, label: 'Técnico (TRD)', sub: 'Linguagem, ferramentas e integrações' },
  { id: 'fluxos', n: 3, label: 'Fluxos', sub: 'O caminho de cada processo, passo a passo' },
  { id: 'design', n: 4, label: 'Design System', sub: 'Cores, fontes, componentes e números' },
  { id: 'banco', n: 5, label: 'Banco de dados', sub: 'Tabelas, colunas e relacionamentos' },
  { id: 'plano', n: 6, label: 'Plano de implementação', sub: 'O que está pronto e o que falta' },
]

export function DocsView({ features, schema, schemaError, versions }: {
  features: PageHelp[]; schema: SchemaTable[]; schemaError: string | null
  versions: Record<'next' | 'react' | 'supabase' | 'anthropic' | 'recharts' | 'zod', string>
}) {
  const [tab, setTab] = useState<Tab>('prd')
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Documentação do sistema</h1>
        <p className="text-sm text-gray-500">Tudo o que o CRM é e como funciona, em 6 partes. As funcionalidades e o banco de dados são lidos do próprio sistema.</p>
      </div>
      <nav className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Partes da documentação">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id}
            className={`rounded-xl border p-3 text-left transition ${tab === t.id ? 'border-brand-700 bg-brand-700 text-white' : 'border-gray-200 bg-white text-gray-900 hover:border-brand-700'}`}>
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${tab === t.id ? 'text-white/70' : 'text-gray-400'}`}>{t.n}.</span>
            <span className="block text-sm font-semibold">{t.label}</span>
            <span className={`block text-[11px] ${tab === t.id ? 'text-white/80' : 'text-gray-500'}`}>{t.sub}</span>
          </button>
        ))}
      </nav>
      {tab === 'prd' && <Prd features={features} />}
      {tab === 'trd' && <Trd versions={versions} />}
      {tab === 'fluxos' && <Fluxos />}
      {tab === 'design' && <Design />}
      {tab === 'banco' && <Banco schema={schema} error={schemaError} />}
      {tab === 'plano' && <Plano />}
    </div>
  )
}

function Card({ title, children, tone }: { title: string; children: React.ReactNode; tone?: 'brand' | 'good' | 'warn' | 'purple' }) {
  const bar = tone === 'good' ? 'bg-positive-600' : tone === 'warn' ? 'bg-warn-600' : tone === 'purple' ? 'bg-accent-purple' : 'bg-brand-700'
  return (
    <section className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5">
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm text-gray-700">{children}</div>
    </section>
  )
}

// ─── 1. PRD ─────────────────────────────────────────────────────────────────
function Prd({ features }: { features: PageHelp[] }) {
  const [q, setQ] = useState('')
  const list = features.filter(f => !q || `${f.title} ${f.text} ${(f.tips ?? []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="💡 Ideia" tone="warn">
          <p>CRM comercial multiempresa (vendido por licença) para empresas de serviços com contratos <strong>recorrentes</strong> e <strong>por medição</strong> e serviços <strong>avulsos</strong>.</p>
          <p>Cobre do lead ao faturamento e à renovação, com dois agentes de IA: <strong>Hunter</strong> (novos negócios) e <strong>Farmer</strong> (carteira).</p>
        </Card>
        <Card title="👥 Público" tone="good">
          <ul className="list-disc space-y-1 pl-4">
            <li><strong>Gestor / diretoria</strong>: Painel gerencial, metas, faturado.</li>
            <li><strong>Consultores</strong>: Hunter (vendas) e Farmer (carteira, renovação).</li>
            <li><strong>Financeiro</strong>: envios para faturamento e retorno do faturado.</li>
            <li><strong>Administrador da empresa</strong>: configurações, integrações, leitura de contratos.</li>
            <li><strong>Super Admin da plataforma</strong>: licenças, planos e abas.</li>
          </ul>
        </Card>
        <Card title="🎯 Objetivos" tone="purple">
          <ul className="list-disc space-y-1 pl-4">
            <li>Nenhuma oportunidade ou proposta parada sem ação.</li>
            <li>Receita protegida: em contrato x enviado x faturado, com a diferença explicada.</li>
            <li>Meta do mês comparada com o <strong>faturado</strong>.</li>
            <li>Renovação no prazo, com o contrato lido e os próximos passos.</li>
            <li>Todo o histórico do cliente num lugar só.</li>
          </ul>
        </Card>
      </div>
      <Card title={`🧩 Funcionalidades (${features.length} telas)`}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar funcionalidade…" aria-label="Buscar funcionalidade"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm sm:w-80" />
        <div className="grid gap-3 md:grid-cols-2">
          {list.map(f => (
            <div key={f.title} className="rounded-xl border border-gray-100 p-3">
              <p className="font-semibold text-gray-900">{f.title}</p>
              <p className="mt-0.5 text-xs text-gray-600">{f.text}</p>
              {f.tips && f.tips.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-gray-500">{f.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-xs text-gray-500">Nada encontrado.</p>}
        </div>
      </Card>
    </div>
  )
}

// ─── 2. TRD ─────────────────────────────────────────────────────────────────
function Trd({ versions }: { versions: Record<string, string> }) {
  const stack: [string, string, string][] = [
    ['TypeScript', '', 'Linguagem de todo o sistema (telas e servidor).'],
    ['Next.js', versions.next, 'Framework web: telas (App Router), ações no servidor e rotas de integração.'],
    ['React', versions.react, 'Biblioteca das telas.'],
    ['Tailwind CSS', '4', 'Estilos, com as cores da paleta oficial como tokens.'],
    ['Supabase', versions.supabase, 'Banco Postgres, login, arquivos (Storage) e segurança por empresa (RLS).'],
    ['Vercel', '', 'Hospedagem, publicação automática a cada atualização e rotinas agendadas.'],
    ['Claude (Anthropic)', versions.anthropic, 'Agentes Hunter e Farmer, Copiloto e leitura de contratos.'],
    ['Recharts · Zod · pdf-lib · xlsx', `${versions.recharts} · ${versions.zod}`, 'Gráficos, validação de dados, PDFs de proposta e planilhas.'],
  ]
  const integ: [string, string, string][] = [
    ['WhatsApp (Evolution API)', 'Servidor da plataforma; os números (instâncias) pertencem a cada empresa, com limite por plano.', 'Central de WhatsApp, avisos ao cliente e resumo do gestor.'],
    ['E-mail', 'Gmail conectado por usuário (Minha Conta) e e-mail de entrada por empresa.', 'Envio e histórico de e-mails no contrato.'],
    ['IA (Anthropic)', 'Chave da empresa, guardada criptografada.', 'Copiloto, agentes e leitura de contrato (só Admin dispara a leitura).'],
    ['ZapSign', 'Volta gratuita por webhook (endereço com chave da empresa); ida só com Plano de API.', 'Assinatura de contratos e aditivos; PDF assinado volta para o contrato.'],
    ['Faturamento (Sankhya, TOTVS…)', 'Ida: manual ou webhook (CNPJ do cliente, assinado). Volta: endereço de retorno com chave.', 'Enviado para faturamento → faturado, sem depender da API do ERP.'],
  ]
  const crons: [string, string, string][] = [
    ['Renovações', '03:00 todo dia', 'Abre a passagem de renovação dos contratos que vencem.'],
    ['Automações', '04:00 todo dia', 'Regras por tempo (Configurações → Automações).'],
    ['Avisos de vencimento (Farmer)', '05:00 todo dia', 'Marcos de 60, 30, 15 dias e vencido; tarefas e rascunhos para revisar.'],
    ['Resumo do gestor', '07:00 seg a sex', 'Resumo do dia pelo WhatsApp do gestor.'],
  ]
  return (
    <div className="grid gap-4">
      <Card title="🧑‍💻 Linguagem e ferramentas">
        <Table head={['Item', 'Versão', 'Para que serve']} rows={stack.map(([a, b, c]) => [a, b || '—', c])} />
      </Card>
      <Card title="🔌 Integrações" tone="warn">
        <Table head={['Integração', 'Como conecta', 'Uso']} rows={integ} />
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="🏢 Multiempresa (regra principal)" tone="good">
          <ul className="list-disc space-y-1 pl-4">
            <li>Tudo funciona para qualquer empresa, inclusive as futuras; nada fica fixo para uma empresa.</li>
            <li>Cada tabela com dados de empresa tem <code>tenant_id</code> e trava no banco (RLS <code>tenant_guard</code>).</li>
            <li>Dados de cada empresa ficam em Configurações (linha da empresa) — textos, chaves, números de WhatsApp.</li>
            <li>Rotinas agendadas rodam uma vez por empresa ativa.</li>
            <li>Super Admin só vê outra empresa pelo “Acessar”.</li>
          </ul>
        </Card>
        <Card title="🔒 Segurança" tone="purple">
          <ul className="list-disc space-y-1 pl-4">
            <li>Login pelo Supabase; permissões por papel (Admin, usuário).</li>
            <li>Chaves de integração por empresa; a chave da IA é criptografada.</li>
            <li>Endereços públicos de integração (ZapSign, faturamento, WhatsApp) exigem chave e só gravam na empresa dona.</li>
            <li>Ações de custo ou financeiras só pelo Admin (leitura de contrato, lançar faturado, cancelar envio).</li>
          </ul>
        </Card>
      </div>
      <Card title="⏰ Rotinas automáticas (horário de Brasília)">
        <Table head={['Rotina', 'Quando', 'O que faz']} rows={crons} />
      </Card>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500"><tr>{head.map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-3 py-2 align-top ${j === 0 ? 'font-medium text-gray-900' : 'text-gray-600'}`}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  )
}

// ─── 3. Fluxos ──────────────────────────────────────────────────────────────
const FLOWS: { title: string; who: string; color: string; steps: { t: string; d: string }[] }[] = [
  { title: 'Novos negócios', who: 'Hunter', color: 'bg-warn-600', steps: [
    { t: 'Lead', d: 'Chega por formulário, WhatsApp ou cadastro; é qualificado e roteado.' },
    { t: 'Oportunidade', d: 'Funil de vendas, etapa a etapa, com prazo por etapa.' },
    { t: 'Proposta', d: 'Montada no CRM, aprovada e enviada ao cliente.' },
    { t: 'Assinatura', d: 'ZapSign (ou contrato do cliente anexado como assinado).' },
    { t: 'Tarefa de ganho', d: 'Consultor valida vigência, valor e tipo de receita.' },
    { t: 'Ganho', d: 'Conta vai para a carteira com o consultor responsável.' },
  ] },
  { title: 'Carteira e faturamento do contrato', who: 'Farmer', color: 'bg-positive-600', steps: [
    { t: 'Em contrato', d: '100% do valor do contrato (potencial) no mês.' },
    { t: 'Apurar', d: 'Recorrente: consultor confirma (com ou sem desconto). Medição: validada com relatório até o dia definido.' },
    { t: 'Enviar', d: 'Comercial envia ao faturamento (manual ou webhook com CNPJ).' },
    { t: 'Faturado', d: 'Volta do sistema de faturamento (ou lançado pelo Admin).' },
    { t: 'Painel', d: 'Meta x faturado; diferença explicada por motivo.' },
  ] },
  { title: 'Serviço avulso', who: 'Hunter', color: 'bg-accent-purple', steps: [
    { t: 'Oportunidade avulsa', d: 'Valor fechado do serviço.' },
    { t: 'Execução', d: 'Serviço realizado.' },
    { t: 'Relatório', d: 'Anexado na oportunidade; o Hunter abre a tarefa de dar ganho.' },
    { t: 'Ganho', d: 'Envio automático ao faturamento, sem validação mensal.' },
    { t: 'Faturado', d: 'Volta do sistema de faturamento e soma na meta.' },
  ] },
  { title: 'Renovação', who: 'Farmer', color: 'bg-brand-700', steps: [
    { t: 'Avisos', d: 'Marcos de 60, 30, 15 dias e vencido; rascunho para o consultor revisar.' },
    { t: 'Leitura do contrato', d: 'IA lê contrato + aditivos (Admin) e indica caminhos e próximos passos.' },
    { t: 'Proposta / aditivo', d: 'Reajuste pelo índice, novo valor e vigência.' },
    { t: 'Assinatura', d: 'ZapSign ou anexo assinado.' },
    { t: 'Ganho de renovação', d: 'Nova vigência e valor; o antes x depois entra no Painel.' },
  ] },
]
function Fluxos() {
  return (
    <div className="grid gap-4">
      {FLOWS.map(f => (
        <section key={f.title} className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">{f.title}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${f.color}`}>{f.who}</span>
          </div>
          <ol className="mt-3 flex flex-col gap-2 md:flex-row md:items-stretch">
            {f.steps.map((s, i) => (
              <li key={s.t} className="flex flex-1 items-stretch gap-2">
                <div className="flex-1 rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white ${f.color}`}>{i + 1}</span>{s.t}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-600">{s.d}</p>
                </div>
                {i < f.steps.length - 1 && <span aria-hidden="true" className="hidden self-center text-gray-300 md:block">→</span>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

// ─── 4. Design System ───────────────────────────────────────────────────────
const PRIMARY = [['#1B556B', 'Azul petróleo', 'marca, botões, títulos'], ['#E98C5F', 'Laranja', 'atenção, Hunter'], ['#32AF9D', 'Verde', 'positivo, Farmer, faturado']]
const SECONDARY = [['#83D0F5', 'Azul claro'], ['#00AFD1', 'Azul'], ['#FFE596', 'Creme'], ['#524E9C', 'Roxo'], ['#AF5B65', 'Vinho (negativo)'], ['#FBEE66', 'Amarelo']]
function Design() {
  return (
    <div className="grid gap-4">
      <Card title="🎨 Cores (paleta oficial — só estas)">
        <p className="text-xs text-gray-500">Primárias</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRIMARY.map(([hex, name, use]) => (
            <div key={hex} className="flex items-center gap-3 rounded-xl border border-gray-100 p-2">
              <span className="h-10 w-10 rounded-lg" style={{ background: hex }} />
              <div><p className="text-xs font-semibold text-gray-900">{name} <span className="font-mono font-normal text-gray-500">{hex}</span></p><p className="text-[11px] text-gray-500">{use}</p></div>
            </div>
          ))}
        </div>
        <p className="pt-2 text-xs text-gray-500">Secundárias</p>
        <div className="flex flex-wrap gap-2">
          {SECONDARY.map(([hex, name]) => (
            <div key={hex} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2 py-1">
              <span className="h-5 w-5 rounded" style={{ background: hex }} /><span className="text-[11px] text-gray-700">{name} <span className="font-mono text-gray-400">{hex}</span></span>
            </div>
          ))}
        </div>
        <p className="pt-2 text-[11px] text-gray-500">No código, use os tokens <code>brand</code>, <code>positive</code>, <code>warn</code>, <code>negative</code> e <code>accent-*</code> (definidos em <code>globals.css</code>); vermelho/verde/laranja do Tailwind já apontam para a paleta.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="🔤 Fontes" tone="purple">
          <p className="text-2xl font-semibold tracking-tight text-gray-900">Título da tela</p>
          <p className="text-sm font-semibold text-gray-900">Título de bloco</p>
          <p className="text-sm text-gray-700">Texto normal das telas.</p>
          <p className="text-[11px] text-gray-500">Texto de apoio e legendas.</p>
          <p className="text-[11px] text-gray-500">Fonte do sistema (system-ui); números em colunas usam algarismos tabulares.</p>
        </Card>
        <Card title="🔢 Números (padrão brasileiro)" tone="good">
          <p>Dinheiro sempre com centavos: <strong>{fmtBRL(1234567.8)}</strong></p>
          <p>Porcentagem sempre com 1 casa: <strong>{fmtPct(87.25)}</strong></p>
          <p>Datas: <strong>16/10/2026</strong> · fuso de Brasília.</p>
        </Card>
      </div>
      <Card title="🧱 Componentes">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white">Botão principal</button>
          <button type="button" className="rounded-md border border-brand-700 px-3 py-1.5 text-sm font-medium text-brand-700">Secundário</button>
          <button type="button" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700">Neutro</button>
          <input aria-label="Exemplo de campo" placeholder="Campo de texto" className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <span className="rounded-full bg-positive-100 px-2 py-0.5 text-[11px] font-medium text-positive-700">Faturado</span>
          <span className="rounded-full bg-brand-700 px-2 py-0.5 text-[11px] font-medium text-white">Enviado</span>
          <span className="rounded-full bg-warn-600/15 px-2 py-0.5 text-[11px] font-medium text-warn-700">Pendente</span>
          <span className="rounded-full bg-negative-100 px-2 py-0.5 text-[11px] font-medium text-negative-700">Atrasado</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">Neutro</span>
        </div>
        <p className="pt-2 text-[11px] text-gray-500">Toda tela nova tem explicação no “ⓘ Como funciona esta tela” e, se for aba do menu, ao passar o mouse.</p>
      </Card>
    </div>
  )
}

// ─── 5. Banco de dados ──────────────────────────────────────────────────────
const GROUPS: { name: string; test: (t: string) => boolean }[] = [
  { name: 'Contratos e oportunidades', test: t => /^(contract|pipeline|stage|lost_reason|tag|custom_field|dimensioning|transfer)/.test(t) },
  { name: 'Receita e faturamento', test: t => /^(billing|monthly_goal|contract_measurement|contract_renewal)/.test(t) },
  { name: 'Propostas e assinatura', test: t => /^(proposal|zapsign)/.test(t) },
  { name: 'Clientes e leads', test: t => /^(compan|contact|lead)/.test(t) },
  { name: 'Comunicação e atendimento', test: t => /(whatsapp|email|ticket|notification|activit|task_comment)/.test(t) },
  { name: 'Pesquisas', test: t => /(nps|survey|form)/.test(t) },
  { name: 'Empresa, usuários e plataforma', test: t => /^(organization|profile|tenant|plan|price|assistant|automation|implementation|wallpaper)/.test(t) },
]
function Banco({ schema, error }: { schema: SchemaTable[]; error: string | null }) {
  const [q, setQ] = useState('')
  const grouped = useMemo(() => {
    const list = schema.filter(t => !q || t.table.includes(q.toLowerCase()) || (t.columns ?? []).some(c => c.name.includes(q.toLowerCase())))
    const used = new Set<string>()
    const out = GROUPS.map(g => ({ name: g.name, tables: list.filter(t => { if (used.has(t.table) || !g.test(t.table)) return false; used.add(t.table); return true }) }))
    out.push({ name: 'Outras', tables: list.filter(t => !used.has(t.table)) })
    return out.filter(g => g.tables.length > 0)
  }, [schema, q])
  if (error) return <Card title="Banco de dados"><p className="text-xs text-negative-700">Não foi possível ler a estrutura agora: {error}</p></Card>
  const withTenant = schema.filter(t => t.tenant).length
  return (
    <div className="grid gap-4">
      <Card title="🗄️ Visão geral">
        <p>{schema.length} tabelas (Postgres/Supabase). {withTenant} têm <code>tenant_id</code> (dados de empresa); {schema.filter(t => t.rls).length} com trava de segurança por linha (RLS).</p>
        <p className="text-xs text-gray-500">Centro do modelo: <strong>contracts</strong> (a oportunidade/contrato) → <strong>pipeline_runs</strong> (passagens pelos funis) · <strong>billing_records</strong> (apurado do mês) → <strong>billing_submissions</strong> (enviado/faturado) · <strong>contract_files</strong> (arquivos, contrato e aditivos) · <strong>activities</strong> (linha do tempo e tarefas).</p>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar tabela ou coluna…" aria-label="Buscar tabela ou coluna" className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm sm:w-80" />
      </Card>
      {grouped.map(g => (
        <section key={g.name} className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">{g.name} <span className="font-normal text-gray-400">· {g.tables.length}</span></h2>
          <div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {g.tables.map(t => (
              <details key={t.table} className="rounded-xl border border-gray-100 p-2.5">
                <summary className="cursor-pointer text-xs font-semibold text-gray-900">
                  <span className="font-mono">{t.table}</span>
                  <span className="ml-1.5 font-normal text-gray-400">{(t.columns ?? []).length} col.</span>
                  {t.tenant && <span className="ml-1.5 rounded bg-brand-100 px-1 text-[9px] text-brand-800">empresa</span>}
                  {t.rls && <span className="ml-1 rounded bg-positive-100 px-1 text-[9px] text-positive-700">RLS</span>}
                </summary>
                <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-gray-600">
                  {(t.columns ?? []).map(c => {
                    const fk = t.fks.find(f => f.column === c.name)
                    return <li key={c.name}>{c.name} <span className="text-gray-400">{c.type}{c.nullable ? '' : ' · obrig.'}</span>{fk && <span className="text-brand-700"> → {fk.ref}</span>}</li>
                  })}
                </ul>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ─── 6. Plano de implementação ──────────────────────────────────────────────
const PLAN: { step: string; status: 'ok' | 'andamento' | 'pendente'; items: string[] }[] = [
  { step: 'Base', status: 'ok', items: ['Multiempresa com trava por empresa (RLS) em todas as tabelas', 'Planos e abas por licença; Super Admin', 'Ajuda em todas as telas'] },
  { step: 'Banco', status: 'ok', items: ['Contratos, funis, propostas, atividades', 'Apurado do mês (recorrente/medição) e envios para faturamento', 'Contrato e aditivos, leituras da IA, documentos da ZapSign'] },
  { step: 'Telas', status: 'ok', items: ['Funil, oportunidades, carteira, propostas', 'Painel gerencial (mês e consolidado), Financeiro', 'Agentes Farmer e Hunter; central de WhatsApp com busca'] },
  { step: 'Integrar', status: 'andamento', items: ['WhatsApp (Evolution) e e-mail: ligados', 'IA: agentes e leitura de contrato ligados', 'ZapSign: volta gratuita por webhook pronta — falta o primeiro teste real', 'Faturamento: ida por webhook e volta prontas no CRM — falta o endereço do lado do sistema de faturamento'] },
  { step: 'Testar', status: 'pendente', items: ['Assinatura de ponta a ponta (registrar → assinar → PDF volta → tarefa → WhatsApp do gestor)', 'Faturamento de ponta a ponta (enviar → faturado volta → meta)', 'Aviso do Farmer para recorrência do mês não confirmada', 'Conferir dados de cada empresa: CNPJ dos clientes, vigências, número do gestor'] },
]
function Plano() {
  const badge = { ok: 'bg-positive-600 text-white', andamento: 'bg-warn-600 text-white', pendente: 'bg-gray-200 text-gray-700' }
  const label = { ok: 'Pronto', andamento: 'Em andamento', pendente: 'A fazer' }
  return (
    <div className="grid gap-4">
      <ol className="flex flex-wrap items-center gap-2">
        {PLAN.map((p, i) => (
          <li key={p.step} className="flex items-center gap-2">
            <span className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${badge[p.status]}`}>{i + 1}. {p.step}</span>
            {i < PLAN.length - 1 && <span aria-hidden="true" className="text-gray-300">→</span>}
          </li>
        ))}
      </ol>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PLAN.map((p, i) => (
          <Card key={p.step} title={`${i + 1}. ${p.step} — ${label[p.status]}`} tone={p.status === 'ok' ? 'good' : p.status === 'andamento' ? 'warn' : 'purple'}>
            <ul className="list-disc space-y-1 pl-4 text-xs">{p.items.map(it => <li key={it}>{it}</li>)}</ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
