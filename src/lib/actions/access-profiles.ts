'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentProfile } from '@/lib/auth/role'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { FEATURE_KEYS } from '@/lib/config/plans'
import { isAreaId, isAccessProfile, resolveAreas } from '@/lib/auth/access-profiles'

type Result = { ok: true } | { ok: false; error: string }

async function adminDb() {
  const me = await getCurrentProfile()
  if (me?.role !== 'admin') return null
  const tenantId = await resolveTenantId()
  return { tenantId, db: await createScopedAdmin(tenantId) }
}

// Admin: quais abas cada área vê nesta empresa (null = volta ao padrão)
export async function saveProfileFeatures(matrix: Record<string, string[]> | null): Promise<Result> {
  const ctx = await adminDb()
  if (!ctx) return { ok: false, error: 'Só o Admin altera as áreas.' }
  let clean: Record<string, string[]> | null = null
  if (matrix) {
    clean = {}
    for (const [k, v] of Object.entries(matrix)) {
      if (!isAreaId(k) || !Array.isArray(v)) continue
      clean[k] = [...new Set(v.filter(f => FEATURE_KEYS.includes(f)))]
    }
  }
  const { error } = await ctx.db.from('organization_settings').update({ profile_features: clean }).eq('tenant_id', ctx.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}

type AreasRaw = { custom?: { id: string; label: string; description?: string }[]; hidden?: string[]; values?: Record<string, boolean>; labels?: Record<string, string> }

async function readRaw(ctx: { tenantId: string; db: Awaited<ReturnType<typeof createScopedAdmin>> }) {
  const { data } = await ctx.db.from('organization_settings').select('access_areas, profile_features').eq('tenant_id', ctx.tenantId).maybeSingle()
  return { raw: ((data?.access_areas ?? {}) as AreasRaw), features: data?.profile_features }
}
async function writeRaw(ctx: { tenantId: string; db: Awaited<ReturnType<typeof createScopedAdmin>> }, raw: AreasRaw): Promise<Result> {
  const { error } = await ctx.db.from('organization_settings').update({ access_areas: raw }).eq('tenant_id', ctx.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}

// Vê valores (por área)
export async function setAreaSeesValues(areaId: string, on: boolean): Promise<Result> {
  const ctx = await adminDb()
  if (!ctx) return { ok: false, error: 'Só o Admin altera as áreas.' }
  if (!isAreaId(areaId)) return { ok: false, error: 'Área inválida.' }
  const { raw } = await readRaw(ctx)
  return writeRaw(ctx, { ...raw, values: { ...(raw.values ?? {}), [areaId]: !!on } })
}

// Renomear área
export async function renameArea(areaId: string, label: string): Promise<Result> {
  const ctx = await adminDb()
  if (!ctx) return { ok: false, error: 'Só o Admin altera as áreas.' }
  const name = String(label ?? '').trim().slice(0, 60)
  if (!isAreaId(areaId) || !name) return { ok: false, error: 'Informe o nome.' }
  const { raw } = await readRaw(ctx)
  if (isAccessProfile(areaId)) return writeRaw(ctx, { ...raw, labels: { ...(raw.labels ?? {}), [areaId]: name } })
  return writeRaw(ctx, { ...raw, custom: (raw.custom ?? []).map(c => c.id === areaId ? { ...c, label: name } : c) })
}

// Criar área (começa sem abas e sem valores; o Admin marca depois)
export async function createArea(label: string): Promise<Result> {
  const ctx = await adminDb()
  if (!ctx) return { ok: false, error: 'Só o Admin altera as áreas.' }
  const name = String(label ?? '').trim().slice(0, 60)
  if (!name) return { ok: false, error: 'Informe o nome da área.' }
  const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'area'
  const { raw, features } = await readRaw(ctx)
  const taken = new Set(resolveAreas(raw, features).map(a => a.id).concat(raw.hidden ?? []))
  let id = isAccessProfile(base) ? `${base}_2` : base
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`
  const r = await writeRaw(ctx, { ...raw, custom: [...(raw.custom ?? []), { id, label: name }] })
  if (!r.ok) return r
  const matrix = { ...((features ?? {}) as Record<string, string[]>), [id]: ['dashboard'] }
  await ctx.db.from('organization_settings').update({ profile_features: matrix }).eq('tenant_id', ctx.tenantId)
  return { ok: true }
}

// Excluir área (padrão: só esconde; criada: apaga). Bloqueia se houver pessoas nela.
export async function deleteArea(areaId: string): Promise<Result> {
  const ctx = await adminDb()
  if (!ctx) return { ok: false, error: 'Só o Admin altera as áreas.' }
  if (!isAreaId(areaId)) return { ok: false, error: 'Área inválida.' }
  if (areaId === 'gestor') return { ok: false, error: 'A área Comercial — Gestor é a padrão e não pode ser excluída.' }
  const { count } = await ctx.db.from('profiles').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('access_profile', areaId)
  if ((count ?? 0) > 0) return { ok: false, error: `Há ${count} pessoa(s) nesta área. Mude a área delas em Usuários antes de excluir.` }
  const { raw } = await readRaw(ctx)
  if (isAccessProfile(areaId)) return writeRaw(ctx, { ...raw, hidden: [...new Set([...(raw.hidden ?? []), areaId])] })
  return writeRaw(ctx, { ...raw, custom: (raw.custom ?? []).filter(c => c.id !== areaId) })
}

// Trazer de volta uma área padrão escondida
export async function restoreArea(areaId: string): Promise<Result> {
  const ctx = await adminDb()
  if (!ctx) return { ok: false, error: 'Só o Admin altera as áreas.' }
  const { raw } = await readRaw(ctx)
  return writeRaw(ctx, { ...raw, hidden: (raw.hidden ?? []).filter(h => h !== areaId) })
}
