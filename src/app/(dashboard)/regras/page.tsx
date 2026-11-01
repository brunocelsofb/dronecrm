import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { getManagerChannel } from '@/lib/agent/briefing-core'
import { normDays } from '@/lib/agent/agent-tasks'
import { RulesManager, type RuleView } from '@/components/ia/rules-manager'
import { AutomationsManager } from '@/components/automations/automations-manager'

export const dynamic = 'force-dynamic'

// Regras automáticas (só admin): regras dos agentes (critério → ação, rodam todo dia)
// e automações por evento do funil (já existiam em /automations), numa tela só.
export default async function RegrasPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [tf, manager, { data: rules }, { data: pipelines }, { data: stages }, { data: people }, { data: autoRules }, { data: templates }, { data: tags }] = await Promise.all([
    getTenantFeatures(tenantId),
    getManagerChannel(tenantId).catch(() => ({ number: null })),
    db.from('agent_rules').select('*').order('created_at'),
    db.from('pipelines').select('id, name, type, won_label, lost_label').order('name'),
    db.from('stages').select('id, name, pipeline_id').order('order_index'),
    db.from('profiles').select('id, full_name').order('full_name'),
    db.from('automation_rules').select('*').order('created_at', { ascending: false }),
    db.from('email_templates').select('id, name, context, channel').order('name'),
    db.from('tags').select('id, name, color').order('name'),
  ])
  const team = ((people ?? []) as { id: string; full_name: string | null }[]).filter(p => p.full_name).map(p => ({ id: p.id, name: p.full_name as string }))
  const views: RuleView[] = ((rules ?? []) as Record<string, unknown>[]).map(r => ({
    id: String(r.id), agent: r.agent as RuleView['agent'], name: String(r.name), criterion: String(r.criterion), threshold: Number(r.threshold),
    conditions: (r.conditions ?? {}) as RuleView['conditions'], actions: (r.actions ?? {}) as RuleView['actions'],
    days: normDays(r.days), enabled: r.enabled !== false, lastRunAt: (r.last_run_at as string | null) ?? null, lastStatus: (r.last_status as string | null) ?? null,
  }))
  const hasFunnel = tf.features.includes('pipeline')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Regras automáticas</h1>
        <p className="text-sm text-gray-500">Tudo o que roda sozinho na sua empresa: as regras dos agentes de IA (critério → ação, todo dia) e as automações por evento do funil.
          Envios de rotina (resumo do dia, avisos de vencimento) ficam em <Link href="/ia" className="text-brand-700 hover:underline">IA da empresa → Tarefas agendadas</Link>.</p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Regras dos agentes</h2>
        <p className="mt-1 text-sm text-gray-600">Cada regra é uma frase: <b>quando</b> algo acontece (com o número que você escolhe) → o agente <b>faz</b> a ação, para quem você escolher.
          Só existem critérios e ações do catálogo, para a regra fazer exatamente o que a frase diz. Use <b>Testar</b> para ver o que ela pegaria hoje.</p>
        <div className="mt-4">
          <RulesManager rules={views} ctx={{
            features: tf.features, team, managerPhone: manager.number ?? '',
            pipelines: ((pipelines ?? []) as { id: string; name: string }[]).map(p => ({ id: p.id, name: p.name })),
            stages: ((stages ?? []) as { id: string; name: string; pipeline_id: string }[]),
          }} />
        </div>
      </section>

      {hasFunnel && (
        <section id="funil" className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Automações por evento do funil</h2>
          <p className="mt-1 mb-4 text-sm text-gray-600">Quando algo acontece numa oportunidade (entrou na etapa, ganhou, perdeu, tag, prazo) → faça uma ação na hora. São as automações que já existiam.</p>
          <AutomationsManager initialRules={autoRules ?? []} pipelines={pipelines ?? []} stages={stages ?? []} templates={templates ?? []} users={people ?? []} tags={tags ?? []} />
        </section>
      )}
    </div>
  )
}
