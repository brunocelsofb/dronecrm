import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const phone = searchParams.get('phone')
    const instance = searchParams.get('instance')
    if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const cleanPhone = phone.replace(/\D/g, '')
    const last8 = cleanPhone.slice(-8)

    let messages: any[] = []
    for (const phoneFilter of [
      (q: any) => q.eq('phone', cleanPhone),
      (q: any) => q.ilike('phone', `%${last8}`),
    ]) {
      let q = phoneFilter(
        admin.from('contract_whatsapp_messages')
          .select('id, phone, message, direction, status, triggered_automatically, error_message, created_at, media_url, media_type, media_filename, sender_photo_url, delivery_status, lead_id, unlinked_sender_name, instance_name')
          .order('created_at', { ascending: true })
          .limit(500)
      )
      if (instance) q = q.eq('instance_name', instance)

      const { data } = await q
      if (data?.length) {
        const seen = new Set<string>()
        messages = data.filter((m: any) => {
          const key = `${m.direction}:${m.message}:${m.created_at?.slice(0, 19)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        break
      }
    }

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

    return NextResponse.json({
      messages, leadId, displayName, instanceName, assignment: assignmentData,
    })
  } catch (e: any) {
    console.error('[api/whatsapp/conversation]', e?.message)
    return NextResponse.json({ error: e?.message ?? 'Erro interno' }, { status: 500 })
  }
}
