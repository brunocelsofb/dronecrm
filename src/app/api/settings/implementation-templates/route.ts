import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

async function guardAdmin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  const { data: p } = await s.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return p?.role === 'admin' ? user : null
}

export async function POST(req: Request) {
  const user = await guardAdmin()
  if (!user) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const { id, name, description, trigger_tags, tasks } = await req.json()
  const admin = (await createScopedAdmin())

  let templateId = id
  if (id) {
    await admin.from('implementation_templates').update({ name, description, trigger_tags, updated_at: new Date().toISOString() }).eq('id', id)
    await admin.from('implementation_template_tasks').delete().eq('template_id', id)
  } else {
    const { data } = await admin.from('implementation_templates').insert({ name, description, trigger_tags }).select('id').single()
    templateId = data?.id
  }

  if (tasks?.length) {
    await admin.from('implementation_template_tasks').insert(
      tasks.map((t: any, i: number) => ({
        template_id: templateId, title: t.title, reference_doc: t.reference_doc || null,
        start_week: t.start_week, end_week: t.end_week, sort_order: i + 1,
      }))
    )
  }

  return NextResponse.json({ ok: true, id: templateId })
}

export async function DELETE(req: Request) {
  const user = await guardAdmin()
  if (!user) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  const admin = (await createScopedAdmin())
  await admin.from('implementation_templates').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
