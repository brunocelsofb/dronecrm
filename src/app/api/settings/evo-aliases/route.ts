import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

async function guardAdmin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return false
  const { data: p } = await s.from('profiles').select('role').eq('id', user.id).maybeSingle()
  return p?.role === 'admin'
}

// Normaliza aliases para suportar tanto string (legado) quanto objeto
function normalizeAliases(raw: any): Record<string, { label: string; closingMessage?: string }> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, { label: string; closingMessage?: string }> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'string') result[key] = { label: val }
    else if (val && typeof val === 'object') result[key] = val as any
  }
  return result
}

export async function GET() {
  const admin = (await createScopedAdmin())
  const { data } = await admin.from('organization_settings')
    .select('evo_instance_aliases').eq('tenant_id', await resolveTenantId()).maybeSingle()
  return NextResponse.json({ aliases: normalizeAliases((data as any)?.evo_instance_aliases) })
}

// POST — salva { instanceName, alias, closingMessage? }
export async function POST(req: Request) {
  if (!await guardAdmin()) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })
  const admin = (await createScopedAdmin())
  const { instanceName, alias, closingMessage } = await req.json()
  if (!instanceName) return NextResponse.json({ error: 'instanceName obrigatório' }, { status: 400 })

  const { data: current } = await admin.from('organization_settings')
    .select('evo_instance_aliases').eq('tenant_id', await resolveTenantId()).maybeSingle()
  const existing = normalizeAliases((current as any)?.evo_instance_aliases)
  existing[instanceName] = {
    label: alias || existing[instanceName]?.label || instanceName,
    ...(closingMessage !== undefined ? { closingMessage: closingMessage || undefined } : {}),
  }

  await admin.from('organization_settings').update({ evo_instance_aliases: existing }).eq('tenant_id', await resolveTenantId())
  return NextResponse.json({ ok: true, aliases: existing })
}
