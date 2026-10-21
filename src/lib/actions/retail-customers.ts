'use server'

// ─── Varejo: clientes pessoa física (cadastro, configuração e importação) ─────
// Só com a aba 'varejo' liberada. Cliente única por telefone dentro da empresa.

import * as XLSX from 'xlsx'
import { revalidatePath } from 'next/cache'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { cleanText, cleanLongText, parseMoney, parseStock } from '@/lib/retail/products'
import { canonicalPhone, onlyDigits, parseDate, readRetailSettings } from '@/lib/retail/customers'

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

async function guard(adminOnly = false): Promise<{ tenantId: string } | { error: string }> {
  const access = await hasFeature('varejo')
  if (!access) return { error: 'Sem acesso ao módulo Varejo.' }
  if (adminOnly && !access.isAdmin) return { error: 'Só o administrador pode mudar esta configuração.' }
  if (await getSupportSession()) return { error: 'Acesso de suporte é só leitura.' }
  return { tenantId: await requireTenantId() }
}

export type CustomerInput = {
  id?: string | null
  name: string
  phone?: string | null
  email?: string | null
  cpf?: string | null
  birth_date?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
  address?: string | null
  notes?: string | null
  whatsapp_optin?: boolean
}

function customerRow(input: CustomerInput): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const name = cleanText(input.name, 160)
  if (!name) return { ok: false, error: 'Informe o nome.' }
  const phone = input.phone ? canonicalPhone(input.phone) : null
  if (input.phone && String(input.phone).trim() && !phone) return { ok: false, error: 'Telefone inválido. Use DDD + número.' }
  const email = cleanText(input.email, 200)?.toLowerCase() ?? null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'E-mail inválido.' }
  const cpf = onlyDigits(input.cpf, 11)
  if (cpf && cpf.length !== 11) return { ok: false, error: 'CPF deve ter 11 dígitos.' }
  const birth = input.birth_date ? parseDate(input.birth_date) : null
  return {
    ok: true,
    row: {
      name, phone, email, cpf, birth_date: birth,
      city: cleanText(input.city, 80), state: cleanText(input.state, 2)?.toUpperCase() ?? null,
      cep: onlyDigits(input.cep, 8), address: cleanText(input.address, 300), notes: cleanLongText(input.notes, 2000),
      updated_at: new Date().toISOString(),
    },
  }
}

export async function saveRetailCustomer(input: CustomerInput): Promise<Result<{ id: string }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const r = customerRow(input)
  if (!r.ok) return r
  const db = await createScopedAdmin(g.tenantId)
  const optin = input.whatsapp_optin === true
  if (input.id) {
    const { data: cur } = await db.from('retail_customers').select('whatsapp_optin').eq('id', input.id).maybeSingle()
    if (!cur) return { ok: false, error: 'Cliente não encontrada.' }
    const patch = { ...r.row, whatsapp_optin: optin, ...(optin && !cur.whatsapp_optin ? { optin_at: new Date().toISOString() } : {}) }
    const { error } = await db.from('retail_customers').update(patch).eq('id', input.id)
    if (error) return { ok: false, error: error.code === '23505' ? 'Já existe uma cliente com esse telefone.' : error.message }
    revalidatePath('/varejo/clientes')
    return { ok: true, id: input.id }
  }
  const { data, error } = await db.from('retail_customers')
    .insert({ ...r.row, source: 'manual', whatsapp_optin: optin, optin_at: optin ? new Date().toISOString() : null })
    .select('id').single()
  if (error || !data) return { ok: false, error: error?.code === '23505' ? 'Já existe uma cliente com esse telefone.' : error?.message ?? 'Falha ao salvar.' }
  revalidatePath('/varejo/clientes')
  return { ok: true, id: data.id as string }
}

export async function deleteRetailCustomer(id: string): Promise<Result> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const db = await createScopedAdmin(g.tenantId)
  const { error } = await db.from('retail_customers').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/clientes')
  return { ok: true }
}

export async function saveRetailSettings(inactiveDays: number): Promise<Result> {
  const g = await guard(true)
  if ('error' in g) return { ok: false, error: g.error }
  const settings = readRetailSettings({ inactive_days: inactiveDays })
  if (settings.inactive_days !== inactiveDays) return { ok: false, error: 'Use de 7 a 730 dias.' }
  const db = await createScopedAdmin(g.tenantId)
  const { data: org } = await db.from('organization_settings').select('retail_settings').eq('tenant_id', g.tenantId).maybeSingle()
  const merged = { ...((org as { retail_settings?: Record<string, unknown> } | null)?.retail_settings ?? {}), inactive_days: inactiveDays }
  const { error } = await db.from('organization_settings').update({ retail_settings: merged }).eq('tenant_id', g.tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/varejo/clientes')
  return { ok: true }
}

// ── Importação ───────────────────────────────────────────────────────────────
// Uma linha por cliente. Mesma cliente (mesmo telefone) é atualizada; nada é apagado.
export type ImportCustomer = {
  name: string; phone: string | null; email: string | null; cpf: string | null; birth_date: string | null
  city: string | null; state: string | null; cep: string | null; address: string | null; notes: string | null
  legacy_last_purchase_at: string | null; legacy_total: number | null; legacy_orders: number | null; whatsapp_optin: boolean
}

const COLS: Record<string, string[]> = {
  name: ['nome', 'cliente', 'nome completo'],
  phone: ['telefone', 'celular', 'whatsapp', 'fone'],
  email: ['email', 'e-mail'],
  cpf: ['cpf'],
  birth_date: ['nascimento', 'data de nascimento', 'aniversario', 'aniversário'],
  city: ['cidade'],
  state: ['uf', 'estado'],
  cep: ['cep'],
  address: ['endereco', 'endereço'],
  notes: ['observacoes', 'observações', 'obs'],
  last: ['ultima compra', 'última compra', 'data da ultima compra', 'data da última compra'],
  total: ['total comprado', 'total gasto', 'valor total'],
  orders: ['qtd compras', 'quantidade de compras', 'compras', 'pedidos'],
  optin: ['aceita whatsapp', 'autoriza whatsapp', 'whatsapp marketing'],
}
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim()
function pick(rec: Record<string, unknown>, field: string): unknown {
  const wanted = COLS[field].map(norm)
  for (const [k, v] of Object.entries(rec)) if (wanted.includes(norm(k))) return v
  return undefined
}
const yes = (v: unknown) => ['sim', 's', 'yes', 'x', '1', 'true'].includes(norm(String(v ?? '')))

export async function parseRetailCustomerFile(formData: FormData): Promise<Result<{ customers: ImportCustomer[]; ignored: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Escolha a planilha.' }
  if (file.size > 950 * 1024) return { ok: false, error: 'Planilha maior que 950 KB. Divida em partes.' }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return { ok: false, error: 'Use Excel (.xlsx/.xls) ou CSV.' }
  let records: Record<string, unknown>[]
  try {
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' })
    records = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
  } catch {
    return { ok: false, error: 'Não foi possível ler a planilha.' }
  }
  if (!records.length) return { ok: false, error: 'A planilha está vazia (a primeira linha deve ter os títulos das colunas).' }
  if (records.length > 5000) return { ok: false, error: 'Máximo de 5.000 linhas por importação.' }
  const customers: ImportCustomer[] = []
  const ignored: string[] = []
  const seen = new Set<string>()
  records.forEach((rec, i) => {
    const line = i + 2
    const name = cleanText(pick(rec, 'name'), 160)
    const rawPhone = pick(rec, 'phone')
    const phone = canonicalPhone(rawPhone)
    if (!name) { if (Object.values(rec).some(v => String(v).trim())) ignored.push(`Linha ${line}: sem nome.`); return }
    if (rawPhone && String(rawPhone).trim() && !phone) ignored.push(`Linha ${line} (${name}): telefone inválido, importada sem telefone.`)
    if (phone) { if (seen.has(phone)) { ignored.push(`Linha ${line} (${name}): telefone repetido na planilha.`); return } seen.add(phone) }
    customers.push({
      name, phone,
      email: cleanText(pick(rec, 'email'), 200)?.toLowerCase() ?? null,
      cpf: (() => { const d = onlyDigits(pick(rec, 'cpf'), 11); return d && d.length === 11 ? d : null })(),
      birth_date: parseDate(pick(rec, 'birth_date')),
      city: cleanText(pick(rec, 'city'), 80), state: cleanText(pick(rec, 'state'), 2)?.toUpperCase() ?? null,
      cep: onlyDigits(pick(rec, 'cep'), 8), address: cleanText(pick(rec, 'address'), 300), notes: cleanLongText(pick(rec, 'notes'), 2000),
      legacy_last_purchase_at: parseDate(pick(rec, 'last')),
      legacy_total: parseMoney(pick(rec, 'total')),
      legacy_orders: parseStock(pick(rec, 'orders')),
      whatsapp_optin: yes(pick(rec, 'optin')),
    })
  })
  return { ok: true, customers, ignored: ignored.slice(0, 50) }
}

export async function importRetailCustomersChunk(list: ImportCustomer[]): Promise<Result<{ created: number; updated: number; errors: string[] }>> {
  const g = await guard()
  if ('error' in g) return { ok: false, error: g.error }
  if (!Array.isArray(list) || list.length > 50) return { ok: false, error: 'Lote inválido.' }
  const db = await createScopedAdmin(g.tenantId)
  let created = 0, updated = 0
  const errors: string[] = []
  for (const c of list) {
    const r = customerRow(c)
    if (!r.ok) { errors.push(`${c.name ?? '?'}: ${r.error}`); continue }
    const legacy = {
      legacy_last_purchase_at: parseDate(c.legacy_last_purchase_at),
      legacy_total: parseMoney(c.legacy_total),
      legacy_orders: parseStock(c.legacy_orders),
    }
    const optin = c.whatsapp_optin === true ? { whatsapp_optin: true, optin_at: new Date().toISOString() } : {}
    const existing = r.row.phone ? (await db.from('retail_customers').select('id').eq('phone', r.row.phone as string).maybeSingle()).data : null
    if (existing) {
      const patch = Object.fromEntries(Object.entries({ ...r.row, ...legacy }).filter(([, v]) => v !== null && v !== undefined))
      const { error } = await db.from('retail_customers').update({ ...patch, ...optin }).eq('id', existing.id)
      if (error) errors.push(`${c.name}: ${error.message}`); else updated++
    } else {
      const { error } = await db.from('retail_customers').insert({ ...r.row, ...legacy, ...optin, source: 'planilha' })
      if (error) errors.push(`${c.name}: ${error.code === '23505' ? 'telefone já cadastrado' : error.message}`); else created++
    }
  }
  revalidatePath('/varejo/clientes')
  return { ok: true, created, updated, errors: errors.slice(0, 30) }
}
