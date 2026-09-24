import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveTenantId } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { sendEvoTextMessage } from '@/lib/whatsapp/evolution'
import { revalidatePath } from 'next/cache'

async function doArchive(
  phone: string,
  userId: string,
  sendClosing: boolean,
  instanceName: string | null,
  tenantId: string | null,
) {
  const admin = createAdminClient()
  const cleanPhone = String(phone).replace(/\D/g, '')
  const last8 = cleanPhone.slice(-8)
  
  const targetInstance = instanceName ?? ''
  
  console.log('[archive] phone:', phone, '→ last8:', last8, '| instance:', targetInstance, '| tenant:', tenantId)

  let dbError: any = null
  let success = false

  let query = admin
    .from('whatsapp_conversation_status')
    .select('phone')
    .ilike('phone', `%${last8}`)
    
  if (targetInstance) {
    query = query.eq('instance_name', targetInstance)
  } else {
    query = query.or('instance_name.is.null,instance_name.eq.""')
  }

  if (tenantId) {
    query = (query as any).eq('tenant_id', tenantId)
  }

  const { data: existing } = await query

  if (existing && existing.length > 0) {
    for (const row of existing) {
      let updateQuery = admin
        .from('whatsapp_conversation_status')
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userId,
          updated_at: new Date().toISOString(),
          tenant_id: tenantId,
        })
        .eq('phone', row.phone)

      if (targetInstance) {
        updateQuery = updateQuery.eq('instance_name', targetInstance)
      } else {
        updateQuery = updateQuery.or('instance_name.is.null,instance_name.eq.""')
      }

      if (tenantId) {
        updateQuery = (updateQuery as any).eq('tenant_id', tenantId)
      }

      const { error } = await updateQuery
      if (error) dbError = error
      else success = true
    }
  } else {
    const { error } = await admin
      .from('whatsapp_conversation_status')
      .insert({
        phone: cleanPhone,
        instance_name: targetInstance === '' ? null : targetInstance,
        is_archived: true,
        archived_at: new Date().toISOString(),
        archived_by: userId,
        updated_at: new Date().toISOString(),
        tenant_id: tenantId,
      })
      
    if (error) dbError = error
    else success = true
  }

  if (!success) {
    console.error('[archive] Erro do Supabase:', dbError)
    return { ok: false, error: `Erro do Banco: ${dbError?.message || dbError?.details || 'Desconhecido'}` }
  }

  revalidatePath('/whatsapp')

  if (sendClosing) {
    const orgQ = admin
      .from('organization_settings')
      .select('evo_server_url, evo_api_key, evo_instance_name, evo_instance_aliases')
      .eq('id', 'default')
    const { data: org } = tenantId
      ? await (orgQ as any).eq('tenant_id', tenantId).maybeSingle()
      : await (orgQ as any).maybeSingle()

    if (org?.evo_server_url && org?.evo_api_key) {
      const aliases = (org as any)?.evo_instance_aliases ?? {}
      const inst = instanceName ? aliases[instanceName] : null
      const msg = (typeof inst === 'object' ? inst?.closingMessage : null)
        ?? '*Atendimento finalizado.* Se precisar de mais alguma coisa, basta enviar uma nova mensagem por aqui! 😊'
      try {
        await sendEvoTextMessage({
          serverUrl: org.evo_server_url,
          apiKey: org.evo_api_key,
          instanceName: instanceName ?? org.evo_instance_name,
          phone: cleanPhone,
          message: msg,
        })
      } catch (e) { console.warn('[archive] falha ao enviar:', e) }
    }
  }

  return { ok: true }
}

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Ler tenant ativo: cookie (Route Handlers) ou header (Server Actions)
  const tenantId = await getActiveTenantId()

  // Fail-fast: se o cookie de impersonation existe mas tenantId não foi resolvido, algo está errado
  const cookieStore = await cookies()
  const impCookie = cookieStore.get('orbis_imp_tid')?.value
  if (impCookie && !tenantId) {
    console.error('[archive] Cookie de impersonation presente mas tenantId não resolvido:', impCookie)
    return NextResponse.json({ error: 'Erro de sessão: tenant de impersonation não pôde ser determinado. Tente sair e entrar novamente.' }, { status: 400 })
  }

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') ?? 'finalize'
  const { phone, instanceName } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone obrigatório' }, { status: 400 })

  const result = await doArchive(phone, user.id, mode === 'finalize', instanceName ?? null, tenantId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
