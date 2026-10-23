import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { isPlatformOwner } from '@/lib/auth/platform-owner'

// Só administrador da empresa; fundo do login comum só o Super Admin na própria conta
async function checkAccess(column: string): Promise<NextResponse | null> {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  if (column === 'login_bg_url' && !(await isPlatformOwner())) return NextResponse.json({ error: 'A tela de login é definida pela plataforma.' }, { status: 403 })
  return null
}

const ALLOWED_COLS = ['support_bg_url','nps_bg_url','survey_clinica_bg_url','survey_hospitalar_bg_url','lead_bg_url','public_bg_color','login_bg_url']

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { url, value, column } = await req.json()
  if (!ALLOWED_COLS.includes(column))
    return NextResponse.json({ error: 'Coluna não permitida' }, { status: 400 })
  const denied = await checkAccess(column)
  if (denied) return denied

  const admin = (await createScopedAdmin())
  const { error } = await admin.from('organization_settings').update({ [column]: value ?? url ?? null }).eq('tenant_id', await resolveTenantId())
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  revalidatePath('/nps', 'layout')
  revalidatePath('/survey', 'layout')
  revalidatePath('/suporte')
  revalidatePath('/(auth)/login', 'layout')
  revalidatePath('/captura')
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { column } = await req.json()
  if (!ALLOWED_COLS.includes(column))
    return NextResponse.json({ error: 'Coluna não permitida' }, { status: 400 })
  const denied = await checkAccess(column)
  if (denied) return denied

  const admin = (await createScopedAdmin())

  // Busca a URL atual para apagar do Storage
  const { data: settings } = await admin
    .from('organization_settings')
    .select(column)
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  const currentUrl: string | null = settings?.[column as keyof typeof settings] as string | null

  // Apaga do banco
  const { error } = await admin
    .from('organization_settings')
    .update({ [column]: null })
    .eq('tenant_id', await resolveTenantId())
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Apaga do Storage se for URL do Supabase (extrai o path do bucket public-assets)
  if (currentUrl && currentUrl.includes('/public-assets/')) {
    try {
      const path = currentUrl.split('/public-assets/').pop()
      if (path) await admin.storage.from('public-assets').remove([decodeURIComponent(path)])
    } catch { /* ignora erro de storage */ }
  }

  revalidatePath('/suporte')
  revalidatePath('/nps', 'layout')
  revalidatePath('/survey', 'layout')
  revalidatePath('/(auth)/login', 'layout')
  revalidatePath('/captura')
  return NextResponse.json({ ok: true })
}
