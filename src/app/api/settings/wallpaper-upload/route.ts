import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { isPlatformOwner } from '@/lib/auth/platform-owner'

const ALLOWED_COLS = ['login_bg_url','support_bg_url','nps_bg_url','survey_clinica_bg_url','survey_hospitalar_bg_url','lead_bg_url']
const ALLOWED_PATHS = ['login-bg','support-bg','nps-bg','survey-clinica','survey-hospitalar','lead-bg']

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const bucketPath = formData.get('bucketPath') as string
  const column = formData.get('column') as string

  if (!file || !bucketPath || !column) return NextResponse.json({ error: 'Dados insuficientes' }, { status: 400 })
  if (!ALLOWED_COLS.includes(column) || !ALLOWED_PATHS.includes(bucketPath)) return NextResponse.json({ error: 'Campo não permitido' }, { status: 400 })
  // Fundo do login comum é da plataforma: só o Super Admin, na própria conta
  if ((column === 'login_bg_url' || bucketPath === 'login-bg') && !(await isPlatformOwner())) return NextResponse.json({ error: 'A tela de login é definida pela plataforma.' }, { status: 403 })

  const admin = (await createScopedAdmin())
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${bucketPath}/${Date.now()}.${ext}`

  const buffer = await file.arrayBuffer()
  const { error: uploadErr } = await admin.storage.from('public-assets').upload(path, buffer, { contentType: file.type, upsert: true })
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 400 })

  const { data: { publicUrl } } = admin.storage.from('public-assets').getPublicUrl(path)
  const { error: dbErr } = await admin.from('organization_settings').update({ [column]: publicUrl }).eq('tenant_id', await resolveTenantId())
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 })

  revalidatePath('/suporte')
  revalidatePath('/nps', 'layout')
  revalidatePath('/survey', 'layout')
  revalidatePath('/(auth)/login', 'layout')
  revalidatePath('/captura')
  return NextResponse.json({ ok: true, url: publicUrl })
}
