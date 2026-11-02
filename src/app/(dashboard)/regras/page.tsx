import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createClient } from '@/lib/supabase/server'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { loadTheoContext } from '@/lib/ai/theo-server'
import { normDays, todayBrIso } from '@/lib/agent/agent-tasks'
import { loadTasksView } from '@/lib/agent/tasks-view'
import { resolveRulerSettings } from '@/lib/agent/renewal-ruler'
import { resolveRenewalLevels } from '@/lib/agent/renewal-templates'
import { resolveSlaDays } from '@/lib/utils/gut-matrix'
import { THEMES, themesFor, isThemeKey, type Theme } from '@/lib/rules/central'
import { RulesManager, type RuleView } from '@/components/ia/rules-manager'
import { AgentTasksPanel } from '@/components/ia/agent-tasks-panel'
import { AutomationsManager } from '@/components/automations/automations-manager'
import {
  FunnelRenewalEditor, StageSlaEditor, TicketSlaEditor, LinkRule, SimpleBadge, AgentBadge, EventToggles, RenewalTimeline,
  type FunnelRenewalView, type StageSlaView, type EventView, type TimelineItem,
} from '@/components/rules/simple-rules'
import { EVENT_ACTIONS, EVENT_WHEN_LABEL, eventTaskKey } from '@/lib/rules/events'
import { AreasManager, AiSettings, type AreaView, type PersonView } from '@/components/rules/areas-ai'
import { profileProblems } from '@/lib/people/profile-complete'

export const dynamic = 'force-dynamic'

function Block({ title, intro, children }: { title: React.ReactNode; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {intro && <p className="mt-1 text-sm text-gray-600">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Details({ title, children, open }: { title: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-gray-200 bg-white">
      <summary className="cursor-pointer list-none px-5 py-3 text-sm font-semibold text-gray-900 marker:hidden">
        <span className="mr-2 inline-block text-gray-400 transition-transform group-open:rotate-90">▸</span>{title}
      </summary>
      <div className="border-t border-gray-100 px-5 py-3">{children}</div>
    </details>
  )
}

// Central de regras (só admin): tudo o que roda sozinho, por tema. Cada item diz se é
// executado por um agente de IA (Farmer/Hunter) ou se é ação simples do sistema (sem IA).
export default async function RegrasPage({ searchParams }: { searchParams: Promise<{ tema?: string }> }) {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const tenantId = await resolveTenantId()
  const tf = await getTenantFeatures(tenantId)
  const themes = themesFor(tf.features)
  const sp = await searchParams
  const theme: Theme | undefined = (isThemeKey(sp.tema) ? themes.find(t => t.key === sp.tema) : undefined) ?? themes[0]
  if (!theme) return <p className="text-sm text-gray-500">A licença não inclui regras automáticas.</p>

  const db = await createScopedAdmin(tenantId)
  const [tasks, theo, { data: rules }, { data: pipelines }, { data: stages }, { data: org }] = await Promise.all([
    loadTasksView(tenantId, tf.features),
    loadTheoContext(),
    db.from('agent_rules').select('*').order('created_at'),
    db.from('pipelines').select('id, name, type, won_label, lost_label, renewal_trigger_days, renewal_target_stage_id, won_target_pipeline_id').order('name'),
    db.from('stages').select('id, name, pipeline_id, sla_days, order_index').order('order_index'),
    db.from('organization_settings').select('copilot_settings, ticket_sla_days, company_settings').maybeSingle(),
  ])
  const [{ data: expAutos }, { data: evtRows }, { data: areaRows }, { data: peopleRows }, { data: orgAi }, { data: mailAccounts }] = await Promise.all([
    db.from('automation_rules').select('id, name, days_threshold, is_active').eq('trigger_type', 'days_before_expiration').eq('is_active', true),
    db.from('agent_tasks').select('task_key, enabled').like('task_key', 'evt:%'),
    db.from('org_areas').select('id, name, lead_id, member_ids, emails').order('name'),
    db.from('profiles').select('id, full_name, phone, department, email').order('full_name'),
    db.from('organization_settings').select('ai_paused, auto_sender_id').maybeSingle(),
    db.from('email_accounts').select('user_id'),
  ])
  const areas: AreaView[] = ((areaRows ?? []) as { id: string; name: string; lead_id: string | null; member_ids: string[]; emails: string[] }[])
    .map(a => ({ id: a.id, name: a.name, leadId: a.lead_id, memberIds: a.member_ids ?? [], emails: a.emails ?? [] }))
  const withMail = new Set(((mailAccounts ?? []) as { user_id: string }[]).map(m => m.user_id))
  const people: PersonView[] = ((peopleRows ?? []) as { id: string; full_name: string | null; phone: string | null; department: string | null; email: string | null }[])
    .map(p => ({ id: p.id, name: p.full_name || p.email || 'sem nome', missing: profileProblems(p), hasEmail: withMail.has(p.id) }))
  const ai = (orgAi ?? {}) as { ai_paused?: boolean; auto_sender_id?: string | null }
  const pipes = (pipelines ?? []) as { id: string; name: string; type: string | null; renewal_trigger_days: number | null; renewal_target_stage_id: string | null; won_target_pipeline_id: string | null }[]
  const stg = (stages ?? []) as { id: string; name: string; pipeline_id: string; sla_days: number | null }[]
  const cs = (org as { copilot_settings?: unknown } | null)?.copilot_settings ?? {}
  const views: RuleView[] = ((rules ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id), agent: r.agent as RuleView['agent'], name: String(r.name), criterion: String(r.criterion), threshold: Number(r.threshold),
    executor: r.executor === 'agent' ? 'agent' : 'manual',
    conditions: (r.conditions ?? {}) as RuleView['conditions'], actions: (r.actions ?? {}) as RuleView['actions'],
    days: normDays(r.days), enabled: r.enabled !== false, lastRunAt: (r.last_run_at as string | null) ?? null, lastStatus: (r.last_status as string | null) ?? null,
  }))
  const rulesCtx = {
    features: tf.features, team: tasks.team, managerPhone: tasks.managerPhone, aiPaused: !!ai.ai_paused,
    areas: areas.map(a => ({ id: a.id, name: a.name })),
    pipelines: pipes.map(p => ({ id: p.id, name: p.name })),
    stages: stg.map(s => ({ id: s.id, name: s.name, pipeline_id: s.pipeline_id })),
  }
  const today = todayBrIso()
  const taskPanel = (keys: string[], custom: boolean) => {
    const b = tasks.builtins.filter(t => keys.includes(t.key))
    const customAllowed = custom && !!theo?.planTools.some(t => t.kind === 'consulta')
    if (!b.length && !customAllowed) return null
    return <AgentTasksPanel bare builtins={b} customs={custom ? tasks.customs : []} today={today} customAllowed={customAllowed}
      theoOn={!!theo?.provider} team={tasks.team} managerPhone={tasks.managerPhone} managerEmail={tasks.managerEmail} />
  }
  const agentRules = <RulesManager rules={views} ctx={rulesCtx} criteria={theme.criteria} />
  const hasPipe = tf.features.includes('pipeline')

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Central de regras</h1>
        <p className="text-sm text-gray-500">Tudo o que roda sozinho na sua empresa, por assunto: o critério (quando), a ação (o que acontece) e quem faz.
          Itens com 🤖 são executados pelos agentes de IA (Farmer e Hunter); itens com ⚙️ são ações simples do sistema, sem IA. Tudo pode ser ligado, desligado e editado aqui.</p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200" aria-label="Temas">
        {themes.map(t => (
          <Link key={t.key} href={`/regras?tema=${t.key}`} aria-current={t.key === theme.key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${t.key === theme.key ? 'border-brand-700 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-gray-600">{theme.intro}</p>

      {theme.key === 'renovacao' && (() => {
        const L = resolveRenewalLevels((cs as { renewal_levels?: unknown }).renewal_levels)
        const ruler = resolveRulerSettings(cs)
        const funnel: FunnelRenewalView[] = pipes.filter(p => p.type === 'gestao_contratos' || p.renewal_trigger_days != null)
          .map(p => ({ id: p.id, name: p.name, days: p.renewal_trigger_days, stageId: p.renewal_target_stage_id, stages: stg.filter(s => s.pipeline_id === p.id).map(s => ({ id: s.id, name: s.name })) }))
        const alerts = tasks.builtins.find(b => b.key === 'renewal_alerts')
        const off = alerts && !alerts.state.enabled ? ' (desligado)' : ''
        const items: TimelineItem[] = [
          ...funnel.filter(f => f.days != null && f.stageId).map(f => ({ id: `f:${f.id}`, days: f.days!, agent: null,
            label: `volta para a etapa "${f.stages.find(x => x.id === f.stageId)?.name ?? 'Renovação'}" (funil ${f.name})`,
            edit: { type: 'funnel' as const, pipelineId: f.id, stageId: f.stageId! } })),
          ...(alerts ? [
            { id: 'l:prep', days: L.prep, agent: 'Farmer', label: `tarefa "preparar a renovação" para o responsável${off}`, edit: { type: 'level' as const, key: 'prep' as const } },
            { id: 'l:a1', days: L.a1, agent: 'Farmer', label: `1º aviso ao cliente, para revisar e enviar${off}`, edit: { type: 'level' as const, key: 'a1' as const } },
            { id: 'l:a2', days: L.a2, agent: 'Farmer', label: `2º aviso ao cliente${off}`, edit: { type: 'level' as const, key: 'a2' as const } },
            { id: 'l:a3', days: L.a3, agent: 'Farmer', label: `aviso urgente${off}`, edit: { type: 'level' as const, key: 'a3' as const } },
          ] : []),
          ...(ruler.enabled ? ruler.steps.map(st => ({ id: `r:${st.id}`, days: st.days_before, agent: null, label: `régua: ${st.label}`, edit: { type: 'link' as const, href: '/settings/regua-renovacao' } })) : []),
          ...views.filter(r => r.criterion === 'contract_expiring' && r.enabled).map(r => ({ id: `g:${r.id}`, days: r.threshold, agent: r.agent === 'hunter' ? 'Hunter' : 'Farmer',
            label: `regra "${r.name}"`, edit: { type: 'link' as const, href: '#regras-proprias' }, warn: 'parecida com os avisos: revise' })),
          ...((expAutos ?? []) as { id: string; name: string; days_threshold: number | null }[]).filter(a => a.days_threshold).map(a => ({ id: `a:${a.id}`, days: a.days_threshold!, agent: null,
            label: `automação "${a.name}"`, edit: { type: 'link' as const, href: '/regras?tema=funil' }, warn: 'duplicada? revise' })),
        ]
        const counts = new Map<number, number>()
        items.forEach(i => counts.set(i.days, (counts.get(i.days) ?? 0) + 1))
        const withWarn = items.map(i => (!i.warn && (counts.get(i.days) ?? 0) > 1 && i.edit.type !== 'level' ? { ...i, warn: 'mesmo dia de outra regra' } : i))
        return (
          <>
            <Block title="Linha do tempo do contrato" intro="Cada linha é uma regra: quantos dias antes do vencimento e o que acontece. Mude os dias ali mesmo.">
              <RenewalTimeline items={withWarn} levels={{ prep: L.prep, a1: L.a1, a2: L.a2, a3: L.a3 }} />
              <p className="mt-2 text-xs text-gray-500">Ao marcar Renovado: confirmação ao cliente e e-mail interno — veja a aba <Link href="/regras?tema=eventos" className="text-brand-700 hover:underline">Ganho, perda e renovado</Link>.</p>
            </Block>
            {hasPipe && funnel.length > 0 && (
              <Details title={<>Volta para a etapa de renovação, por funil <SimpleBadge /></>}>
                <FunnelRenewalEditor pipelines={funnel} />
              </Details>
            )}
            <Details title={<>Avisos ao cliente e régua <AgentBadge agent="Farmer" /></>}>
              {taskPanel(theme.tasks, false)}
              <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
                <LinkRule title="Régua de renovação (passos internos)" badge={<SimpleBadge />} href="/settings/regua-renovacao"
                  sentence={ruler.enabled ? `Ligada · ${ruler.steps.length} passo(s): ${ruler.steps.map(x => `${x.label} (${x.days_before} dias)`).join(' · ') || '—'}` : 'Desligada'} />
                <LinkRule title="Textos dos avisos ao cliente" badge={<AgentBadge agent="Farmer" />} href="/settings/copiloto"
                  sentence={`Mensagens de ${L.a1}, ${L.a2} e ${L.a3} dias, vencido e renovação concluída; assunto do e-mail e cópias.`} />
              </ul>
            </Details>
            <div id="regras-proprias"><Details title="Regras próprias do agente">{agentRules}</Details></div>
          </>
        )
      })()}

      {theme.key === 'eventos' && (() => {
        const state = new Map(((evtRows ?? []) as { task_key: string; enabled: boolean }[]).map(r => [r.task_key, r.enabled !== false]))
        const events: EventView[] = EVENT_ACTIONS.filter(e => tf.features.includes(e.feature)).map(e => ({
          key: e.key, when: e.when, whenLabel: EVENT_WHEN_LABEL[e.when], agent: e.who === 'hunter' ? 'Hunter' : e.who === 'farmer' ? 'Farmer' : null,
          sentence: e.sentence, detail: e.detail, editHref: e.editHref, enabled: state.get(eventTaskKey(e.key)) ?? true,
        }))
        return (
          <>
            <Block title="Suas regras nesses momentos" intro="Crie o que quiser: ex. ganho de avulso → tarefa para o Time técnico executar; perda no funil de contratos (churn) → e-mail ao Faturamento. Escolha se faz uma pessoa ou o agente de IA.">
              {agentRules}
            </Block>
            <Block title="O que o sistema já faz sozinho" intro="Ações prontas do CRM. Desligou, o sistema deixa de fazer nos próximos fechamentos (o que já foi criado continua).">
              <EventToggles events={events} />
            </Block>
            <Block title="Outras regras nesses momentos">
              <ul className="divide-y divide-gray-100">
                <LinkRule title="Ao ganhar, vai para outro funil" badge={<SimpleBadge />} href="/pipelines"
                  sentence={pipes.filter(p => p.won_target_pipeline_id).map(p => `${p.name} → ${pipes.find(x => x.id === p.won_target_pipeline_id)?.name ?? '—'}`).join(' · ') || 'Nenhum funil configurado.'} />
                <LinkRule title="Automações suas ao ganhar, perder, entrar em etapa ou tag" badge={<SimpleBadge />} href="/regras?tema=funil"
                  sentence="Mensagem por modelo, tarefa, aviso ou mudança de funil na hora do evento." />
                <LinkRule title="E-mail automático ligado à etapa" badge={<SimpleBadge />} href="/email-templates"
                  sentence="Modelos de e-mail marcados para sair quando a oportunidade entra numa etapa." />
              </ul>
            </Block>
          </>
        )
      })()}

      {theme.key === 'funil' && (() => {
        const sla: StageSlaView[] = pipes.map(p => ({ id: p.id, name: p.name, stages: stg.filter(s => s.pipeline_id === p.id).map(s => ({ id: s.id, name: s.name, sla: s.sla_days })) })).filter(p => p.stages.length)
        return (
          <>
            <Block title={<>Prazo de cada etapa <SimpleBadge /></>} intro="Passou do prazo na etapa, o cartão fica marcado como atrasado no funil. Vazio = sem prazo. Salva ao sair do campo.">
              <StageSlaEditor pipelines={sla} />
            </Block>
            <Block title="Regras dos agentes no funil">{agentRules}</Block>
            <Block title={<>Automações por evento <SimpleBadge /></>} intro="Quando algo acontece numa oportunidade (entrou na etapa, X dias sem avançar, ganhou, perdeu, tag, chamado) → ação na hora.">
              <AutomationsList />
            </Block>
            <Block title="Outras regras do funil">
              <ul className="divide-y divide-gray-100">
                <LinkRule title="Ao ganhar, a oportunidade vai para outro funil" badge={<SimpleBadge />} href="/pipelines"
                  sentence={pipes.filter(p => p.won_target_pipeline_id).map(p => `${p.name} → ${pipes.find(x => x.id === p.won_target_pipeline_id)?.name ?? '—'}`).join(' · ') || 'Nenhum funil configurado.'} />
              </ul>
            </Block>
          </>
        )
      })()}

      {theme.key === 'leads' && (
        <>
          <Block title="Pontuação e distribuição">
            <ul className="divide-y divide-gray-100">
              <LinkRule title="Pontuação dos leads" badge={<SimpleBadge />} href="/settings/lead-scoring" sentence="Critérios que somam pontos para priorizar os leads." />
              <LinkRule title="Distribuição dos leads novos" badge={<SimpleBadge />} href="/settings/lead-routing" sentence="Para qual funil e responsável vai cada lead novo." />
            </ul>
          </Block>
          <Block title="Regras dos agentes">{agentRules}</Block>
        </>
      )}

      {theme.key === 'carteira' && (
        <>
          <Block title="Tarefas da carteira">{taskPanel(theme.tasks, false)}</Block>
          <Block title="Classificação">
            <ul className="divide-y divide-gray-100">
              <LinkRule title="Curva ABC" badge={<SimpleBadge />} href="/settings/curva-abc" sentence="Faixas de valor que classificam os clientes em A, B e C." />
              <LinkRule title="Segmentos e clientes inativos" badge={<SimpleBadge />} href="/settings/segmentos" sentence="Segmentos do cadastro e liga/desliga do resumo semanal e das tarefas de reativação." />
            </ul>
          </Block>
          <Block title="Regras dos agentes">{agentRules}</Block>
        </>
      )}

      {theme.key === 'atendimento' && (
        <>
          <Block title={<>Prazo do chamado por prioridade <SimpleBadge /></>} intro="Quantos dias o chamado tem para ser resolvido, conforme a prioridade.">
            <TicketSlaEditor initial={resolveSlaDays((org as { ticket_sla_days?: unknown } | null)?.ticket_sla_days)} />
          </Block>
          <Block title="Regras dos agentes">{agentRules}</Block>
        </>
      )}

      {theme.key === 'envios' && (
        <Block title="Envios da IA" intro="Resumo do dia e tarefas escritas por você. Custo de IA da própria empresa.">
          {taskPanel(theme.tasks, true)}
        </Block>
      )}

      {theme.key === 'areas' && (
        <>
          <Block title="Áreas da empresa" intro="Grupos de pessoas (e e-mails de fora) que recebem tarefas e e-mails das regras: Time técnico, Faturamento, Financeiro, RH…">
            <AreasManager areas={areas} people={people} />
          </Block>
          <Block title="IA e envios automáticos">
            <AiSettings aiPaused={!!ai.ai_paused} senderId={ai.auto_sender_id ?? null} people={people} />
          </Block>
        </>
      )}

      <p className="text-xs text-gray-400">Temas: {THEMES.filter(t => themes.includes(t)).map(t => t.label).join(' · ')}. Nada aqui manda mensagem ao cliente sem revisão de uma pessoa.</p>
    </div>
  )
}

// Automações por evento (as que já existiam): dados próprios
async function AutomationsList() {
  const supabase = await createClient()
  const [{ data: autoRules }, { data: pipelines }, { data: stages }, { data: templates }, { data: users }, { data: tags }] = await Promise.all([
    supabase.from('automation_rules').select('*').order('created_at', { ascending: false }),
    supabase.from('pipelines').select('id, name, type, won_label, lost_label').order('name'),
    supabase.from('stages').select('id, name, pipeline_id').order('order_index'),
    supabase.from('email_templates').select('id, name, context, channel').order('name'),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('tags').select('id, name, color').order('name'),
  ])
  return <AutomationsManager initialRules={autoRules ?? []} pipelines={pipelines ?? []} stages={stages ?? []} templates={templates ?? []} users={users ?? []} tags={tags ?? []} />
}
