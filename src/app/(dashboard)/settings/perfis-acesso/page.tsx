/**
 * Configurações → Perfis de acesso (Admin).
 * Quais abas cada perfil vê nesta empresa. Admin vê sempre tudo o que o plano libera.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentProfile } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { FEATURES } from '@/lib/config/plans'
import { ACCESS_PROFILES, readProfileFeatures } from '@/lib/auth/access-profiles'
import { ProfileMatrixEditor } from '@/components/settings/profile-matrix-editor'

export const dynamic = 'force-dynamic'

export default async function PerfisAcessoPage() {
  const me = await getCurrentProfile()
  if (me?.role !== 'admin') redirect('/')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [{ features: planFeatures }, { data: org }, { data: people }] = await Promise.all([
    getTenantFeatures(tenantId),
    db.from('organization_settings').select('profile_features').eq('tenant_id', tenantId).maybeSingle(),
    db.from('profiles').select('access_profile, role').eq('tenant_id', tenantId).not('is_super_admin', 'is', true),
  ])
  const counts: Record<string, number> = {}
  for (const p of people ?? []) if (p.role !== 'admin') counts[p.access_profile ?? 'gestor'] = (counts[p.access_profile ?? 'gestor'] ?? 0) + 1

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">Perfis de acesso</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-gray-500">
          Marque as abas que cada perfil vê no menu. O <strong>Admin</strong> vê sempre todas as abas do plano.
          O perfil de cada pessoa é escolhido em <Link href="/users" className="text-brand-700 hover:underline">Usuários</Link>.
          Abas fora do plano da licença não aparecem aqui.
        </p>
      </div>
      <ProfileMatrixEditor
        features={FEATURES.filter(f => planFeatures.includes(f.key)).map(f => ({ key: f.key, label: f.label }))}
        profiles={ACCESS_PROFILES.map(p => ({ ...p, people: counts[p.id] ?? 0 }))}
        initial={readProfileFeatures(org?.profile_features)}
        customized={!!org?.profile_features}
      />
    </div>
  )
}
