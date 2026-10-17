'use server'

// Importar lista de prospecção (planilha) como leads outbound do comercial.
// 1) parseLeadFile: lê a planilha (Excel ou CSV) e devolve as linhas já
//    entendidas (nome, e-mail, telefone, empresa, CNPJ, observação).
// 2) importLeadsChunk: grava em lotes pequenos (a tela chama até terminar).
// Mesmo e-mail com lead aberto não duplica.

import * as XLSX from 'xlsx'
import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { parseGeneric } from '@/lib/leads/parse'
import { ingestLead } from '@/lib/leads/ingest'

export type ImportRow = { name: string | null; email: string | null; phone: string | null; company_name: string | null; cnpj: string | null; message: string | null }
const MAX_ROWS = 2000
const MAX_BYTES = 950 * 1024 // limite de envio das ações do servidor (1 MB)

export async function parseLeadFile(formData: FormData): Promise<{ ok: true; rows: ImportRow[]; ignored: number; columns: string[] } | { ok: false; error: string }> {
  const me = await getUserAccess()
  if (!me || !me.features.includes('leads')) return { ok: false, error: 'Sem acesso à aba Leads.' }
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Escolha a planilha.' }
  if (file.size > MAX_BYTES) return { ok: false, error: 'Planilha maior que 950 KB. Apague colunas que não são usadas ou divida em partes.' }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return { ok: false, error: 'Use Excel (.xlsx/.xls) ou CSV.' }
  let records: Record<string, unknown>[]
  try {
    const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
  } catch {
    return { ok: false, error: 'Não foi possível ler a planilha.' }
  }
  if (!records.length) return { ok: false, error: 'A planilha está vazia (a primeira linha deve ter os títulos das colunas).' }
  if (records.length > MAX_ROWS) return { ok: false, error: `Máximo de ${MAX_ROWS} linhas por importação. Divida a planilha.` }
  const rows: ImportRow[] = []
  let ignored = 0
  for (const rec of records) {
    const p = parseGeneric(rec)
    if (!p.name && !p.email && !p.phone) { ignored++; continue }
    rows.push({ name: p.name, email: p.email, phone: p.phone, company_name: p.company_name, cnpj: p.cnpj, message: p.message })
  }
  return { ok: true, rows, ignored, columns: Object.keys(records[0] ?? {}) }
}

export async function importLeadsChunk(rows: ImportRow[]): Promise<{ ok: true; created: number; duplicates: number; errors: string[] } | { ok: false; error: string }> {
  const me = await getUserAccess()
  if (!me || !me.features.includes('leads')) return { ok: false, error: 'Sem acesso à aba Leads.' }
  if (!Array.isArray(rows) || rows.length > 25) return { ok: false, error: 'Lote inválido.' }
  const tenantId = await resolveTenantId()
  let created = 0, duplicates = 0
  const errors: string[] = []
  for (const r of rows) {
    const s = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
    const email = s(r.email, 200)?.toLowerCase() ?? null
    const phone = s(r.phone, 40)
    const name = s(r.name) ?? (email ? email.split('@')[0] : null) ?? phone
    if (!name) continue
    const res = await ingestLead({
      tenantId, name, email, phone, company_name: s(r.company_name), cnpj: s(r.cnpj, 30), message: s(r.message, 2000),
      source: 'prospeccao', tracking: {}, conversion: 'Importação de planilha', dedupe: true,
      entryType: 'outbound', handedOffBy: me.userId, assignedTo: me.userId,
    })
    if (res.error) { if (errors.length < 5) errors.push(`${name}: ${res.error}`) }
    else if (res.duplicate) duplicates++
    else created++
  }
  revalidatePath('/leads')
  return { ok: true, created, duplicates, errors }
}
