// ─── Exportação completa dos dados de uma empresa ─────────────────────────────
// Um .zip com um CSV por tabela da empresa (TENANT_TABLES), para a empresa levar
// seus dados ao encerrar o contrato (LGPD: portabilidade) ou guardar uma cópia.
// Vale para qualquer empresa. Ficam de fora: chaves, senhas e tokens (de
// integrações e de links públicos), a coluna tenant_id e tabelas internas.
// Mensagens criptografadas saem decifradas (o cliente admin decifra sozinho).

import { strToU8, zipSync } from 'fflate'
import { TENANT_TABLES } from './scoped-admin'
import { cashbackBalance, type CashbackEntry } from '@/lib/retail/margin'
import type { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

// Tabelas internas da plataforma, sem valor para a empresa
const SKIP_TABLES = new Set(['storage_legacy_objects'])

// Colunas que nunca saem: segredo de integração, senha, token de link público, chave
const SECRET_COLUMN = /(^|_)(token|secret|password|passwd|api_?key|signing_key|private_key)(_|$)|_enc$|^key$/i
const DROP_COLUMNS: Record<string, Set<string>> = {
  profiles: new Set(['impersonating_tenant_id']),
}

// Remove chaves com cara de segredo dentro de JSON (configurações de integração)
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!SECRET_COLUMN.test(k)) out[k] = scrub(val)
    return out
  }
  return v
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(scrub(v)) : String(v)
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// CSV com separador ";" e BOM: abre direto no Excel em português com acentos certos
export function toCsv(rows: Record<string, unknown>[], table: string): string {
  const drop = DROP_COLUMNS[table]
  const cols: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) {
    if (k === 'tenant_id' || SECRET_COLUMN.test(k) || drop?.has(k) || cols.includes(k)) continue
    cols.push(k)
  }
  const lines = [cols.join(';'), ...rows.map(r => cols.map(c => cell(r[c])).join(';'))]
  return `﻿${lines.join('\r\n')}\r\n`
}

const PAGE = 1000

async function readAll(db: Db, table: string, tenantId: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let ordered = true
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = db.from(table).select('*').eq('tenant_id', tenantId)
    if (ordered) q = q.order('id', { ascending: true })
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) {
      // Tabela sem coluna id: lê sem ordenar (são tabelas pequenas de ligação)
      if (ordered && from === 0) { ordered = false; from -= PAGE; continue }
      throw new Error(`${table}: ${error.message}`)
    }
    rows.push(...((data ?? []) as Record<string, unknown>[]))
    if (!data || data.length < PAGE) return rows
  }
}

export type TenantExport = { zip: Uint8Array; counts: Record<string, number>; failed: string[] }

export async function buildTenantExport(db: Db, tenantId: string, meta: { companyName: string; by: string }): Promise<TenantExport> {
  const tables = [...TENANT_TABLES].filter(t => !SKIP_TABLES.has(t)).sort()
  const counts: Record<string, number> = {}
  const failed: string[] = []
  const files: Record<string, Uint8Array> = {}
  const keep: Record<string, Record<string, unknown>[]> = {}

  // Poucas tabelas por vez para não estourar conexões
  for (let i = 0; i < tables.length; i += 6) {
    await Promise.all(tables.slice(i, i + 6).map(async t => {
      try {
        const rows = await readAll(db, t, tenantId)
        counts[t] = rows.length
        if (t === 'retail_loyalty_entries' || t === 'retail_customers') keep[t] = rows
        if (rows.length) files[`dados/${t}.csv`] = strToU8(toCsv(rows, t))
      } catch (e) {
        console.error('[export]', e)
        failed.push(t)
      }
    }))
  }

  // Varejo: saldo de cashback de cada cliente hoje (para a empresa honrar ao sair do sistema)
  const entries = keep.retail_loyalty_entries ?? []
  if (entries.length) {
    const byCustomer = new Map<string, CashbackEntry[]>()
    for (const e of entries) {
      const list = byCustomer.get(e.customer_id as string) ?? []
      list.push({ kind: e.kind as 'credito' | 'uso', amount: Number(e.amount), at: e.created_at as string, expires_at: e.expires_at as string | null })
      byCustomer.set(e.customer_id as string, list)
    }
    const customers = new Map((keep.retail_customers ?? []).map(c => [c.id as string, c]))
    const rows = [...byCustomer.entries()].map(([id, list]) => {
      const b = cashbackBalance(list)
      const c = customers.get(id)
      return { cliente: c?.name ?? id, telefone: c?.phone ?? '', saldo: b.balance.toFixed(2).replace('.', ','), proximo_vencimento: b.nextExpiry ? b.nextExpiry.slice(0, 10) : '', valor_que_vence: b.expiringAmount.toFixed(2).replace('.', ',') }
    }).filter(r => r.saldo !== '0,00')
    if (rows.length) files['dados/saldos_cashback.csv'] = strToU8(toCsv(rows, 'saldos_cashback'))
  }

  const when = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const readme = [
    `Exportação de dados — ${meta.companyName}`,
    `Gerada em ${when} (horário de Brasília) por ${meta.by}.`,
    '',
    'Conteúdo: uma planilha CSV por tabela, na pasta "dados" (separador ponto e vírgula, UTF-8).',
    'Abra no Excel, Google Planilhas ou LibreOffice. As colunas "id" e "..._id" ligam uma tabela à outra.',
    'Mensagens de WhatsApp e conversas da assistente saem já decifradas.',
    'Varejo: saldos_cashback.csv traz o crédito de cada cliente hoje. Fotos das peças: botão próprio na mesma tela.',
    '',
    'Não incluído (por segurança): chaves, senhas e tokens de integrações (WhatsApp, e-mail, ZapSign,',
    'IA) e os tokens dos links públicos (propostas, pesquisas, chamados). Arquivos anexados (PDFs,',
    'imagens) não vão no .zip: o caminho de cada um está nas tabelas de arquivos.',
    '',
    'Tabelas e quantidade de linhas:',
    ...tables.map(t => `  ${t}: ${failed.includes(t) ? 'ERRO ao ler — gere a exportação de novo' : counts[t] ?? 0}`),
    '',
    'Este arquivo tem dados pessoais. Guarde em local seguro (LGPD).',
  ].join('\r\n')
  files['LEIA-ME.txt'] = strToU8(`﻿${readme}\r\n`)

  return { zip: zipSync(files, { level: 6 }), counts, failed }
}
