import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function POST(req: Request) {
  try {
    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 400 })

    const admin = (await createScopedAdmin())
    const ext = file.name.split('.').pop() ?? 'png'
    const path = `logo/${Date.now()}-logo.${ext}`

    const arrayBuffer = await file.arrayBuffer()
    const { error: uploadError } = await admin.storage
      .from('public-assets')
      .upload(path, arrayBuffer, { contentType: file.type, upsert: true })

    if (uploadError) {
      console.error('[logo-url] uploadError:', uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data: { publicUrl } } = admin.storage.from('public-assets').getPublicUrl(path)

    const { error: dbError } = await admin
      .from('organization_settings')
      .update({ logo_storage_path: path, updated_at: new Date().toISOString() })
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
