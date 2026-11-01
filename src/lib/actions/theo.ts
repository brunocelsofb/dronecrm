'use server'
// ─── Théo: configuração da empresa (só o admin) ───────────────────────────────
// A empresa liga uma ou mais IAs (Anthropic, OpenAI, Gemini) com a chave dela —
// cada licença paga o próprio uso — e escolhe qual está em uso. Chaves cifradas
// (SETTINGS_ENCRYPTION_KEY), nunca voltam para o navegador (só o final).

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { getSupportSession, SUPPORT_READONLY_MESSAGE } from '@/lib/tenant/support'
import { encryptSecret } from '@/lib/ai/tenant-key'
import { checkTheoKey } from '@/lib/ai/theo-engine'
import { isTheoModel, isTheoProvider, defaultTheoModel, THEO_TOOL_NAMES } from '@/lib/ai/theo-catalog'
import { readTheoSettings, type TheoSettings } from '@/lib/ai/theo-server'
import { isPlanId } from '@/lib/config/plans'

type Result = { ok: true } | { ok: false; error: string }

async function adminGuard(): Promise<{ tenantId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado.' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'admin') return { error: 'Só o administrador da empresa configura o Théo.' }
  const tenantId = await resolveTenantId()
  if (!tenantId) return { error: 'Empresa não identificada.' }
  const s = await getSupportSession()
  if (s && s.tenantId === tenantId) return { error: SUPPORT_READONLY_MESSAGE }
  return { tenantId }
}

async function load(tenantId: string): Promise<{ raw: Record<string, unknown>; s: TheoSettings }> {
  const { data } = await createAdminClient().from('organization_settings').select('theo_settings').eq('tenant_id', tenantId).maybeSingle()
  const raw = ((data as { theo_settings?: Record<string, unknown> } | null)?.theo_settings ?? {}) as Record<string, unknown>
  return { raw, s: readTheoSettings(raw) }
}
async function save(tenantId: string, next: Record<string, unknown>): Promise<Result> {
  const { error } = await createAdminClient().from('organization_settings').update({ theo_settings: next }).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/settings/assistente')
  revalidatePath('/ia')
  return { ok: true }
}

export async function saveTheoKey(provider: string, apiKey: string, model: string): Promise<Result & { last4?: string }> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isTheoProvider(provider)) return { ok: false, error: 'Escolha Anthropic, OpenAI ou Gemini.' }
  const key = String(apiKey ?? '').trim()
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return { ok: false, error: 'Chave inválida. Copie a chave inteira, sem espaços.' }
  const bad = await checkTheoKey(provider, key)
  if (bad) return { ok: false, error: bad }
  const { raw, s } = await load(g.tenantId)
  const keys = { ...(s.keys ?? {}), [provider]: { key_enc: encryptSecret(key), last4: key.slice(-4), updated_at: new Date().toISOString() } }
  const models = { ...(s.models ?? {}), [provider]: isTheoModel(provider, model) ? model : defaultTheoModel(provider) }
  // Primeira IA ligada já fica em uso
  const r = await save(g.tenantId, { ...raw, keys, models, active: s.active ?? provider })
  return r.ok ? { ok: true, last4: key.slice(-4) } : r
}

export async function removeTheoKey(provider: string): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isTheoProvider(provider)) return { ok: false, error: 'IA inválida.' }
  const { raw, s } = await load(g.tenantId)
  const keys = { ...(s.keys ?? {}) }
  delete keys[provider]
  const active = s.active === provider ? ((['anthropic', 'openai', 'gemini'] as const).find(p => keys[p]) ?? null) : s.active
  return save(g.tenantId, { ...raw, keys, active })
}

export async function setTheoActive(provider: string, model: string): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!isTheoProvider(provider) || !isTheoModel(provider, model)) return { ok: false, error: 'Modelo inválido.' }
  const { raw, s } = await load(g.tenantId)
  if (!s.keys?.[provider]) return { ok: false, error: 'Cadastre a chave dessa IA antes.' }
  return save(g.tenantId, { ...raw, active: provider, models: { ...(s.models ?? {}), [provider]: model } })
}

export async function setTheoUsers(userIds: string[]): Promise<Result> {
  const g = await adminGuard()
  if ('error' in g) return { ok: false, error: g.error }
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).filter(x => /^[0-9a-f-]{36}$/i.test(String(x))))]
  // Só pessoas da própria empresa
  const { data } = ids.length ? await createAdminClient().from('profiles').select('id').eq('tenant_id', g.tenantId).in('id', ids) : { data: [] }
  const valid = (data ?? []).map(p => p.id as string)
  const { raw } = await load(g.tenantId)
  return save(g.tenantId, { ...raw, allowed_user_ids: valid })
}

// ─── Super Admin: ações do Théo em cada plano ────────────────────────────────
export async function setPlanTheoTools(plan: string, tools: string[] | null): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado.' }
  const { data: me } = await createAdminClient().from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle()
  if (me?.is_super_admin !== true) return { ok: false, error: 'Só o Super Admin escolhe as ações por plano.' }
  if (!isPlanId(plan)) return { ok: false, error: 'Plano inválido.' }
  const list = tools === null ? null : [...new Set(tools.filter(t => THEO_TOOL_NAMES.includes(t)))]
  const { error } = await createAdminClient().from('plan_features').update({ theo_tools: list }).eq('plan', plan)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/super-admin')
  return { ok: true }
}
