import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { url } = await req.json()
  const admin = (await createScopedAdmin())
  const { error } = await admin.from('organization_settings').update({ survey_bg_url: url || null }).eq('tenant_id', await resolveTenantId())
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  revalidatePath('/nps', 'layout')
  revalidatePath('/survey', 'layout')
  return NextResponse.json({ ok: true })
}
