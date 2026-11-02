'use server'
// Completa cidade e UF das empresas sem estado, consultando o CNPJ (só campos vazios).
// O contrato sem UF/cidade herda da empresa. Admin da empresa; sempre filtrado pela empresa atual.

import { revalidatePath } from 'next/cache'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { lookupCnpj } from '@/lib/actions/cnpj-lookup'
import { normalizeUf } from '@/lib/geo/uf'

const MAX_PER_RUN = 40

export async function fillCompanyGeoFromCnpj(): Promise<{ ok: true; filled: number; notFound: number; contracts: number; remaining: number } | { ok: false; error: string }> {
  if (!(await isCurrentUserAdmin())) return { ok: false, error: 'Só administradores completam os dados das empresas.' }
  const db = await createScopedAdmin(await resolveTenantId())
  const { data: comps, error } = await db.from('companies').select('id, cnpj, state, city').is('state', null).not('cnpj', 'is', null).limit(500)
  if (error) return { ok: false, error: error.message }
  const todo = ((comps ?? []) as { id: string; cnpj: string | null; state: string | null; city: string | null }[])
    .filter(c => String(c.cnpj ?? '').replace(/\D/g, '').length === 14)
  let filled = 0, notFound = 0
  for (const c of todo.slice(0, MAX_PER_RUN)) {
    const r = await lookupCnpj(String(c.cnpj))
    const uf = r.success ? normalizeUf(r.uf) : null
    if (!r.success || !uf) { notFound++; continue }
    await db.from('companies').update({ state: uf, ...(c.city ? {} : { city: r.municipio }) }).eq('id', c.id).is('state', null)
    filled++
  }
  // Contratos sem UF: herdam da empresa (só os vazios)
  let contracts = 0
  const { data: cs } = await db.from('contracts').select('id, company_id, uf, municipality').is('uf', null).not('company_id', 'is', null).limit(2000)
  const rows = (cs ?? []) as { id: string; company_id: string; uf: string | null; municipality: string | null }[]
  if (rows.length) {
    const ids = [...new Set(rows.map(r => r.company_id))]
    const { data: cc } = await db.from('companies').select('id, state, city').in('id', ids)
    const geo = new Map(((cc ?? []) as { id: string; state: string | null; city: string | null }[]).map(x => [x.id, x]))
    for (const r of rows) {
      const g = geo.get(r.company_id)
      const uf = normalizeUf(g?.state ?? null)
      if (!uf) continue
      await db.from('contracts').update({ uf, ...(r.municipality ? {} : { municipality: g?.city ?? null }) }).eq('id', r.id).is('uf', null)
      contracts++
    }
  }
  revalidatePath('/painel'); revalidatePath('/carteira'); revalidatePath('/companies')
  return { ok: true, filled, notFound, contracts, remaining: Math.max(0, todo.length - MAX_PER_RUN) }
}
