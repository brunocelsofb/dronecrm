import { NextResponse } from 'next/server'
import { resolveTenantId } from '@/lib/tenant/context'
import { withPlatformEvo, canTenantUseInstance } from '@/lib/whatsapp/tenant-evo'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createClient } from '@/lib/supabase/server'
import { sanitizePhoneForEvo } from '@/lib/whatsapp/evolution'

// Foto muda pouco: o navegador guarda por 1 hora (a lista de conversas pede várias)
const reply = (url: string | null) => NextResponse.json({ url }, { headers: { 'Cache-Control': url ? 'private, max-age=3600' : 'private, max-age=300' } })

// Foto do contato no WhatsApp. Pergunta pelo número da conversa (instance) e, se não
// vier foto, pelo número principal da empresa. O telefone vai com DDI (55…).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const phone = searchParams.get('phone')
  const instance = searchParams.get('instance')
  if (!phone) return NextResponse.json({ url: null })
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ url: null }, { status: 401 })

  const tenantId = await resolveTenantId()
  const admin = (await createScopedAdmin())
  const { data: org__raw } = await admin
    .from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const org = withPlatformEvo(org__raw)
  if (!org?.evo_server_url || !org?.evo_api_key) return reply(null)

  const instances: string[] = []
  if (instance && tenantId && await canTenantUseInstance(tenantId, instance)) instances.push(instance)
  if (org.evo_instance_name && !instances.includes(org.evo_instance_name)) instances.push(org.evo_instance_name)

  const number = sanitizePhoneForEvo(phone)
  for (const inst of instances) {
    try {
      const res = await fetch(`${org.evo_server_url}/chat/fetchProfilePictureUrl/${encodeURIComponent(inst)}`, {
        method: 'POST',
        headers: { 'apikey': org.evo_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number }),
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => ({}))
      const url = data?.profilePictureUrl ?? data?.picture ?? data?.url ?? null
      if (typeof url === 'string' && /^https:\/\//.test(url)) return reply(url)
    } catch { /* tenta a próxima */ }
  }
  return reply(null)
}
