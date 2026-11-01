import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { loadTheoContext, providerLabel } from '@/lib/ai/theo-server'
import { THEO_TOOLS, type TheoTool } from '@/lib/ai/theo-catalog'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { AGENT_TASKS, readOptions, taskState, todayBrIso, type AgentTaskKey, type TaskRow } from '@/lib/agent/agent-tasks'
import { getManagerChannel } from '@/lib/agent/briefing-core'
import { resolveInternalSettings } from '@/lib/agent/internal-settings'
import { toCustomTask, readTaskParams, PARAM_COLUMNS, type ParamSource } from '@/lib/agent/agent-tasks-server'
import { resolveRenewalLevels } from '@/lib/agent/renewal-templates'
import { AgentTasksPanel, type BuiltinView, type CustomView } from '@/components/ia/agent-tasks-panel'

export const dynamic = 'force-dynamic'

// IA da empresa (só admin): o que o assistente e os agentes fazem — apenas o que a licença inclui
type Agent = { feature: string; title: string; who: string; href: string; items: string[] }
const AGENTS: Agent[] = [
  { feature: 'copiloto', title: 'Resumo do dia (briefing)', who: 'Agentes IA', href: '/briefing', items: [
    'De segunda a sexta, a IA escreve um resumo da carteira e dos novos negócios e envia no WhatsApp do gestor.',
    'Os indicadores do resumo vêm direto dos dados do sistema; a IA não recalcula números.',
  ] },
  { feature: 'copiloto', title: 'Farmer — carteira de clientes', who: 'Agentes IA', href: '/briefing', items: [
    'Lê o contrato e os aditivos em PDF e aponta cláusulas, prazos e próximos passos da renovação, citando o trecho (o admin pede; cada leitura tem custo de IA).',
    'Avisos de renovação aos {marcos} dias e depois do vencimento (prazos editáveis em Tarefas agendadas): viram atividade com a mensagem pronta — nada vai ao cliente sem a pessoa revisar e enviar.',
    'Medições pendentes, régua de renovação, confirmação de renovação, e-mails internos de implantação e relatório mensal.',
  ] },
  { feature: 'copiloto', title: 'Hunter — novos negócios', who: 'Agentes IA', href: '/briefing', items: [
    'Oportunidades e propostas paradas, leads sem andamento e fechamentos do mês, na tela Agentes IA.',
    'Toda segunda, resumo dos clientes inativos no WhatsApp do gestor e tarefas para recuperar.',
  ] },
  { feature: 'sdr', title: 'SDR de IA no WhatsApp', who: 'SDR de IA', href: '/sdr', items: [
    'Atende os números ou setores escolhidos, apresenta-se como assistente virtual e faz as perguntas de qualificação.',
    'Passa o lead ao comercial com resumo, encaminha à equipe ou descarta; sai da conversa quando alguém do time escreve.',
    'Não fala com quem já é cliente nem inventa preço ou prazo.',
  ] },
  { feature: 'varejo', title: 'Estúdio e textos da loja', who: 'Varejo', href: '/varejo/estudio', items: [
    'Estúdio: fotos de look com modelos virtuais e cenários; a vitrine marca essas fotos como “criada por IA”.',
    'Texto do produto: descrição da peça a partir da foto.',
    'Usa a conta de IA da responsável pela loja (Gemini ou ChatGPT).',
  ] },
]

export default async function IaPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const [ctx, tf] = await Promise.all([loadTheoContext(), getTenantFeatures(await resolveTenantId())])
  if (!ctx) redirect('/login')

  // Tarefas agendadas: as do sistema que a licença inclui + as escritas pelo admin
  const db = await createScopedAdmin(ctx.tenantId)
  const [{ data: taskRows }, { data: orgParams }, { data: people }, manager] = await Promise.all([
    db.from('agent_tasks').select('*').order('created_at'),
    db.from('organization_settings').select(PARAM_COLUMNS).maybeSingle(),
    db.from('profiles').select('id, full_name').order('full_name'),
    getManagerChannel(ctx.tenantId).catch(() => ({ number: null, email: null })),
  ])
  const team = ((people ?? []) as { id: string; full_name: string | null }[])
    .filter(p => p.full_name).map(p => ({ id: p.id, name: p.full_name as string }))
  const implOwner = resolveInternalSettings((orgParams as ParamSource | null)?.copilot_settings ?? {}).implReportOwnerId ?? ''
  const paramValues = readTaskParams(orgParams as ParamSource | null)
  const L = resolveRenewalLevels(((orgParams as ParamSource | null)?.copilot_settings as { renewal_levels?: unknown } | undefined)?.renewal_levels)
  const marcos = `${L.prep}, ${L.a1}, ${L.a2} e ${L.a3}`
  const agents = AGENTS.filter(a => tf.features.includes(a.feature)).map(a => ({ ...a, items: a.items.map(i => i.replace('{marcos}', marcos)) }))
  const rows = (taskRows ?? []) as Record<string, unknown>[]
  const builtins: BuiltinView[] = AGENT_TASKS.filter(t => tf.features.includes(t.feature)).map(t => ({
    key: t.key, agent: t.agent, title: t.title, description: t.description, sends: t.sends,
    params: t.params ?? [], values: paramValues[t.key] ?? {},
    state: taskState(t.key as AgentTaskKey, (rows.find(r => r.task_key === t.key) ?? null) as TaskRow | null),
    recipients: t.recipients ?? [], assigneeDefault: t.assigneeDefault ?? '', recipientsNote: t.recipientsNote ?? '', monthly: !!t.monthly,
    options: t.key === 'impl_report'
      ? { assignee: implOwner || null }
      : readOptions(rows.find(r => r.task_key === t.key)?.options),
  }))
  const customs: CustomView[] = rows.filter(r => !r.task_key).map(r => {
    const c = toCustomTask(r)
    return { id: c.id, title: c.title, prompt: c.prompt, recipientPhone: c.recipient_phone ?? '', monthDay: c.month_day, enabled: c.enabled, days: c.days, pausedUntil: c.paused_until, lastRunAt: c.last_run_at, lastStatus: c.last_status }
  })
  const customAllowed = ctx.planTools.some(t => t.kind === 'consulta')
  const groups = [...new Set(THEO_TOOLS.map(t => t.group))]
  const byGroup = (list: TheoTool[], g: string) => list.filter(t => t.group === g)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">IA da empresa</h1>
        <p className="text-sm text-gray-500">O que o assistente Théo e os agentes de IA fazem na licença da sua empresa. O uso de IA é pago com a conta de IA da própria empresa.</p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">🤖 Théo — assistente de IA</h2>
            <p className="mt-1 text-sm text-gray-600">Responde perguntas sobre os dados do CRM e faz ações por você. Toda ação só acontece depois de você confirmar na tela.
              Usam o Théo os administradores e as pessoas que você liberar; cada uma só vê e faz o que o perfil dela já permite.</p>
          </div>
          <Link href="/settings/assistente" className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">
            {ctx.provider ? `Em uso: ${providerLabel(ctx.provider)}` : 'Ligar o Théo'}
          </Link>
        </div>
        {ctx.planTools.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Sua licença não inclui ações do Théo.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {groups.filter(g => byGroup(ctx.planTools, g).length).map(g => (
              <div key={g}>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{g}</p>
                <ul className="mt-1 space-y-1">
                  {byGroup(ctx.planTools, g).map(t => (
                    <li key={t.name} className="flex items-start gap-2 text-sm text-gray-800">
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.kind === 'acao' ? 'bg-warn-100 text-warn-700' : 'bg-brand-100 text-brand-700'}`}>{t.kind === 'acao' ? 'AÇÃO' : 'CONSULTA'}</span>
                      {t.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {agents.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Agentes de IA</h2>
          <p className="mt-1 text-sm text-gray-600">Trabalham sozinhos, todos os dias, e deixam tudo pronto para a equipe revisar.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {agents.map(a => (
              <div key={a.title} className="rounded-md border border-gray-100 p-4">
                <p className="text-sm font-semibold text-gray-900">{a.title}</p>
                <Link href={a.href} className="text-[11px] font-medium text-brand-700 hover:underline">Abrir em {a.who} →</Link>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-gray-700">
                  {a.items.map(i => <li key={i}>{i}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {(builtins.length > 0 || customAllowed) && (
        <AgentTasksPanel builtins={builtins} customs={customs} today={todayBrIso()} customAllowed={customAllowed} theoOn={!!ctx.provider}
          team={team} managerPhone={manager.number ?? ''} managerEmail={manager.email ?? ''} />
      )}
    </div>
  )
}
