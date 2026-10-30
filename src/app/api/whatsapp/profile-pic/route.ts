import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { withPlatformEvo } from '@/lib/whatsapp/tenant-evo'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createClient } from '@/lib/supabase/server'

// Foto muda pouco: o navegador guarda por 1 hora (a lista de conversas pede várias)
const cached = (url: string | null) => NextResponse.json({ url }, { headers: { 'Cache-Control': url ? 'private, max-age=3600' : 'private, max-age=600' } })

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const phone = searchParams.get('phone')
  if (!phone) return NextResponse.json({ url: null })
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ url: null }, { status: 401 })

  const admin = (await createScopedAdmin())
  const { data: org__raw } = await admin
    .from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()
  const org = withPlatformEvo(org__raw)

  if (!org?.evo_server_url) return NextResponse.json({ url: null })

  try {
    const cleanPhone = phone.replace(/\D/g, '')
    const res = await fetch(
      `${org.evo_server_url}/chat/fetchProfilePictureUrl/${org.evo_instance_name}`,
      {
        method: 'POST',
        headers: { 'apikey': org.evo_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: cleanPhone }),
      }
    )
    const data = await res.json().catch(() => ({}))
    const url = data?.profilePictureUrl ?? data?.picture ?? data?.url ?? null
    return cached(typeof url === 'string' ? url : null)
  } catch {
    return NextResponse.json({ url: null })
  }
}
