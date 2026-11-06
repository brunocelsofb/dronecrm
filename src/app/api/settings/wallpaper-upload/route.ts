import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { isPlatformOwner } from '@/lib/auth/platform-owner'
import { storeUpload, storePublicUrl } from '@/lib/files/store'

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
  const path = `${await resolveTenantId()}/${bucketPath}/${Date.now()}.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'}`

  const buffer = await file.arrayBuffer()
  if (!/^image\//.test(file.type)) return NextResponse.json({ error: 'Envie uma imagem.' }, { status: 400 })
  const up = await storeUpload('public-assets', path, buffer, { contentType: file.type, upsert: true })
  if (!up.ref) return NextResponse.json({ error: up.error ?? 'Falha no envio' }, { status: 400 })
  const publicUrl = storePublicUrl('public-assets', up.ref)
  const { error: dbErr } = await admin.from('organization_settings').update({ [column]: publicUrl }).eq('tenant_id', await resolveTenantId())
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 })

  revalidatePath('/suporte')
  revalidatePath('/nps', 'layout')
  revalidatePath('/survey', 'layout')
  revalidatePath('/(auth)/login', 'layout')
  revalidatePath('/captura')
  return NextResponse.json({ ok: true, url: publicUrl })
}
