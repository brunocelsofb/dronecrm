// POST /api/whatsapp/restart-instance { instance } — reinicia a sessão na Evolution.
// Usado pelo botão ↻ da lista de instâncias. Só administradores.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ ok: false, error: 'Acesso negado' }, { status: 403 })

  const { instance } = await request.json().catch(() => ({}))
  if (typeof instance !== 'string' || !instance.trim()) {
    return NextResponse.json({ ok: false, error: 'instance obrigatório' }, { status: 400 })
  }

  const { data: org } = await createAdminClient()
    .from('organization_settings')
    .select('evo_server_url, evo_api_key')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()
  if (!org?.evo_server_url || !org?.evo_api_key) {
    return NextResponse.json({ ok: false, error: 'Evolution API não configurada' }, { status: 400 })
  }

  const res = await fetch(
    `${org.evo_server_url.replace(/\/$/, '')}/instance/restart/${encodeURIComponent(instance)}`,
    { method: 'PUT', headers: { apikey: org.evo_api_key } }
  )
  return NextResponse.json({ ok: res.ok }, { status: res.ok ? 200 : 502 })
}
