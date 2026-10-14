import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { order, miolo_after_id, service_type } = await req.json()
  if (!order || !Array.isArray(order)) return NextResponse.json({ error: 'order obrigatório' }, { status: 400 })

  const admin = createAdminClient()

  // Reseta is_miolo_after APENAS para o service_type ativo
  if (service_type) {
    const { error: resetErr } = await admin.from('proposal_templates')
      .update({ is_miolo_after: false })
      .eq('service_type', service_type)
    if (resetErr) console.error('[template-order] reset error:', resetErr)
  }

  // Atualiza sort_order e is_miolo_after de cada template individualmente
  const errors: string[] = []
  for (const { id, sort_order } of order) {
    const patch: Record<string, unknown> = { sort_order }
    if (miolo_after_id && id === miolo_after_id) patch.is_miolo_after = true
    const { error } = await admin.from('proposal_templates').update(patch).eq('id', id)
    if (error) {
      console.error(`[template-order] update ${id} error:`, error)
      errors.push(error.message)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 500 })
  }

  // Posição especial: miolo no início (start) ou fim (end)
  // Salva em organization_settings como JSON por service_type
  if (miolo_after_id === 'start' || miolo_after_id === 'end') {
    const { data: org } = await admin.from('organization_settings').select('miolo_positions').eq('tenant_id', await resolveTenantId()).maybeSingle()
    const positions = (org?.miolo_positions as Record<string, string>) ?? {}
    positions[service_type ?? 'clinica'] = miolo_after_id
    await admin.from('organization_settings').update({ miolo_positions: positions }).eq('tenant_id', await resolveTenantId())
  }

  return NextResponse.json({ ok: true })
}
