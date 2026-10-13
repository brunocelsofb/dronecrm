import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizePhoneForEvo } from '@/lib/whatsapp/evolution'
import { isPrivateInstance, PRIVATE_INSTANCE_ERROR } from '@/lib/whatsapp/private-instances'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { phone, message, instance } = await req.json()
    if (isPrivateInstance(instance)) return NextResponse.json({ error: PRIVATE_INSTANCE_ERROR }, { status: 403 })
    const cleanPhone = sanitizePhoneForEvo(phone)
    const admin = createAdminClient()

    // Busca credenciais da Evolution
    const { data: org } = await admin
      .from('organization_settings')
      .select('evo_server_url, evo_api_key')
      .eq('id', 'default').maybeSingle()
    if (!org?.evo_server_url) return NextResponse.json({ error: 'Evolution API não configurada' }, { status: 400 })

    // Envia mensagem via Evolution
    const res = await fetch(`${org.evo_server_url}/message/sendText/${instance}`, {
      method: 'POST',
      headers: { apikey: org.evo_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: cleanPhone, text: message }),
    })
    const evoData = await res.json()
    if (!res.ok) return NextResponse.json({ error: `Evolution API: ${JSON.stringify(evoData)}` }, { status: 500 })

    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    const msgId = evoData?.key?.id ?? null

    // Salva na tabela de histórico unificado
    await admin.from('contract_whatsapp_messages').insert({
      phone: cleanPhone,
      message,
      direction: 'enviado',
      status: 'sent',
      instance_name: instance,
      sent_by: user.id,
      sent_by_name: profile?.full_name ?? null,
      evo_message_id: msgId,
    })

    return NextResponse.json({ ok: true, phone: cleanPhone })
  } catch (e: any) {
    console.error('[new-conversation]', e?.message)
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}
