import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET() {
  const admin = (await createScopedAdmin())
  const { data } = await admin
    .from('organization_settings')
    .select('carteira_active_fields')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()
  return NextResponse.json({ activeFields: data?.carteira_active_fields ?? null })
}

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { activeFields } = await req.json()
  if (!Array.isArray(activeFields)) return NextResponse.json({ error: 'activeFields deve ser array' }, { status: 400 })

  const admin = (await createScopedAdmin())

  // UPDATE direto (registro 'default' sempre existe)
  const { error } = await admin
    .from('organization_settings')
    .update({ carteira_active_fields: activeFields })
    .eq('tenant_id', await resolveTenantId())

  if (error) {
    console.error('[carteira-fields] save error:', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Invalida cache de todos os contratos para leitura fresca
  revalidatePath('/contracts/[id]', 'page')

  return NextResponse.json({ ok: true, saved: activeFields.length })
}
