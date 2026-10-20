'use server'

// Importação de empresas em massa (CSV) — grava na empresa (tenant) de quem importa.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { STATUS_VALUES, EXAMPLE_MARK, normalizeHeader } from '@/lib/companies/import-template'
import { lookupCnpj, type CnpjData } from '@/lib/actions/cnpj-lookup'
import { getCompanySettings } from '@/lib/actions/company-settings'
import { matchSegment, segmentValue } from '@/lib/companies/settings'

export type ImportRow = Record<string, string>   // chave do modelo → valor

export type ImportResult = {
  imported: number
  skipped: number
  contacts: number
  looked_up: number      // linhas completadas pela consulta do CNPJ
  errors: string[]
}

// Consulta à Receita (BrasilAPI) só para linhas sem razão social ou fantasia.
// Limite por arquivo e poucas consultas ao mesmo tempo, para não estourar o
// tempo da requisição nem o limite do serviço público.
const MAX_LOOKUPS = 150
const LOOKUP_CONCURRENCY = 4

const isExampleRow = (r: ImportRow) => [r.razao_social, r.cnpj].some(v => (v ?? '').trim().toUpperCase().startsWith(EXAMPLE_MARK))

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function phoneDigits(v: string): string | null {
  const d = v.replace(/\D/g, '')
  if (!d) return null
  return d.length === 10 || d.length === 11 ? `55${d}` : d
}

export async function bulkImportCompanies(rows: ImportRow[]): Promise<ImportResult> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  const empty = (e: string): ImportResult => ({ imported: 0, skipped: 0, contacts: 0, looked_up: 0, errors: [e] })
  if (!user) return empty('Usuário não autenticado.')

  const errors: string[] = []
  // A linha do arquivo = posição + 2 (cabeçalho é a linha 1)
  const candidates = rows.map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !isExampleRow(r) && Object.values(r).some(v => (v ?? '').trim()))
  const valid: { r: ImportRow; line: number; cnpj: string }[] = []
  for (const c of candidates) {
    const cnpj = (c.r.cnpj ?? '').replace(/\D/g, '')
    if (cnpj.length !== 14) {
      errors.push(`Linha ${c.line}${c.r.razao_social ? ` (${c.r.razao_social})` : ''}: ${cnpj ? `CNPJ "${c.r.cnpj}" não tem 14 dígitos` : 'sem CNPJ'} — não importada (CNPJ é obrigatório).`)
      continue
    }
    valid.push({ ...c, cnpj })
  }
  if (valid.length === 0) return { ...empty('Nenhuma linha com CNPJ válido encontrada.'), errors: errors.length ? errors : ['Nenhuma linha com CNPJ válido encontrada.'] }
  if (valid.length > 2000) return empty('Máximo de 2.000 empresas por arquivo. Divida em partes.')

  const admin = await createScopedAdmin()
  const { segments } = await getCompanySettings()

  // Duplicados por CNPJ: na base da empresa e dentro do próprio arquivo
  const cnpjs = [...new Set(valid.map(v => v.cnpj))]
  const { data: existing } = cnpjs.length
    ? await admin.from('companies').select('cnpj').in('cnpj', cnpjs)
    : { data: [] as { cnpj: string | null }[] }
  const seen = new Set((existing ?? []).map(c => (c.cnpj ?? '').replace(/\D/g, '')))

  // Completa razão social / fantasia pelo CNPJ (só onde falta e não está duplicado)
  const needLookup = [...new Set(valid.filter(v => !seen.has(v.cnpj) && (!v.r.razao_social?.trim() || !v.r.nome_fantasia?.trim())).map(v => v.cnpj))]
  const lookedUp = new Map<string, CnpjData>()
  const toLook = needLookup.slice(0, MAX_LOOKUPS)
  for (let i = 0; i < toLook.length; i += LOOKUP_CONCURRENCY) {
    const batch = toLook.slice(i, i + LOOKUP_CONCURRENCY)
    const res = await Promise.all(batch.map(c => lookupCnpj(c)))
    res.forEach((r, j) => { if (r.success) lookedUp.set(batch[j], r) })
  }
  const overCap = new Set(needLookup.slice(MAX_LOOKUPS))

  let imported = 0, skipped = 0, contacts = 0, looked = 0
  const noSegment: number[] = []
  for (const { r, line, cnpj } of valid) {
    const cnpjOk = cnpj
    if (seen.has(cnpjOk)) { skipped++; continue }

    const found = lookedUp.get(cnpj)
    const razao = r.razao_social?.trim() || found?.razaoSocial?.trim() || ''
    if (!razao) {
      errors.push(`Linha ${line}: CNPJ ${r.cnpj} sem razão social ${overCap.has(cnpj) ? `(passou do limite de ${MAX_LOOKUPS} consultas por arquivo — importe o restante em outro arquivo)` : '(não encontrado na consulta do CNPJ)'} — não importada.`)
      continue
    }
    if (found && (!r.razao_social?.trim() || !r.nome_fantasia?.trim())) looked++

    const segText = r.segmento?.trim()
    const segment = matchSegment(segText, segments)
    if (segText && !segment) errors.push(`Linha ${line} (${razao}): segmento "${segText}" não está cadastrado — importada sem segmento.`)
    else if (!segText) noSegment.push(line)

    const statusKey = normalizeHeader(r.status ?? '')
    const status = statusKey ? STATUS_VALUES[statusKey] : 'lead'
    if (statusKey && !status) errors.push(`Linha ${line}: status "${r.status}" desconhecido — usado "lead".`)
    const email = (r.email ?? '').trim()
    const uf = (r.uf ?? '').trim().toUpperCase().slice(0, 2) || null

    const { data: company, error } = await admin.from('companies').insert({
      name: razao,
      trade_name: r.nome_fantasia?.trim() || found?.nomeFantasia?.trim() || null,
      cnpj: cnpjOk,
      status: status || 'lead',
      segment: segmentValue(segment),
      phone: r.telefone?.trim() || found?.telefone || null,
      email: email && EMAIL_RE.test(email) ? email : (found?.email || null),
      zip_code: (r.cep ?? '').replace(/\D/g, '') || found?.cep?.replace(/\D/g, '') || null,
      street: r.logradouro?.trim() || found?.logradouro || null,
      street_number: r.numero?.trim() || found?.numero || null,
      neighborhood: r.bairro?.trim() || found?.bairro || null,
      city: r.cidade?.trim() || found?.municipio || null,
      state: uf || found?.uf || null,
      notes: r.observacoes?.trim() || null,
      owner_id: user.id,
    }).select('id').single()
    if (error || !company) { errors.push(`Linha ${line} (${razao}): ${error?.message ?? 'falha ao gravar'}`); continue }
    imported++
    seen.add(cnpjOk)

    // Contato principal (opcional)
    const contactName = r.contato_nome?.trim()
    if (contactName) {
      const cEmail = (r.contato_email ?? '').trim()
      const { error: cErr } = await admin.from('contacts').insert({
        company_id: company.id,
        name: contactName,
        role: r.contato_cargo?.trim() || null,
        cargo: r.contato_cargo?.trim() || null,
        email: cEmail && EMAIL_RE.test(cEmail) ? cEmail : null,
        phone: phoneDigits(r.contato_telefone ?? ''),
        is_primary: true,
      })
      if (cErr) errors.push(`Linha ${line}: empresa importada, mas o contato falhou (${cErr.message}).`)
      else contacts++
    }
  }

  if (noSegment.length) errors.push(`${noSegment.length} empresa(s) sem segmento (linhas ${noSegment.slice(0, 30).join(', ')}${noSegment.length > 30 ? '…' : ''}) — complete em Editar empresa.`)
  revalidatePath('/companies')
  return { imported, skipped, contacts, looked_up: looked, errors }
}
