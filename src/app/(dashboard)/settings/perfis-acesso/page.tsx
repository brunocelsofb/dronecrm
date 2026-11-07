/**
 * Configurações → Áreas e acessos (Admin).
 * Abas de cada área, se a área vê valores, e criar/renomear/excluir áreas.
 * Admin vê sempre tudo o que o plano libera, com valores.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { FEATURES } from '@/lib/config/plans'
import { ACCESS_PROFILES, resolveAreas } from '@/lib/auth/access-profiles'
import { AreaMatrixEditor } from '@/components/settings/area-matrix-editor'

export const dynamic = 'force-dynamic'

export default async function AreasAcessoPage() {
  const me = await getCurrentProfile()
  if (me?.role !== 'admin') redirect('/')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ features: planFeatures }, { data: org }, { data: people }] = await Promise.all([
    getTenantFeatures(tenantId),
    db.from('organization_settings').select('profile_features, access_areas').eq('tenant_id', tenantId).maybeSingle(),
    db.from('profiles').select('access_profile, role').eq('tenant_id', tenantId).not('is_super_admin', 'is', true),
  ])
  const counts: Record<string, number> = {}
  for (const p of people ?? []) if (p.role !== 'admin') counts[p.access_profile ?? 'gestor'] = (counts[p.access_profile ?? 'gestor'] ?? 0) + 1
  const areas = resolveAreas(org?.access_areas, org?.profile_features)
  const hidden = ((org?.access_areas as { hidden?: string[] } | null)?.hidden ?? [])
  const hiddenBuiltins = ACCESS_PROFILES.filter(p => hidden.includes(p.id)).map(p => ({ id: p.id, label: p.label }))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">Áreas e acessos</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-gray-500">
          Cada pessoa pertence a uma área. Marque as abas que a área vê no menu e se ela <strong>vê valores</strong>.
          Clique no nome para renomear. O <strong>Admin</strong> vê sempre tudo do plano, com valores.
          A área de cada pessoa, e a liberação avulsa de valores, ficam em <Link href="/users" className="text-brand-700 hover:underline">Usuários</Link>.
        </p>
      </div>
      <AreaMatrixEditor
        features={FEATURES.filter(f => planFeatures.includes(f.key)).map(f => ({ key: f.key, label: f.label }))}
        areas={areas.map(a => ({ ...a, people: counts[a.id] ?? 0 }))}
        hiddenBuiltins={hiddenBuiltins}
        customized={!!org?.profile_features}
      />
    </div>
  )
}
