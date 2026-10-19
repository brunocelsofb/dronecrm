export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveTenantId } from '@/lib/supabase/server'
import Link from 'next/link'
import { WhatsAppClientShell } from '@/components/whatsapp/whatsapp-client-shell'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { identifyPhones } from '@/lib/whatsapp/contact-identity'
import { classifyPhones, phoneKey } from '@/lib/whatsapp/contact-kind'

export default async function WhatsAppInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ contract?: string; phone?: string; instance?: string }>
}) {
  const { phone: selectedPhone, instance: selectedInstance } = await searchParams
  const supabase = await createClient()
  const admin = (await createScopedAdmin())
  const activeTenantId = await getActiveTenantId()

  const [
    { data: { user } },
    { data: archivedRows },
    { data: openMessages },
    { data: statusRows },
  ] = await Promise.all([
    supabase.auth.getUser(),
    admin.from('whatsapp_conversation_status').select('phone, instance_name').eq('is_archived', true),
    admin.from('contract_whatsapp_messages')
      .select('phone, unlinked_sender_name, message, media_type, direction, created_at, lead_id, instance_name')
      .order('created_at', { ascending: false })
      .limit(500),
    admin.from('whatsapp_conversation_status')
      .select('phone, instance_name, department, protocol_number, triage_state'),
  ])

  const teamUsersQuery = admin.from('profiles').select('id, full_name, job_title')
  const { data: teamUsers } = activeTenantId
    ? await (teamUsersQuery as any).eq('tenant_id', activeTenantId)
    : await teamUsersQuery

  const statusMap = new Map<string, { department: string | null; protocol_number: string | null; triage_state: string | null }>()
  for (const row of statusRows ?? []) {
    const base8 = (row.phone ?? '').replace(/\D/g, '').slice(-8)
    const key = `${row.instance_name ?? ''}-${base8}`
    statusMap.set(key, {
      department: (row as any).department ?? null,
      protocol_number: (row as any).protocol_number ?? null,
      triage_state: (row as any).triage_state ?? null,
    })
  }

  const latestByKey = new Map<string, any>()
  for (const m of openMessages ?? []) {
    const base8 = (m.phone ?? '').replace(/\D/g, '').slice(-8)
    const key = `${m.instance_name ?? ''}-${base8}`
    if (!latestByKey.has(key)) latestByKey.set(key, m)
  }

  const archivedSet = new Set(
    (archivedRows ?? []).map((r: any) => {
      const base8 = (r.phone ?? '').replace(/\D/g, '').slice(-8)
      return `${r.instance_name ?? ''}-${base8}`
    })
  )

  const openConversations = Array.from(latestByKey.entries())
    .filter(([key]) => !archivedSet.has(key))
    .map(([key, m]) => {
      const status = statusMap.get(key)
      return {
        phone: m.phone,
        instance: m.instance_name ?? '',
        latest: m,
        lead: null,
        department: status?.department ?? null,
        protocol_number: status?.protocol_number ?? null,
        triage_state: status?.triage_state ?? null,
      }
    })
    .sort((a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime())

  const archivedList = Array.from(latestByKey.entries())
    .filter(([key]) => archivedSet.has(key))
    .map(([key, m]) => {
      const status = statusMap.get(key)
      return {
        phone: m.phone,
        instance: m.instance_name ?? '',
        latest: m,
        department: status?.department ?? null,
        protocol_number: status?.protocol_number ?? null,
        triage_state: status?.triage_state ?? null,
      }
    })
    .sort((a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime())

  const tenantId = await resolveTenantId()
  const { data: orgData } = await admin
    .from('organization_settings')
    .select('evo_instance_aliases')
    .eq('tenant_id', tenantId).maybeSingle()

  // Selo Cliente / Lead / Visitante (automático + correção manual)
  const kinds = await classifyPhones(tenantId, [...openConversations, ...archivedList].map(c => c.phone))
  // Nome (Central ou cadastro de contatos) e conta vinculada
  const ids = await identifyPhones(tenantId, [...openConversations, ...archivedList].map(c => c.phone))
  const withKind = <T extends { phone: string }>(c: T) => {
    const k = phoneKey(c.phone)
    const who = ids[k]
    const link = who?.links[0]
    return {
      ...c, kind: kinds[k]?.kind ?? 'visitante', kind_manual: kinds[k]?.manual ?? false,
      contact_name: who?.name ?? null,
      linked_label: link ? `${link.label}${who.links.length > 1 ? ` +${who.links.length - 1}` : ''}` : who?.companyName ?? null,
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <div className="flex items-center justify-between px-1 py-2 flex-shrink-0">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Central de Atendimento</h1>
          <p className="text-xs text-gray-400">WhatsApp · {openConversations.length} conversa(s) ativa(s)</p>
        </div>
        <Link href="/whatsapp/relatorios"
          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
          📊 Relatórios
        </Link>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <WhatsAppClientShell
          open={openConversations.map(withKind) as any}
          archived={archivedList.map(withKind) as any}
          initialPhone={selectedPhone ?? null}
          initialInstance={selectedInstance ?? null}
          currentUserId={user?.id ?? ''}
          teamUsers={(teamUsers ?? []) as any}
          instanceAliases={(orgData as any)?.evo_instance_aliases ?? {}}
        />
      </div>
    </div>
  )
}
