import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { storeUpload, storePublicUrl } from '@/lib/files/store'

export async function POST(req: Request) {
  try {
    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin') return NextResponse.json({ error: 'Só o administrador da empresa troca o logo.' }, { status: 403 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 400 })

    const admin = (await createScopedAdmin())
    const ext = file.name.split('.').pop() ?? 'png'
    // Pasta da empresa: o logo de uma empresa não pode ser trocado por outra
    const path = `${await resolveTenantId()}/logo/${Date.now()}-logo.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'png'}`

    if (!/^image\//.test(file.type)) return NextResponse.json({ error: 'Envie uma imagem.' }, { status: 400 })
    const arrayBuffer = await file.arrayBuffer()
    const up = await storeUpload('public-assets', path, arrayBuffer, { contentType: file.type, upsert: true })
    if (!up.ref) {
      console.error('[logo-url] upload:', up.error)
      return NextResponse.json({ error: up.error ?? 'Falha no envio' }, { status: 400 })
    }
    const publicUrl = storePublicUrl('public-assets', up.ref)

    const { error: dbError } = await admin
      .from('organization_settings')
      .update({ logo_storage_path: up.ref, updated_at: new Date().toISOString() })
      .eq('tenant_id', await resolveTenantId())

    if (dbError) {
      console.error('[logo-url] dbError:', dbError)
      return NextResponse.json({ error: dbError.message }, { status: 400 })
    }

    revalidatePath('/suporte')
    revalidatePath('/', 'layout')
    return NextResponse.json({ ok: true, url: publicUrl })
  } catch (e: any) {
    console.error('[logo-url] unexpected error:', e)
    return NextResponse.json({ error: e.message ?? 'Erro interno' }, { status: 500 })
  }
}
