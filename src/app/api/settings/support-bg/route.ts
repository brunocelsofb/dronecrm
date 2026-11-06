import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { assertTenantRef, storePublicUrl } from '@/lib/files/store'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Só o administrador da empresa muda o fundo.' }, { status: 403 })
  const { url: rawUrl, ref } = await req.json()
  const tid = await resolveTenantId()
  // Só imagem enviada pela própria empresa (pasta dela no armazenamento)
  let url: string | null = null
  if (ref) {
    if (!assertTenantRef(String(ref), tid)) return NextResponse.json({ error: 'Imagem inválida para esta empresa.' }, { status: 400 })
    url = storePublicUrl('public-assets', String(ref))
  } else if (rawUrl) {
    if (!(typeof rawUrl === 'string' && rawUrl.includes(`/public-assets/${tid}/`))) return NextResponse.json({ error: 'Imagem inválida para esta empresa.' }, { status: 400 })
    url = rawUrl
  }
  const admin = (await createScopedAdmin())

  const { error } = await admin
    .from('organization_settings')
    .update({ support_bg_url: url || null })
    .eq('tenant_id', await resolveTenantId())

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  revalidatePath('/suporte')
  return NextResponse.json({ ok: true, url })
}
