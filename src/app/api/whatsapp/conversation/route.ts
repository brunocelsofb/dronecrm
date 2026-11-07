import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { identifyPhones } from '@/lib/whatsapp/contact-identity'
import { samePhone } from '@/lib/whatsapp/chat'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const phone = searchParams.get('phone')
    const instance = searchParams.get('instance')
    if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const admin = (await createScopedAdmin())
    const cleanPhone = phone.replace(/\D/g, '')
    const last8 = cleanPhone.slice(-8)

    // Mesmo número em formatos diferentes (recebidas sem 55, enviadas pela Central com 55):
    // busca pelos 8 últimos dígitos e fica só com o que é o mesmo número.
    // Antes pegava só o formato exato e escondia as mensagens do outro formato.
    let q = admin.from('contract_whatsapp_messages')
      .select('id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status, lead_id, unlinked_sender_name, instance_name, zapi_message_id, quoted_id, reactions')
      .ilike('phone', `%${last8}`)
      // As 500 mais recentes (antes pegava as 500 mais antigas e escondia as novas)
      .order('created_at', { ascending: false })
      .limit(500)
    if (instance) q = q.eq('instance_name', instance)
    const { data } = await q
    const seen = new Set<string>()
    // Passado → presente
    let messages: any[] = [...(data ?? [])].reverse().filter((m: any) => {
      if (!samePhone(m.phone, cleanPhone)) return false
      const key = `${m.direction}:${m.message}:${m.created_at?.slice(0, 19)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    // Número sem nenhuma mensagem no formato canônico (caso raro): mostra o que achou pelos 8 dígitos
    if (!messages.length && data?.length) messages = [...data].reverse()

    // Central de atendimento: só o trecho que esta pessoa pode ver (corte no servidor)
    const tenantId = await resolveTenantId()
    const { filterVisible, loadAliases, channelConfig, getViewer, canReply, userInArea } = await import('@/lib/whatsapp/central')
    const aliasMap = await loadAliases(tenantId)
    messages = await filterVisible(tenantId, user.id, aliasMap, messages)

    const leadId = messages.find(m => m.lead_id)?.lead_id ?? null
    // instanceName da mensagem mais recente
    const instanceName = [...messages].reverse().find(m => m.instance_name)?.instance_name ?? null

    const { data: orgData } = await admin
      .from('organization_settings')
      .select('evo_instance_aliases, evo_instance_name, whatsapp_contact_names')
      .eq('tenant_id', await resolveTenantId()).maybeSingle()

    const contactNames = (orgData as any)?.whatsapp_contact_names ?? {}
    const manualName = contactNames[cleanPhone] ?? contactNames[last8] ?? contactNames[`55${cleanPhone}`] ?? null

    const aliases = (orgData as any)?.evo_instance_aliases ?? {}
    const instanceLabels = new Set<string>(
      [orgData?.evo_instance_name, ...Object.values(aliases).map((v: any) => typeof v === 'string' ? v : v?.label)]
        .filter(Boolean).map((s: string) => s.toLowerCase())
    )

    let displayName = manualName
    if (!displayName) {
      displayName = messages
        .filter(m => m.direction === 'recebido' && m.unlinked_sender_name)
        .find(m => !instanceLabels.has((m.unlinked_sender_name ?? '').toLowerCase()))
        ?.unlinked_sender_name ?? null
    }

    const { data: assignment } = await admin
      .from('whatsapp_conversation_assignments')
      .select('assigned_to, profiles!whatsapp_conversation_assignments_assigned_to_fkey(full_name)')
      .eq('phone', phone)
      .maybeSingle()

    const assignmentData = assignment ? {
      assigned_to: assignment.assigned_to,
      assigned_to_name: (assignment as any).profiles?.full_name ?? '',
    } : null

    // Nome do cadastro de contatos e contas às quais a conversa foi vinculada
    const ident = (await identifyPhones(tenantId, [cleanPhone]))[last8]
    if (!displayName && ident?.name) displayName = ident.name

    // Situação na Central (só para números marcados como Central)
    let central: null | {
      purpose: string; area: string | null; status: string | null; canReply: boolean; reason: string | null
      transfers: { from_name: string; to_name: string; note: string | null; share: string; created_at: string }[]
    } = null
    const convInstance = instance ?? instanceName
    const ch = channelConfig(aliasMap, convInstance)
    if (ch.purpose === 'central' || ch.purpose === 'personal') {
      const viewer = await getViewer(tenantId, user.id)
      const reply = await canReply(tenantId, viewer, aliasMap, cleanPhone, convInstance ?? '')
      const [{ data: st }, { data: tr }] = await Promise.all([
        admin.from('whatsapp_conversation_status').select('area, attend_status').eq('instance_name', convInstance ?? '').ilike('phone', `%${last8}`).maybeSingle(),
        admin.from('whatsapp_transfers').select('from_user, from_area, to_user, to_area, note, share, created_at')
          .eq('instance_name', convInstance ?? '').ilike('phone', `%${last8}`).order('created_at', { ascending: true }),
      ])
      // A nota da transferência é vista por quem enviou, por quem recebeu (pessoa ou área) e por quem vê tudo
      const rows = ((tr ?? []) as { from_user: string | null; from_area: string | null; to_user: string | null; to_area: string | null; note: string | null; share: string; created_at: string }[])
        .filter(t => viewer.seesAll || t.from_user === user.id || t.to_user === user.id || (!t.to_user && userInArea(viewer.area, t.to_area)))
      const ids = [...new Set(rows.flatMap(t => [t.from_user, t.to_user]).filter(Boolean))] as string[]
      const { data: people } = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
      const nameOf = new Map(((people ?? []) as { id: string; full_name: string | null }[]).map(p => [p.id, p.full_name ?? 'Alguém']))
      central = {
        purpose: ch.purpose, area: (st as { area?: string | null } | null)?.area ?? ch.area,
        status: (st as { attend_status?: string | null } | null)?.attend_status ?? null,
        canReply: reply.ok, reason: reply.reason ?? null,
        transfers: rows.map(t => ({
          from_name: t.from_user ? nameOf.get(t.from_user) ?? 'Alguém' : (t.from_area ?? 'Fila'),
          to_name: t.to_user ? nameOf.get(t.to_user) ?? 'Alguém' : `área ${t.to_area ?? ''}`,
          note: t.note, share: t.share, created_at: t.created_at,
        })),
      }
    }

    return NextResponse.json({
      messages, leadId, displayName, instanceName, assignment: assignmentData,
      links: ident?.links ?? [], companyName: ident?.companyName ?? null, central,
    })
  } catch (e: any) {
    console.error('[api/whatsapp/conversation]', e?.message)
    return NextResponse.json({ error: e?.message ?? 'Erro interno' }, { status: 500 })
  }
}
