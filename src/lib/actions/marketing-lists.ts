'use server'

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { encryptSecret } from '@/lib/ai/tenant-key'
import { loadListMembers } from '@/lib/marketing/list-data'
import { readFilters, type ListFilters } from '@/lib/marketing/segments'
import { campaignCode } from '@/lib/marketing/tracking'
import { readTools, mailchimpDc, mailchimpAudiences, mailchimpUpsert, rdConversion, openKey, RD_CRM_PREFIX, type ToolsConfig } from '@/lib/marketing/tools'

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

async function ctx() {
  const a = await getUserAccess()
  if (!a || !a.features.includes('marketing')) return null
  const tenantId = await resolveTenantId()
  return { me: a, tenantId, db: await createScopedAdmin(tenantId) }
}
const NO = { ok: false as const, error: 'Sem acesso à aba Marketing.' }
const NO_ADMIN = { ok: false as const, error: 'Só o Admin conecta ferramentas (Configurações → Integrações).' }
const LEGAL = ['pre_existent_contract', 'consent', 'legitimate_interest']

async function getTools(db: Awaited<ReturnType<typeof createScopedAdmin>>, tenantId: string): Promise<{ raw: Record<string, unknown>; tools: ToolsConfig }> {
  const { data } = await db.from('organization_settings').select('marketing_tools').eq('tenant_id', tenantId).maybeSingle()
  const raw = ((data?.marketing_tools as Record<string, unknown>) ?? {})
  return { raw, tools: readTools(raw) }
}
async function putTools(db: Awaited<ReturnType<typeof createScopedAdmin>>, tenantId: string, raw: Record<string, unknown>) {
  const { error } = await db.from('organization_settings').update({ marketing_tools: raw }).eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)
}

// ── Listas ───────────────────────────────────────────────────────────────────
export async function saveList(input: { id?: string | null; name: string; audience: string; filters: ListFilters }): Promise<Result<{ id: string }>> {
  const c = await ctx(); if (!c) return NO
  const name = (input.name ?? '').trim().slice(0, 120)
  if (!name) return { ok: false, error: 'Dê um nome à lista.' }
  if (!['leads', 'clientes', 'ambos', 'inativos'].includes(input.audience)) return { ok: false, error: 'Público inválido.' }
  const row = { name, audience: input.audience, filters: readFilters(input.filters), updated_at: new Date().toISOString() }
  if (input.id) {
    const { data, error } = await c.db.from('marketing_lists').update(row).eq('id', input.id).select('id')
    if (error) return { ok: false, error: error.message }
    if (!data?.length) return { ok: false, error: 'Lista não encontrada.' }
    revalidatePath('/marketing'); return { ok: true, id: input.id }
  }
  const { data, error } = await c.db.from('marketing_lists').insert({ ...row, created_by: c.me.userId }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao criar.' }
  revalidatePath('/marketing'); return { ok: true, id: data.id }
}

export async function deleteList(id: string): Promise<Result> {
  const c = await ctx(); if (!c) return NO
  const { error } = await c.db.from('marketing_lists').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/marketing'); return { ok: true }
}

export async function previewList(input: { audience: string; filters: ListFilters }): Promise<Result<{ total: number; sample: { email: string; name: string; company: string | null; kind: string }[]; excludedOptout: number; excludedInvalid: number }>> {
  const c = await ctx(); if (!c) return NO
  try {
    const r = await loadListMembers(c.tenantId, input)
    return { ok: true, total: r.members.length, sample: r.members.slice(0, 15).map(m => ({ email: m.email, name: m.name, company: m.company, kind: m.kind })), excludedOptout: r.excludedOptout, excludedInvalid: r.excludedInvalid }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao calcular a lista.' }
  }
}

// ── Ferramentas (chaves criptografadas) ─────────────────────────────────────
export async function saveMailchimpKey(input: { key: string; dc?: string | null }): Promise<Result<{ audiences: { id: string; name: string; members: number }[] }>> {
  const c = await ctx(); if (!c) return NO
  if (!c.me.isAdmin) return NO_ADMIN
  const key = (input.key ?? '').trim()
  if (key.length < 10) return { ok: false, error: 'Cole a chave de API do Mailchimp.' }
  const dc = (input.dc ?? '').trim().toLowerCase() || mailchimpDc(key)
  if (!dc) return { ok: false, error: 'Informe o prefixo do servidor (ex.: us21 — aparece no endereço do Mailchimp e no fim da chave).' }
  let audiences: { id: string; name: string; members: number }[]
  try { audiences = await mailchimpAudiences(key, dc) } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Não foi possível falar com o Mailchimp.' } }
  const { raw } = await getTools(c.db, c.tenantId)
  raw.mailchimp = { ...((raw.mailchimp as object) ?? {}), key_enc: encryptSecret(key), last4: key.slice(-4), dc }
  await putTools(c.db, c.tenantId, raw)
  revalidatePath('/marketing')
  return { ok: true, audiences }
}

export async function listMailchimpAudiences(): Promise<Result<{ audiences: { id: string; name: string; members: number }[] }>> {
  const c = await ctx(); if (!c) return NO
  if (!c.me.isAdmin) return NO_ADMIN
  const { tools } = await getTools(c.db, c.tenantId)
  if (!tools.mailchimp) return { ok: false, error: 'Conecte o Mailchimp primeiro.' }
  try { return { ok: true, audiences: await mailchimpAudiences(openKey(tools.mailchimp.key_enc), tools.mailchimp.dc) } }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Falha ao falar com o Mailchimp.' } }
}

export async function saveMailchimpOptions(input: { listId: string; listName: string; doubleOptin: boolean }): Promise<Result> {
  const c = await ctx(); if (!c) return NO
  if (!c.me.isAdmin) return NO_ADMIN
  const { raw, tools } = await getTools(c.db, c.tenantId)
  if (!tools.mailchimp) return { ok: false, error: 'Conecte o Mailchimp primeiro.' }
  raw.mailchimp = { ...(raw.mailchimp as object), list_id: input.listId || null, list_name: input.listName || null, double_optin: !!input.doubleOptin }
  await putTools(c.db, c.tenantId, raw)
  revalidatePath('/marketing'); return { ok: true }
}

export async function saveRdKey(input: { key: string; legalBasis: string }): Promise<Result> {
  const c = await ctx(); if (!c) return NO
  if (!c.me.isAdmin) return NO_ADMIN
  const key = (input.key ?? '').trim()
  const { raw } = await getTools(c.db, c.tenantId)
  if (!LEGAL.includes(input.legalBasis)) return { ok: false, error: 'Base legal inválida.' }
  if (key) {
    if (key.length < 10) return { ok: false, error: 'Cole a chave de API do RD Station.' }
    raw.rd_station = { ...((raw.rd_station as object) ?? {}), key_enc: encryptSecret(key), last4: key.slice(-4), legal_basis: input.legalBasis }
  } else {
    if (!raw.rd_station) return { ok: false, error: 'Cole a chave de API do RD Station.' }
    raw.rd_station = { ...(raw.rd_station as object), legal_basis: input.legalBasis }
  }
  await putTools(c.db, c.tenantId, raw)
  revalidatePath('/marketing'); return { ok: true }
}

export async function disconnectTool(provider: 'mailchimp' | 'rd_station'): Promise<Result> {
  const c = await ctx(); if (!c) return NO
  if (!c.me.isAdmin) return NO_ADMIN
  const { raw } = await getTools(c.db, c.tenantId)
  delete raw[provider]
  await putTools(c.db, c.tenantId, raw)
  revalidatePath('/marketing'); return { ok: true }
}

// ── Envio em lotes (a tela chama até terminar, para não estourar o tempo) ───
export async function startSync(listId: string, provider: 'mailchimp' | 'rd_station'): Promise<Result<{ syncId: string; total: number }>> {
  const c = await ctx(); if (!c) return NO
  const { tools } = await getTools(c.db, c.tenantId)
  if (provider === 'mailchimp' && !tools.mailchimp?.list_id) return { ok: false, error: 'Conecte o Mailchimp e escolha o público (Configurações → Integrações → Mailchimp).' }
  if (provider === 'rd_station' && !tools.rd_station) return { ok: false, error: 'Conecte o RD Station (Configurações → Integrações → RD Station).' }
  const { data: list } = await c.db.from('marketing_lists').select('id, audience, filters').eq('id', listId).maybeSingle()
  if (!list) return { ok: false, error: 'Lista não encontrada.' }
  const { members } = await loadListMembers(c.tenantId, list)
  if (!members.length) return { ok: false, error: 'A lista está vazia.' }
  const target = provider === 'mailchimp' ? tools.mailchimp!.list_name ?? tools.mailchimp!.list_id! : 'RD Station Marketing'
  const { data, error } = await c.db.from('marketing_list_syncs').insert({ list_id: listId, provider, target, total: members.length, created_by: c.me.userId }).select('id').single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao iniciar.' }
  return { ok: true, syncId: data.id, total: members.length }
}

// Lote pequeno: cabe com folga no tempo máximo de uma chamada no servidor
const BATCH = 10
export async function runSyncBatch(syncId: string, offset: number): Promise<Result<{ done: boolean; next: number; sent: number; failed: number; lastError: string | null }>> {
  const c = await ctx(); if (!c) return NO
  const { data: sync } = await c.db.from('marketing_list_syncs').select('id, list_id, provider, status, sent, failed, errors').eq('id', syncId).maybeSingle()
  if (!sync) return { ok: false, error: 'Envio não encontrado.' }
  if (sync.status !== 'enviando') return { ok: true, done: true, next: offset, sent: sync.sent, failed: sync.failed, lastError: null }
  const { data: list } = await c.db.from('marketing_lists').select('id, name, audience, filters').eq('id', sync.list_id).maybeSingle()
  if (!list) return { ok: false, error: 'Lista não encontrada.' }
  const { tools } = await getTools(c.db, c.tenantId)
  const { members } = await loadListMembers(c.tenantId, list)
  const slice = members.slice(Math.max(0, offset), Math.max(0, offset) + BATCH)
  const tag = `CRM - ${list.name}`.slice(0, 100)
  const identifier = `${RD_CRM_PREFIX}${campaignCode(list.name)}`

  let sent = 0, failed = 0
  const errs: string[] = []
  let send: (m: (typeof members)[number]) => Promise<void>
  try {
    if (sync.provider === 'mailchimp') {
      const mcCfg = tools.mailchimp
      if (!mcCfg?.list_id) throw new Error('Mailchimp desconectado ou sem público escolhido.')
      const key = openKey(mcCfg.key_enc)
      send = m => mailchimpUpsert(key, mcCfg.dc, mcCfg.list_id!, m, tag, !!mcCfg.double_optin)
    } else {
      const rd = tools.rd_station
      if (!rd) throw new Error('RD Station desconectado.')
      const key = openKey(rd.key_enc)
      send = m => rdConversion(key, m, identifier, tag, rd.legal_basis ?? null)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha'
    await c.db.from('marketing_list_syncs').update({ status: 'erro', errors: msg, finished_at: new Date().toISOString() }).eq('id', syncId)
    return { ok: false, error: msg }
  }

  // 5 ao mesmo tempo (respeita os limites das ferramentas)
  for (let i = 0; i < slice.length; i += 5) {
    const results = await Promise.allSettled(slice.slice(i, i + 5).map(m => send(m)))
    for (const r of results) {
      if (r.status === 'fulfilled') sent++
      else { failed++; if (errs.length < 3) errs.push(r.reason instanceof Error ? r.reason.message : String(r.reason)) }
    }
  }

  const next = offset + slice.length
  const done = next >= members.length || slice.length === 0
  const allFailed = sent === 0 && failed > 0 && offset === 0
  const totalSent = sync.sent + sent, totalFailed = sync.failed + failed
  const errorText = [sync.errors, ...errs].filter(Boolean).join(' · ').slice(0, 1000) || null
  await c.db.from('marketing_list_syncs').update({
    sent: totalSent, failed: totalFailed, errors: errorText,
    ...(done || allFailed ? { status: allFailed ? 'erro' : 'concluido', finished_at: new Date().toISOString() } : {}),
  }).eq('id', syncId)
  if (done || allFailed) revalidatePath('/marketing')
  return { ok: true, done: done || allFailed, next, sent: totalSent, failed: totalFailed, lastError: errs[0] ?? null }
}

// ── Descadastros (LGPD) ─────────────────────────────────────────────────────
export async function addOptout(email: string): Promise<Result> {
  const c = await ctx(); if (!c) return NO
  const e = (email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return { ok: false, error: 'E-mail inválido.' }
  const { error } = await c.db.from('marketing_optouts').upsert({ email: e, source: 'manual' }, { onConflict: 'tenant_id,email', ignoreDuplicates: true })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/marketing'); return { ok: true }
}

export async function removeOptout(id: string): Promise<Result> {
  const c = await ctx(); if (!c) return NO
  const { error } = await c.db.from('marketing_optouts').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/marketing'); return { ok: true }
}
