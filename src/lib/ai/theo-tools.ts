// ─── Théo: execução das ferramentas (servidor) ────────────────────────────────
// Tudo com o cliente do usuário (createClient): o banco só mostra a empresa dele (RLS)
// e as ações seguem as mesmas regras das telas (são as mesmas funções).
// Consultas devolvem texto/JSON curto para a IA; ações só rodam depois da confirmação.

import { createClient } from '@/lib/supabase/server'
import { createCompany, createContact } from '@/lib/actions/companies'
import { moveContractStage, closeRun } from '@/lib/actions/pipeline'
import { createActivity } from '@/lib/actions/activities'
import { createLead, updateLeadStatus, assignLead } from '@/lib/actions/leads'
import { PAID_STATUSES } from '@/lib/retail/customers'
import { searchTerm } from '@/lib/ai/theo-catalog'

type Db = Awaited<ReturnType<typeof createClient>>
type In = Record<string, unknown>

const int = (v: unknown, def: number, min = 0, max = 3650) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def }
const brDate = (iso: string | null | undefined) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-BR') : null)
const todaySP = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
const monthRange = (m: unknown) => {
  const s = /^\d{4}-\d{2}$/.test(String(m ?? '')) ? String(m) : todaySP().slice(0, 7)
  const [y, mo] = s.split('-').map(Number)
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  return { label: s, from: `${s}-01T03:00:00Z`, to: `${next}-01T03:00:00Z` }
}
const json = (v: unknown) => JSON.stringify(v).slice(0, 12_000)

async function userIdByName(db: Db, name: unknown): Promise<{ id: string; name: string } | { error: string }> {
  const term = searchTerm(name)
  if (!term) return { error: 'Informe o nome da pessoa.' }
  const { data } = await db.from('profiles').select('id, full_name').ilike('full_name', `%${term}%`).limit(5)
  const list = (data ?? []) as { id: string; full_name: string }[]
  if (!list.length) return { error: `Não encontrei ninguém da equipe chamado "${term}".` }
  if (list.length > 1) return { error: `Mais de uma pessoa com "${term}": ${list.map(x => x.full_name).join(', ')}. Diga o nome completo.` }
  return { id: list[0].id, name: list[0].full_name }
}

// ─── Consultas ───────────────────────────────────────────────────────────────
// scope: tarefa agendada (sem pessoa logada) — cliente admin já filtrado pela empresa
// (scopeAdminClient; todas as tabelas daqui estão em TENANT_TABLES).
export async function runTheoRead(name: string, input: In, scope?: { db: unknown; userId: string | null }): Promise<string> {
  const db = scope ? (scope.db as Db) : await createClient()
  const user = scope ? (scope.userId ? { id: scope.userId } : null) : (await db.auth.getUser()).data.user
  if (!user && !scope) return 'Usuário não autenticado.'

  switch (name) {
    case 'minhas_atividades': {
      if (!user) return 'Esta consulta depende de quem está logado; em tarefa agendada, peça por responsável ou por oportunidade.'
      const today = todaySP()
      const { data } = await db.from('activities').select('id, title, content, activity_type, activity_date, contract_id, company_id')
        .eq('assigned_to', user.id).eq('status', 'planned').lte('activity_date', today).order('activity_date').limit(40)
      if (!data?.length) return 'Nenhuma atividade para hoje nem atrasada.'
      return json(data.map(a => ({ titulo: a.title || String(a.content ?? '').slice(0, 80), tipo: a.activity_type, data: brDate(a.activity_date), atrasada: (a.activity_date ?? '') < today, oportunidade_id: a.contract_id, empresa_id: a.company_id })))
    }
    case 'search_contracts': {
      const q = searchTerm(input.query)
      if (!q) return 'Informe o termo de busca.'
      const { data } = await db.from('contracts').select('id, client_name, process_number, title').or(`client_name.ilike.%${q}%,process_number.ilike.%${q}%,title.ilike.%${q}%`).limit(10)
      return data?.length ? json(data.map(c => ({ id: c.id, cliente: c.client_name, numero: c.process_number, titulo: c.title }))) : 'Nenhuma oportunidade encontrada.'
    }
    case 'get_contract_details': {
      const id = String(input.contract_id ?? '')
      const { data: c } = await db.from('contracts').select('id, client_name, process_number, valid_from, valid_until, monthly_value, owner_id').eq('id', id).maybeSingle()
      if (!c) return 'Oportunidade não encontrada.'
      const [{ data: run }, { data: owner }] = await Promise.all([
        db.from('pipeline_runs').select('value, stage_id, pipeline_id, stage_entered_at, expected_close_date').eq('contract_id', id).eq('status', 'open').maybeSingle(),
        c.owner_id ? db.from('profiles').select('full_name').eq('id', c.owner_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      let stage: string | null = null, pipeline: string | null = null
      if (run) {
        const [{ data: s }, { data: pl }] = await Promise.all([
          db.from('stages').select('name').eq('id', run.stage_id).maybeSingle(),
          db.from('pipelines').select('name').eq('id', run.pipeline_id).maybeSingle(),
        ])
        stage = s?.name ?? null; pipeline = pl?.name ?? null
      }
      return json({ cliente: c.client_name, numero: c.process_number, funil: pipeline, etapa: stage, valor: run?.value ?? null, previsao_fechamento: brDate(run?.expected_close_date), vigencia_inicio: brDate(c.valid_from), vigencia_fim: brDate(c.valid_until), valor_mensal: c.monthly_value, responsavel: (owner as { full_name?: string } | null)?.full_name ?? null })
    }
    case 'list_stale_contracts': {
      const days = int(input.days, 15, 1, 365)
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
      const { data: runs } = await db.from('pipeline_runs').select('contract_id').eq('status', 'open').limit(2000)
      const ids = [...new Set((runs ?? []).map(r => r.contract_id as string))]
      if (!ids.length) return 'Nenhuma oportunidade em aberto.'
      const active = new Set<string>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from('activities').select('contract_id').in('contract_id', ids.slice(i, i + 200)).gte('created_at', cutoff)
        for (const a of data ?? []) active.add(a.contract_id as string)
      }
      const stale = ids.filter(id => !active.has(id))
      if (!stale.length) return `Nenhuma oportunidade parada há mais de ${days} dias.`
      const { data } = await db.from('contracts').select('id, client_name, process_number').in('id', stale.slice(0, 25))
      return json({ total: stale.length, primeiras: (data ?? []).map(c => ({ id: c.id, cliente: c.client_name, numero: c.process_number })) })
    }
    case 'resumo_funil': {
      const [{ data: runs }, { data: stages }, { data: pipes }] = await Promise.all([
        db.from('pipeline_runs').select('pipeline_id, stage_id, value').eq('status', 'open').limit(5000),
        db.from('stages').select('id, name, order_index, pipeline_id'),
        db.from('pipelines').select('id, name'),
      ])
      const st = new Map((stages ?? []).map(s => [s.id as string, s]))
      const pl = new Map((pipes ?? []).map(x => [x.id as string, x.name as string]))
      const agg = new Map<string, { funil: string; etapa: string; ordem: number; quantidade: number; valor: number }>()
      for (const r of runs ?? []) {
        const s = st.get(r.stage_id as string)
        const k = `${r.pipeline_id}|${r.stage_id}`
        const cur = agg.get(k) ?? { funil: pl.get(r.pipeline_id as string) ?? '—', etapa: s?.name ?? '—', ordem: Number(s?.order_index ?? 0), quantidade: 0, valor: 0 }
        cur.quantidade++; cur.valor += Number(r.value ?? 0)
        agg.set(k, cur)
      }
      const rows = [...agg.values()].sort((a, b) => a.funil.localeCompare(b.funil) || a.ordem - b.ordem).map(r => ({ funil: r.funil, etapa: r.etapa, quantidade: r.quantidade, valor: Math.round(r.valor * 100) / 100 }))
      return rows.length ? json(rows) : 'Nenhuma oportunidade em aberto.'
    }
    case 'fechamentos_mes': {
      const m = monthRange(input.mes)
      const { data } = await db.from('pipeline_runs').select('contract_id, status, value, lost_reason, ended_at').in('status', ['won', 'lost']).gte('ended_at', m.from).lt('ended_at', m.to).limit(500)
      const list = data ?? []
      const ids = [...new Set(list.map(r => r.contract_id as string))]
      const { data: cs } = ids.length ? await db.from('contracts').select('id, client_name').in('id', ids.slice(0, 200)) : { data: [] }
      const nm = new Map((cs ?? []).map(c => [c.id as string, c.client_name as string]))
      const won = list.filter(r => r.status === 'won'), lost = list.filter(r => r.status === 'lost')
      const sum = (l: typeof list) => Math.round(l.reduce((t, r) => t + Number(r.value ?? 0), 0) * 100) / 100
      return json({ mes: m.label, ganhas: { quantidade: won.length, valor: sum(won), itens: won.slice(0, 20).map(r => ({ cliente: nm.get(r.contract_id as string), valor: r.value })) }, perdidas: { quantidade: lost.length, valor: sum(lost), itens: lost.slice(0, 20).map(r => ({ cliente: nm.get(r.contract_id as string), valor: r.value, motivo: r.lost_reason })) } })
    }
    case 'buscar_leads': {
      const q = searchTerm(input.query)
      if (!q) return 'Informe o termo de busca.'
      const { data } = await db.from('leads').select('id, name, company_name, email, phone, status, created_at').or(`name.ilike.%${q}%,company_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`).order('created_at', { ascending: false }).limit(10)
      return data?.length ? json(data.map(l => ({ id: l.id, nome: l.name, empresa: l.company_name, email: l.email, telefone: l.phone, situacao: l.status, criado_em: brDate(l.created_at) }))) : 'Nenhum lead encontrado.'
    }
    case 'leads_sem_andamento': {
      const days = int(input.days, 3, 1, 365)
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
      const { data } = await db.from('leads').select('id, name, company_name, status, updated_at, assigned_to').in('status', ['novo', 'em_qualificacao']).lt('updated_at', cutoff).order('updated_at').limit(30)
      return data?.length ? json(data.map(l => ({ id: l.id, nome: l.name, empresa: l.company_name, situacao: l.status, parado_desde: brDate(l.updated_at) }))) : `Nenhum lead parado há mais de ${days} dias.`
    }
    case 'origem_leads': {
      const m = monthRange(input.mes)
      const { data } = await db.from('leads').select('source, utm_source, utm_campaign').gte('created_at', m.from).lt('created_at', m.to).limit(5000)
      const agg = new Map<string, number>()
      for (const l of data ?? []) { const k = [l.utm_source || l.source || 'sem origem', l.utm_campaign].filter(Boolean).join(' / '); agg.set(k, (agg.get(k) ?? 0) + 1) }
      return json({ mes: m.label, total: data?.length ?? 0, por_origem: [...agg.entries()].sort((a, b) => b[1] - a[1]).map(([origem, leads]) => ({ origem, leads })) })
    }
    case 'search_companies': {
      const q = searchTerm(input.query)
      if (!q) return 'Informe o termo de busca.'
      const { data } = await db.from('companies').select('id, name, trade_name, cnpj, city, state').or(`name.ilike.%${q}%,trade_name.ilike.%${q}%,cnpj.ilike.%${q.replace(/\D/g, '') || q}%`).limit(10)
      return data?.length ? json(data) : 'Nenhuma empresa encontrada.'
    }
    case 'propostas_abertas': {
      const { data } = await db.from('proposal_status').select('contract_id, status, client_status, proposal_value, updated_at').not('status', 'in', '(aprovado_cliente,recusado,cancelado)').order('updated_at').limit(40)
      const list = (data ?? []).filter(x => x.client_status !== 'aprovado')
      if (!list.length) return 'Nenhuma proposta em aberto.'
      const { data: cs } = await db.from('contracts').select('id, client_name').in('id', list.map(x => x.contract_id as string))
      const nm = new Map((cs ?? []).map(c => [c.id as string, c.client_name as string]))
      return json(list.map(x => ({ oportunidade_id: x.contract_id, cliente: nm.get(x.contract_id as string), situacao: x.status, cliente_respondeu: x.client_status, valor: x.proposal_value, dias_parada: Math.floor((Date.now() - Date.parse(x.updated_at as string)) / 86_400_000) })))
    }
    case 'contratos_vencendo': {
      const days = int(input.days, 90, 1, 730)
      const today = todaySP()
      const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
      const { data } = await db.from('contracts').select('id, client_name, process_number, valid_until, monthly_value').gte('valid_until', today).lte('valid_until', until).order('valid_until').limit(50)
      return data?.length ? json(data.map(c => ({ id: c.id, cliente: c.client_name, numero: c.process_number, fim: brDate(c.valid_until), valor_mensal: c.monthly_value }))) : `Nenhum contrato vence nos próximos ${days} dias.`
    }
    case 'chamados_abertos': {
      const { data } = await db.from('tickets').select('ticket_number, subject, status, priority, sla_due_at, requester_name, created_at').neq('status', 'fechado').order('sla_due_at', { ascending: true, nullsFirst: false }).limit(40)
      const now = Date.now()
      return data?.length ? json(data.map(t => ({ numero: t.ticket_number, assunto: t.subject, situacao: t.status, prioridade: t.priority, solicitante: t.requester_name, prazo: brDate(t.sla_due_at), atrasado: !!t.sla_due_at && Date.parse(t.sla_due_at as string) < now }))) : 'Nenhum chamado aberto.'
    }
    case 'resumo_conversa_whatsapp': {
      const digits = String(input.telefone ?? '').replace(/\D/g, '')
      if (digits.length < 8) return 'Informe o telefone com DDD.'
      const { data: rawConv } = await db.from('contract_whatsapp_messages').select('direction, message, media_type, created_at, phone, instance_name').ilike('phone', `%${digits.slice(-8)}`).order('created_at', { ascending: false }).limit(40)
      // Central de atendimento: o Théo só lê o que a pessoa que pergunta pode ver
      const data = await (await import('@/lib/whatsapp/central')).filterVisibleForMe(rawConv ?? [])
      if (!data?.length) return 'Nenhuma conversa com esse telefone.'
      return json([...data].reverse().map(m => ({ quem: m.direction === 'enviado' ? 'empresa' : 'contato', quando: new Date(m.created_at as string).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), texto: m.media_type && m.media_type !== 'revoked' ? `[${m.media_type}] ${String(m.message ?? '').slice(0, 200)}` : String(m.message ?? '').slice(0, 400) })))
    }
    case 'conversas_sem_resposta': {
      const hours = int(input.horas, 2, 1, 720)
      const { data: rawList } = await db.from('contract_whatsapp_messages').select('phone, direction, created_at, unlinked_sender_name, instance_name').order('created_at', { ascending: false }).limit(1500)
      const data = await (await import('@/lib/whatsapp/central')).filterVisibleForMe(rawList ?? [])
      const latest = new Map<string, { phone: string; direction: string; created_at: string; name: string | null }>()
      for (const m of data ?? []) { const k = String(m.phone ?? '').replace(/\D/g, '').slice(-8); if (k && !latest.has(k)) latest.set(k, { phone: m.phone as string, direction: m.direction as string, created_at: m.created_at as string, name: (m.unlinked_sender_name as string) ?? null }) }
      const cut = Date.now() - hours * 3_600_000
      const list = [...latest.values()].filter(x => x.direction === 'recebido' && Date.parse(x.created_at) < cut).slice(0, 30)
      return list.length ? json(list.map(x => ({ telefone: x.phone, contato: x.name, ultima_mensagem: new Date(x.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }))) : `Nenhuma conversa sem resposta há mais de ${hours} horas.`
    }
    case 'nps_baixo': {
      const days = int(input.days, 90, 1, 730)
      const { data } = await db.from('nps_surveys').select('contract_id, score, comment, answered_at, respondent_name').lte('score', 6).gte('answered_at', new Date(Date.now() - days * 86_400_000).toISOString()).order('answered_at', { ascending: false }).limit(30)
      if (!data?.length) return `Nenhuma nota até 6 nos últimos ${days} dias.`
      const { data: cs } = await db.from('contracts').select('id, client_name').in('id', data.map(x => x.contract_id as string).filter(Boolean))
      const nm = new Map((cs ?? []).map(c => [c.id as string, c.client_name as string]))
      return json(data.map(x => ({ cliente: nm.get(x.contract_id as string), nota: x.score, comentario: x.comment, quem: x.respondent_name, quando: brDate(x.answered_at) })))
    }
    case 'resultado_campanhas': {
      const { data: camps } = await db.from('marketing_campaigns').select('id, name, status, channel, budget, start_date, end_date').order('start_date', { ascending: false }).limit(20)
      if (!camps?.length) return 'Nenhuma campanha cadastrada.'
      const ids = camps.map(c => c.id as string)
      const [{ data: leads }, { data: contracts }] = await Promise.all([
        db.from('leads').select('campaign_id').in('campaign_id', ids).limit(10000),
        db.from('contracts').select('id, campaign_id').in('campaign_id', ids).limit(5000),
      ])
      const won = new Set<string>()
      const cids = (contracts ?? []).map(c => c.id as string)
      for (let i = 0; i < cids.length; i += 200) {
        const { data } = await db.from('pipeline_runs').select('contract_id').eq('status', 'won').in('contract_id', cids.slice(i, i + 200))
        for (const r of data ?? []) won.add(r.contract_id as string)
      }
      return json(camps.map(c => ({ campanha: c.name, situacao: c.status, canal: c.channel, orcamento: c.budget, inicio: brDate(c.start_date), fim: brDate(c.end_date),
        leads: (leads ?? []).filter(l => l.campaign_id === c.id).length,
        ganhas: (contracts ?? []).filter(x => x.campaign_id === c.id && won.has(x.id as string)).length })))
    }
    case 'buscar_pecas': {
      const q = searchTerm(input.query)
      if (!q) return 'Informe o nome ou código.'
      const { data } = await db.from('retail_products').select('id, code, name, price, promo_price, status').or(`name.ilike.%${q}%,code.ilike.%${q}%`).limit(10)
      if (!data?.length) return 'Nenhuma peça encontrada.'
      const { data: vars } = await db.from('retail_product_variants').select('product_id, color, size, stock, active').in('product_id', data.map(x => x.id as string))
      return json(data.map(x => ({ codigo: x.code, nome: x.name, preco: x.promo_price ?? x.price, situacao: x.status, estoque: (vars ?? []).filter(v => v.product_id === x.id && v.active).map(v => ({ cor: v.color, tamanho: v.size, qtd: v.stock })) })))
    }
    case 'estoque_baixo': {
      const lim = int(input.limite, 1, 0, 1000)
      const { data } = await db.from('retail_product_variants').select('product_id, color, size, stock').eq('active', true).lte('stock', lim).order('stock').limit(60)
      if (!data?.length) return `Nenhuma variação com estoque até ${lim}.`
      const { data: ps } = await db.from('retail_products').select('id, code, name').in('id', [...new Set(data.map(v => v.product_id as string))])
      const nm = new Map((ps ?? []).map(x => [x.id as string, `${x.code ?? ''} ${x.name ?? ''}`.trim()]))
      return json(data.map(v => ({ peca: nm.get(v.product_id as string), cor: v.color, tamanho: v.size, estoque: v.stock })))
    }
    case 'pedidos_pendentes': {
      const { data } = await db.from('retail_orders').select('number, status, total, created_at, customer_id').not('status', 'in', '(entregue,cancelado)').order('created_at').limit(40)
      if (!data?.length) return 'Nenhum pedido pendente.'
      const { data: cs } = await db.from('retail_customers').select('id, name').in('id', data.map(o => o.customer_id as string).filter(Boolean))
      const nm = new Map((cs ?? []).map(c => [c.id as string, c.name as string]))
      return json(data.map(o => ({ pedido: o.number, situacao: o.status, total: o.total, cliente: nm.get(o.customer_id as string), criado_em: brDate(o.created_at) })))
    }
    case 'melhores_clientes': {
      const days = int(input.days, 365, 1, 3650)
      const { data } = await db.from('retail_orders').select('customer_id, total').in('status', PAID_STATUSES as unknown as string[]).gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString()).limit(10000)
      const agg = new Map<string, { total: number; pedidos: number }>()
      for (const o of data ?? []) { if (!o.customer_id) continue; const c = agg.get(o.customer_id as string) ?? { total: 0, pedidos: 0 }; c.total += Number(o.total ?? 0); c.pedidos++; agg.set(o.customer_id as string, c) }
      const top = [...agg.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15)
      if (!top.length) return 'Nenhuma compra paga no período.'
      const { data: cs } = await db.from('retail_customers').select('id, name').in('id', top.map(t => t[0]))
      const nm = new Map((cs ?? []).map(c => [c.id as string, c.name as string]))
      return json(top.map(([id, v]) => ({ cliente: nm.get(id), pedidos: v.pedidos, total: Math.round(v.total * 100) / 100 })))
    }
  }
  return 'Ferramenta desconhecida.'
}

// ─── Ações (só depois da confirmação na tela) ────────────────────────────────
export type ActionResult = { summary: string; error?: string; contractId?: string }

export async function runTheoAction(name: string, input: In): Promise<ActionResult> {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return { summary: '', error: 'Usuário não autenticado.' }
  const fail = (error: string): ActionResult => ({ summary: '', error })

  switch (name) {
    case 'criar_atividade':
    case 'rascunho_mensagem': {
      const contractId = String(input.oportunidade_id ?? '').trim() || null
      const companyId = String(input.empresa_id ?? '').trim() || null
      if (!contractId && !companyId) return fail('Diga em qual oportunidade ou empresa.')
      let assignedTo: string = user.id
      if (name === 'criar_atividade' && input.responsavel) {
        const who = await userIdByName(db, input.responsavel)
        if ('error' in who) return fail(who.error)
        assignedTo = who.id
      }
      const isDraft = name === 'rascunho_mensagem'
      const canal = String(input.canal ?? 'whatsapp') === 'email' ? 'email' : 'whatsapp'
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.data ?? '')) ? String(input.data) : todaySP()
      const types = ['task', 'call', 'meeting', 'email', 'whatsapp', 'reminder'] as const
      const type = isDraft ? canal : (types as readonly string[]).includes(String(input.tipo)) ? String(input.tipo) as typeof types[number] : 'task'
      const r = await createActivity({
        contractId, companyId,
        title: isDraft ? `Revisar e enviar ${canal === 'email' ? 'e-mail' : 'WhatsApp'} (Théo)` : String(input.titulo ?? '').slice(0, 200),
        content: String(isDraft ? input.texto : (input.descricao ?? input.titulo) ?? '').slice(0, 4000),
        activityType: type, status: 'planned', activityDate: date, assignedTo,
      })
      if (r.error) return fail(r.error)
      return { summary: isDraft ? 'Mensagem pronta numa atividade planejada para revisar e enviar.' : `Atividade criada para ${brDate(date)}.`, contractId: contractId ?? undefined }
    }
    case 'add_note': {
      const contractId = String(input.contract_id ?? '')
      const { error } = await db.from('activities').insert({ contract_id: contractId, user_id: user.id, type: 'note', content: String(input.content ?? '').slice(0, 4000) })
      return error ? fail(error.message) : { summary: 'Nota adicionada ao histórico.', contractId }
    }
    case 'move_contract_stage': {
      const contractId = String(input.contract_id ?? '')
      const stageName = searchTerm(input.stage_name)
      const { data: run } = await db.from('pipeline_runs').select('pipeline_id').eq('contract_id', contractId).eq('status', 'open').maybeSingle()
      if (!run) return fail('Esta oportunidade não está em aberto num funil.')
      const { data: stage } = await db.from('stages').select('id, name').eq('pipeline_id', run.pipeline_id).ilike('name', stageName).maybeSingle()
      if (!stage) return fail(`Não há etapa "${stageName}" nesse funil.`)
      const r = await moveContractStage(contractId, stage.id)
      return r.error ? fail(r.error) : { summary: `Movida para "${stage.name}".`, contractId }
    }
    case 'marcar_resultado': {
      const contractId = String(input.contract_id ?? '')
      const won = input.resultado === 'ganha'
      const reason = String(input.motivo ?? '').trim()
      if (!won && !reason) return fail('Informe o motivo da perda.')
      const r = await closeRun(contractId, won ? 'won' : 'lost', won ? undefined : reason)
      return r.error ? fail(r.error) : { summary: won ? 'Oportunidade marcada como ganha.' : 'Oportunidade marcada como perdida.', contractId }
    }
    case 'create_company': {
      const fd = new FormData()
      fd.set('name', String(input.name ?? ''))
      if (input.trade_name) fd.set('trade_name', String(input.trade_name))
      if (input.cnpj) fd.set('cnpj', String(input.cnpj))
      const r = await createCompany({}, fd)
      return r.error ? fail(r.error) : { summary: `Empresa "${input.name}" criada.` }
    }
    case 'cadastrar_contato': {
      const fd = new FormData()
      fd.set('name', String(input.nome ?? ''))
      if (input.cargo) fd.set('role', String(input.cargo))
      if (input.email) fd.set('email', String(input.email))
      if (input.telefone) fd.set('phone', String(input.telefone))
      const r = await createContact(String(input.empresa_id ?? ''), {}, fd)
      return r.error || r.fieldErrors ? fail(r.error ?? 'Informe o nome do contato.') : { summary: `Contato "${input.nome}" cadastrado.` }
    }
    case 'criar_lead': {
      const fd = new FormData()
      fd.set('interno', '1')
      fd.set('name', String(input.nome ?? ''))
      fd.set('company_name', String(input.empresa ?? ''))
      fd.set('cnpj', String(input.cnpj ?? ''))
      if (input.telefone) fd.set('phone', String(input.telefone))
      if (input.email) fd.set('email', String(input.email))
      if (input.mensagem) fd.set('message', String(input.mensagem))
      fd.set('source', 'theo')
      const r = await createLead(fd)
      return r.error ? fail(r.error) : { summary: `Lead "${input.nome}" criado.` }
    }
    case 'situacao_lead': {
      const allowed = ['novo', 'em_qualificacao', 'qualificado', 'descartado']
      const st = String(input.situacao ?? '')
      if (!allowed.includes(st)) return fail('Situação inválida.')
      const r = await updateLeadStatus(String(input.lead_id ?? ''), st)
      return r.error ? fail(r.error) : { summary: 'Situação do lead atualizada.' }
    }
    case 'passar_lead': {
      const who = await userIdByName(db, input.responsavel)
      if ('error' in who) return fail(who.error)
      const r = await assignLead(String(input.lead_id ?? ''), who.id)
      return r.error ? fail(r.error) : { summary: `Lead passado para ${who.name}.` }
    }
  }
  return fail('Ferramenta desconhecida.')
}

// Resumo legível do que a ação vai fazer (cartão de confirmação na tela)
export function describeAction(name: string, input: In): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === null || v === undefined || v === '') continue
    if (/(_id|^id)$/.test(k)) continue
    out.push(`${k.replace(/_/g, ' ')}: ${String(v).slice(0, 300)}`)
  }
  return out
}
