export const dynamic = 'force-dynamic'
export const revalidate = 0

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveTenantId } from '@/lib/supabase/server'
import Link from 'next/link'
import { WhatsAppClientShell } from '@/components/whatsapp/whatsapp-client-shell'

export default async function WhatsAppInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ contract?: string; phone?: string; instance?: string }>
}) {
  const { phone: selectedPhone, instance: selectedInstance } = await searchParams
  const supabase = await createClient()
  const admin = createAdminClient()
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
    // Busca status com department, protocol_number e triage_state para merge
    admin.from('whatsapp_conversation_status')
      .select('phone, instance_name, department, protocol_number, triage_state'),
  ])

  // Buscar utilizadores da equipa — filtrar pelo tenant ativo se estiver em impersonation
  const teamUsersQuery = admin.from('profiles').select('id, full_name, job_title')
  const { data: teamUsers } = activeTenantId
    ? await (teamUsersQuery as any).eq('tenant_id', activeTenantId)
    : await teamUsersQuery

  // Mapa de status por chave instance-last8 para merge rápido
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

  // Agrupa por instance_name + últimos 8 dígitos (cobre variações de DDI e 9º dígito)
  const latestByKey = new Map<string, any>()
  for (const m of openMessages ?? []) {
    const base8 = (m.phone ?? '').replace(/\D/g, '').slice(-8)
    const key = `${m.instance_name ?? ''}-${base8}`
    if (!latestByKey.has(key)) latestByKey.set(key, m)
  }

  // archivedSet normalizado por instance + últimos 8 (usa '' como default)
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

  const { data: orgData } = await admin
    .from('organization_settings')
    .select('evo_instance_aliases')
    .eq('id', 'default').maybeSingle()

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
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
      <WhatsAppClientShell
        open={openConversations as any}
        archived={archivedList as any}
        initialPhone={selectedPhone ?? null}
        initialInstance={selectedInstance ?? null}
        currentUserId={user?.id ?? ''}
        teamUsers={(teamUsers ?? []) as any}
        instanceAliases={(orgData as any)?.evo_instance_aliases ?? {}}
      />
    </div>
  )
}
