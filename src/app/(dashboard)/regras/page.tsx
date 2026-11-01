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
  FunnelRenewalEditor, StageSlaEditor, TicketSlaEditor, LinkRule, SimpleBadge, AgentBadge,
  type FunnelRenewalView, type StageSlaView,
} from '@/components/rules/simple-rules'

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
  const pipes = (pipelines ?? []) as { id: string; name: string; type: string | null; renewal_trigger_days: number | null; renewal_target_stage_id: string | null; won_target_pipeline_id: string | null }[]
  const stg = (stages ?? []) as { id: string; name: string; pipeline_id: string; sla_days: number | null }[]
  const cs = (org as { copilot_settings?: unknown } | null)?.copilot_settings ?? {}
  const views: RuleView[] = ((rules ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id), agent: r.agent as RuleView['agent'], name: String(r.name), criterion: String(r.criterion), threshold: Number(r.threshold),
    conditions: (r.conditions ?? {}) as RuleView['conditions'], actions: (r.actions ?? {}) as RuleView['actions'],
    days: normDays(r.days), enabled: r.enabled !== false, lastRunAt: (r.last_run_at as string | null) ?? null, lastStatus: (r.last_status as string | null) ?? null,
  }))
  const rulesCtx = {
    features: tf.features, team: tasks.team, managerPhone: tasks.managerPhone,
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
        const timeline = [
          ...funnel.filter(f => f.days != null && f.stageId).map(f => ({ d: f.days!, t: `volta para "${f.stages.find(s => s.id === f.stageId)?.name ?? 'etapa'}" (funil ${f.name})`, ia: false })),
          { d: L.prep, t: 'tarefa "preparar a renovação"', ia: true }, { d: L.a1, t: '1º aviso ao cliente (revisar e enviar)', ia: true },
          { d: L.a2, t: '2º aviso ao cliente', ia: true }, { d: L.a3, t: 'aviso urgente', ia: true },
          ...(ruler.enabled ? ruler.steps.map(s => ({ d: s.days_before, t: `régua: ${s.label}`, ia: false })) : []),
          ...views.filter(r => r.criterion === 'contract_expiring' && r.enabled).map(r => ({ d: r.threshold, t: `regra "${r.name}"`, ia: true })),
        ].sort((a, b) => b.d - a.d)
        const clash = [...new Set(timeline.map(x => x.d).filter((d, i, arr) => arr.indexOf(d) !== i))]
        return (
          <>
            <Block title="Linha do tempo do contrato" intro="O que acontece em cada momento antes do vencimento, juntando todas as regras abaixo.">
              <ol className="space-y-1">
                {timeline.map((x, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="w-16 shrink-0 text-right font-semibold text-brand-700">{x.d} dias</span>
                    <span className="text-gray-700">{x.ia ? '🤖' : '⚙️'} {x.t}</span>
                  </li>
                ))}
                <li className="flex items-baseline gap-3 text-sm"><span className="w-16 shrink-0 text-right font-semibold text-negative-600">vencido</span><span className="text-gray-700">🤖 aviso de contrato vencido</span></li>
              </ol>
              {clash.length > 0 && <p className="mt-2 rounded-md bg-warn-100 px-3 py-2 text-xs text-warn-700">Atenção: mais de uma regra cai no mesmo dia ({clash.map(d => `${d} dias`).join(', ')}). Confira se não estão repetindo a mesma coisa.</p>}
            </Block>
            {hasPipe && funnel.length > 0 && (
              <Block title="Volta para a etapa de renovação" intro="Ação simples do funil: o contrato perto do vencimento volta sozinho para a etapa escolhida. Um por funil.">
                <FunnelRenewalEditor pipelines={funnel} />
              </Block>
            )}
            <Block title="Avisos e régua">
              {taskPanel(theme.tasks, false)}
              <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
                <LinkRule title="Régua de renovação (passos internos)" badge={<SimpleBadge />} href="/settings/regua-renovacao"
                  sentence={ruler.enabled ? `Ligada · ${ruler.steps.length} passo(s): ${ruler.steps.map(s => `${s.label} (${s.days_before} dias)`).join(' · ') || '—'}` : 'Desligada'} />
                <LinkRule title="Textos dos avisos ao cliente" badge={<AgentBadge agent="Farmer" />} href="/settings/copiloto"
                  sentence={`Mensagens de ${L.a1}, ${L.a2} e ${L.a3} dias, vencido e renovação concluída; assunto do e-mail e cópias.`} />
              </ul>
            </Block>
            <Block title="Regras próprias do agente">{agentRules}</Block>
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
