'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { FEATURE_KEYS, isPlanId } from '@/lib/config/plans'

async function assertSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Nao autenticado')

  const { data: profile } = await supabase
    .schema('contract_crm')
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_super_admin) throw new Error('Acesso negado')
  return user
}

export async function getSuperAdminData() {
  await assertSuperAdmin()
  const admin = createAdminClient()

  const { data: tenants, error } = await admin
    .schema('contract_crm')
    .from('tenants')
    .select('id, name, slug, plan, is_active, max_users, trial_ends_at, created_at, features_add, features_remove')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  // Só métricas e status (contagens e datas) — nunca o conteúdo da empresa.
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const nowIso = new Date().toISOString()
  const db = admin.schema('contract_crm')
  const tenantsWithCount = await Promise.all(
    (tenants ?? []).map(async (t) => {
      const head = { count: 'exact' as const, head: true }
      const [users, companies, openRuns, wa30, lastAct, grant, dpa] = await Promise.all([
        db.from('profiles').select('id', head).eq('tenant_id', t.id),
        db.from('companies').select('id', head).eq('tenant_id', t.id),
        db.from('pipeline_runs').select('id', head).eq('tenant_id', t.id).eq('status', 'open'),
        db.from('contract_whatsapp_messages').select('id', head).eq('tenant_id', t.id).gte('created_at', since30),
        db.from('activities').select('created_at').eq('tenant_id', t.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('support_access_grants').select('expires_at').eq('tenant_id', t.id).is('revoked_at', null).lte('starts_at', nowIso).gt('expires_at', nowIso).order('expires_at', { ascending: false }).limit(1).maybeSingle(),
        db.from('dpa_acceptances').select('version, accepted_at').eq('tenant_id', t.id).order('accepted_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      return {
        ...t,
        user_count: users.count ?? 0,
        metrics: {
          companies: companies.count ?? 0,
          openOpportunities: openRuns.count ?? 0,
          whatsapp30d: wa30.count ?? 0,
          lastActivityAt: (lastAct.data?.created_at as string | undefined) ?? null,
        },
        supportUntil: (grant.data?.expires_at as string | undefined) ?? null,
        dpa: dpa.data ? { version: dpa.data.version as string, acceptedAt: dpa.data.accepted_at as string } : null,
      }
    })
  )

  return tenantsWithCount
}

export async function createNewTenantAndUser(formData: FormData): Promise<void> {
  await assertSuperAdmin()
  const admin = createAdminClient()

  const name = formData.get('name') as string
  const slug = formData.get('slug') as string
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string
  const plan = (formData.get('plan') as string) || 'starter'
  const maxUsers = parseInt(formData.get('max_users') as string) || 5
  const trialEndsAtRaw = formData.get('trial_ends_at') as string | null
  const trialEndsAt = trialEndsAtRaw && trialEndsAtRaw.trim() ? new Date(trialEndsAtRaw).toISOString() : null

  if (!name || !slug || !email || !password || !fullName) {
    throw new Error('Todos os campos sao obrigatorios')
  }

  const { data: tenant, error: tenantError } = await admin
    .schema('contract_crm')
    .from('tenants')
    .insert({ name, slug, plan, max_users: maxUsers, is_active: true, trial_ends_at: trialEndsAt })
    .select('id')
    .single()

  if (tenantError) throw new Error('Erro ao criar tenant: ' + tenantError.message)

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { tenant_id: tenant.id },
  })

  if (authError) {
    await admin.schema('contract_crm').from('tenants').delete().eq('id', tenant.id)
    throw new Error('Erro ao criar usuario: ' + authError.message)
  }

  const { error: profileError } = await admin
    .schema('contract_crm')
    .from('profiles')
    .insert({
      id: authData.user.id,
      full_name: fullName,
      email,
      tenant_id: tenant.id,
      role: 'admin',
    })

  if (profileError) throw new Error('Perfil falhou: ' + profileError.message)

  await admin
    .schema('contract_crm')
    .from('organization_settings')
    .insert({ id: tenant.id, tenant_id: tenant.id, name, company_name: name })

  // Funil básico + motivos de perda (a empresa ajusta em Funis e Etapas)
  const { seedTenantDefaults } = await import('@/lib/tenant/seed')
  const seeded = await seedTenantDefaults(tenant.id)
  if (!seeded.ok) console.error('[super-admin] funil básico não criado:', seeded.error)

  revalidatePath('/super-admin')
  redirect('/super-admin')
}

export async function updateTenantData(formData: FormData): Promise<void> {
  await assertSuperAdmin()
  const admin = createAdminClient()

  const tenantId = formData.get('tenant_id') as string
  const name = formData.get('name') as string
  const slug = formData.get('slug') as string
  const plan = formData.get('plan') as string
  const maxUsers = parseInt(formData.get('max_users') as string) || 5
  const trialEndsAtRaw = formData.get('trial_ends_at') as string | null
  const trialEndsAt = trialEndsAtRaw && trialEndsAtRaw.trim() ? new Date(trialEndsAtRaw).toISOString() : null

  if (!tenantId || !name || !slug || !plan) throw new Error('Campos obrigatorios ausentes')

  const { error } = await admin
    .schema('contract_crm')
    .from('tenants')
    .update({ name, slug, plan, max_users: maxUsers, trial_ends_at: trialEndsAt })
    .eq('id', tenantId)

  if (error) throw new Error('Erro ao atualizar tenant: ' + error.message)

  revalidatePath('/super-admin')
}

export async function toggleTenantActive(tenantId: string, isActive: boolean): Promise<void> {
  await assertSuperAdmin()
  const admin = createAdminClient()

  const { error } = await admin
    .schema('contract_crm')
    .from('tenants')
    .update({ is_active: isActive })
    .eq('id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/super-admin')
}

// ─── Planos e abas ────────────────────────────────────────────────────────────

function cleanFeatures(list: string[]): string[] {
  return [...new Set(list)].filter(f => FEATURE_KEYS.includes(f))
}

export async function savePlanFeatures(plan: string, features: string[]): Promise<{ ok?: true; error?: string }> {
  await assertSuperAdmin()
  if (!isPlanId(plan)) return { error: 'Plano inválido.' }
  const admin = createAdminClient()
  const { error } = await admin.schema('contract_crm').from('plan_features')
    .upsert({ plan, features: cleanFeatures(features), updated_at: new Date().toISOString() })
  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function saveTenantFeatures(tenantId: string, add: string[], remove: string[]): Promise<{ ok?: true; error?: string }> {
  await assertSuperAdmin()
  const a = cleanFeatures(add)
  const r = cleanFeatures(remove).filter(f => !a.includes(f))
  const admin = createAdminClient()
  const { error } = await admin.schema('contract_crm').from('tenants')
    .update({ features_add: a, features_remove: r }).eq('id', tenantId)
  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}
