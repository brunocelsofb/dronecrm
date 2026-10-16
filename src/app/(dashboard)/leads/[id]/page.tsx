import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LeadActionsPanel } from '@/components/leads/lead-actions-panel'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { calculateLeadScore } from '@/lib/utils/lead-score'
import { LeadWhatsAppSection } from '@/components/whatsapp/lead-whatsapp-section'
import { getWhatsAppMessagesByLead } from '@/lib/actions/whatsapp'
import { CampaignPicker } from '@/components/marketing/campaign-picker'
import { channelLabel, inferChannel } from '@/lib/marketing/tracking'

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: lead }, { data: activities }, { data: allProfiles }, { data: pipelines }, { data: stages }, isAdmin, whatsappMessages, { data: campaigns }] = await Promise.all([
    supabase.from('leads').select('*').eq('id', id).maybeSingle(),
    supabase.from('lead_activities').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('pipelines').select('id, name').order('name'),
    supabase.from('stages').select('id, name, pipeline_id').order('order_index'),
    isCurrentUserAdmin(),
    getWhatsAppMessagesByLead(id),
    supabase.from('marketing_campaigns').select('id, name, status').order('name'),
  ])

  if (!lead) notFound()

  const { breakdown } = calculateLeadScore({
    email: lead.email,
    phone: lead.phone,
    company_name: lead.company_name,
    message: lead.message,
    source: lead.source,
  })

  const profileById = new Map((allProfiles ?? []).map((p) => [p.id, p.full_name]))

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-700">
        ← Voltar para Leads
      </Link>

      <div>
        <h1 className="text-lg font-semibold text-gray-900">{lead.name}</h1>
        <p className="text-sm text-gray-500">
          {lead.company_name ?? 'Sem empresa informada'}{lead.cnpj ? ` · CNPJ: ${lead.cnpj}` : ''} · Pontuação: <span className="font-semibold">{lead.score}</span>
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-medium text-gray-500">Por que essa pontuação</p>
        <div className="mt-2 space-y-1">
          {breakdown.map((b, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{b.label}</span>
              <span className="font-medium text-gray-900">+{b.points}</span>
            </div>
          ))}
        </div>
      </div>

      {lead.status === 'convertido' && lead.converted_contract_id && (
        <div className="rounded-lg border border-brand-100 bg-brand-100/40 p-3 text-sm">
          Este lead já foi convertido —{' '}
          <Link href={`/contracts/${lead.converted_contract_id}`} className="font-medium text-brand-700 hover:underline">
            ver a oportunidade
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div>
          <p className="text-xs text-gray-500">E-mail</p>
          <p className="text-gray-900">{lead.email ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Telefone</p>
          <p className="text-gray-900">{lead.phone ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Origem</p>
          <p className="text-gray-900">{lead.source ?? 'manual'}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Campanha</p>
          <CampaignPicker kind="lead" id={lead.id} value={lead.campaign_id ?? null} campaigns={campaigns ?? []} />
        </div>
        <div>
          <p className="text-xs text-gray-500">Canal</p>
          <p className="text-gray-900">{channelLabel(inferChannel(lead))}</p>
        </div>
        {(lead.utm_source || lead.utm_campaign || lead.gclid || lead.fbclid || lead.landing_page) && (
          <div className="col-span-2 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
            <p className="font-medium text-gray-700">Veio de</p>
            {[['utm_source', 'Fonte'], ['utm_medium', 'Meio'], ['utm_campaign', 'Campanha (link)'], ['utm_content', 'Variação'], ['utm_term', 'Palavra-chave']]
              .filter(([k]) => lead[k]).map(([k, l]) => <p key={k}>{l}: <code>{String(lead[k])}</code></p>)}
            {lead.gclid && <p>Clique de anúncio Google (gclid)</p>}
            {lead.fbclid && <p>Clique de anúncio Meta (fbclid)</p>}
            {lead.landing_page && <p className="break-all">Página: {lead.landing_page}</p>}
            {lead.referrer && <p className="break-all">Antes estava em: {lead.referrer}</p>}
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500">Recebido em</p>
          <p className="text-gray-900">{new Date(lead.created_at).toLocaleString('pt-BR')}</p>
        </div>
        {lead.message && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500">Mensagem</p>
            <p className="text-gray-700">{lead.message}</p>
          </div>
        )}
      </div>

      <LeadWhatsAppSection phone={lead.phone} leadName={lead.name} messages={whatsappMessages} />

      <LeadActionsPanel
        leadId={lead.id}
        leadName={lead.name}
        currentStatus={lead.status}
        currentAssignee={lead.assigned_to}
        users={allProfiles ?? []}
        pipelines={pipelines ?? []}
        stages={stages ?? []}
        isConverted={lead.status === 'convertido'}
        isAdmin={isAdmin}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-gray-900">Histórico</h2>
        <div className="space-y-1.5">
          {activities?.map((a) => (
            <div key={a.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <p className="text-gray-700">{a.content}</p>
              <p className="mt-0.5 text-xs text-gray-400">
                {a.user_id ? profileById.get(a.user_id) ?? 'Alguém' : 'Sistema'} · {new Date(a.created_at).toLocaleString('pt-BR')}
              </p>
            </div>
          ))}
          {(!activities || activities.length === 0) && <p className="text-sm text-gray-400">Nenhuma nota ainda.</p>}
        </div>
      </div>
    </div>
  )
}
