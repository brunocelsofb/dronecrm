// ─── Théo: contexto da empresa no servidor ───────────────────────────────────
// Configuração em organization_settings.theo_settings (linha da empresa):
//   active: IA em uso · models: modelo por IA · keys: { anthropic|openai|gemini: { key_enc, last4 } }
//   allowed_user_ids: quem além do admin usa
// Teto do mês (estimado, US$): organization_settings.assistant_monthly_budget_usd (já existia)
// Ações por plano em plan_features.theo_tools (Super Admin). Sem chave cadastrada, o Théo
// não funciona — inclusive na empresa padrão: cada licença paga o próprio uso.

import { createAdminClient } from '@/lib/supabase/admin'
import { getUserAccess } from '@/lib/auth/access'
import { getTenantFeatures } from '@/lib/config/tenant-features'
import { resolveTenantId } from '@/lib/tenant/context'
import { getSupportSession } from '@/lib/tenant/support'
import { decryptSecret } from '@/lib/ai/tenant-key'
import { canUseTheo, defaultTheoModel, effectiveTheoTools, isTheoModel, isTheoProvider, THEO_PROVIDERS, type TheoProvider, type TheoTool } from '@/lib/ai/theo-catalog'

export type TheoKeyInfo = { last4: string; updated_at?: string }
export type TheoSettings = {
  active?: TheoProvider | null
  models?: Partial<Record<TheoProvider, string>>
  keys?: Partial<Record<TheoProvider, { key_enc: string; last4: string; updated_at?: string }>>
  budget_usd?: number
  allowed_user_ids?: string[]
}
export const DEFAULT_BUDGET_USD = 10

export function readTheoSettings(raw: unknown): TheoSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as TheoSettings
  return {
    active: isTheoProvider(s.active) ? s.active : null,
    models: s.models ?? {},
    keys: s.keys ?? {},
    budget_usd: Number.isFinite(Number(s.budget_usd)) && Number(s.budget_usd) > 0 ? Number(s.budget_usd) : DEFAULT_BUDGET_USD,
    allowed_user_ids: Array.isArray(s.allowed_user_ids) ? s.allowed_user_ids.filter(x => typeof x === 'string') : [],
  }
}
export const modelFor = (s: TheoSettings, p: TheoProvider) => (isTheoModel(p, s.models?.[p]) ? s.models![p]! : defaultTheoModel(p))

// Custo do mês (estimado) da empresa
export async function monthUsage(tenantId: string): Promise<{ total: number; byProvider: Record<string, { cost: number; calls: number }> }> {
  const start = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 7) + '-01T03:00:00Z'
  const { data } = await createAdminClient().from('assistant_usage_log').select('provider, cost_usd').eq('tenant_id', tenantId).gte('created_at', start).limit(20000)
  const byProvider: Record<string, { cost: number; calls: number }> = {}
  let total = 0
  for (const r of data ?? []) {
    const k = String(r.provider ?? 'anthropic')
    const c = Number(r.cost_usd ?? 0)
    total += c
    byProvider[k] = { cost: (byProvider[k]?.cost ?? 0) + c, calls: (byProvider[k]?.calls ?? 0) + 1 }
  }
  return { total, byProvider }
}

export type TheoContext = {
  tenantId: string; userId: string; isAdmin: boolean; canUse: boolean; support: boolean
  settings: TheoSettings; companyName: string | null
  planTools: TheoTool[]   // o que a licença inclui (para a tela)
  tools: TheoTool[]       // o que esta pessoa pode usar (licença ∩ abas do perfil)
  provider: TheoProvider | null; model: string | null; key: string | null
}

export async function loadTheoContext(): Promise<TheoContext | null> {
  const access = await getUserAccess()
  if (!access) return null
  const tenantId = await resolveTenantId()
  if (!tenantId) return null
  const admin = createAdminClient()
  const [{ data: org }, { data: me }, { data: tenant }, tf, support] = await Promise.all([
    admin.from('organization_settings').select('theo_settings, company_name, assistant_monthly_budget_usd').eq('tenant_id', tenantId).maybeSingle(),
    admin.from('profiles').select('role').eq('id', access.userId).maybeSingle(),
    admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    getTenantFeatures(tenantId),
    getSupportSession(),
  ])
  const { data: planRow } = await admin.from('plan_features').select('theo_tools').eq('plan', tf.plan).maybeSingle()
  const planToolNames = (planRow as { theo_tools?: string[] | null } | null)?.theo_tools ?? null
  const o = org as { theo_settings?: unknown; assistant_monthly_budget_usd?: number | null } | null
  const settings = readTheoSettings({ ...((o?.theo_settings as object) ?? {}), budget_usd: o?.assistant_monthly_budget_usd ?? DEFAULT_BUDGET_USD })
  const role = access.isAdmin ? 'admin' : (me?.role as string | null)
  const planTools = effectiveTheoTools(planToolNames, tf.features)
  const tools = effectiveTheoTools(planToolNames, access.features)
  const provider = settings.active && settings.keys?.[settings.active] ? settings.active : null
  let key: string | null = null
  if (provider) {
    try { key = decryptSecret(settings.keys![provider]!.key_enc) } catch { key = null }
  }
  return {
    tenantId, userId: access.userId, isAdmin: access.isAdmin,
    canUse: canUseTheo(role, access.userId, settings.allowed_user_ids) && tools.length > 0,
    support: !!support && support.tenantId === tenantId,
    settings, companyName: ((org as { company_name?: string | null } | null)?.company_name || (tenant?.name as string | null) || null),
    planTools, tools, provider, model: provider ? modelFor(settings, provider) : null, key,
  }
}

export const providerLabel = (p: TheoProvider | null) => (p ? THEO_PROVIDERS.find(x => x.id === p)?.label ?? p : null)
