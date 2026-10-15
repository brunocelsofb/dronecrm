'use server'

// Importação de empresas em massa (CSV) — grava na empresa (tenant) de quem importa.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { STATUS_VALUES, EXAMPLE_MARK, normalizeHeader } from '@/lib/companies/import-template'

export type ImportRow = Record<string, string>   // chave do modelo → valor

export type ImportResult = {
  imported: number
  skipped: number
  contacts: number
  errors: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function phoneDigits(v: string): string | null {
  const d = v.replace(/\D/g, '')
  if (!d) return null
  return d.length === 10 || d.length === 11 ? `55${d}` : d
}

export async function bulkImportCompanies(rows: ImportRow[]): Promise<ImportResult> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { imported: 0, skipped: 0, contacts: 0, errors: ['Usuário não autenticado.'] }

  const valid = rows.filter(r => r.razao_social?.trim() && !r.razao_social.trim().toUpperCase().startsWith(EXAMPLE_MARK))
  if (valid.length === 0) return { imported: 0, skipped: 0, contacts: 0, errors: ['Nenhuma linha com razão social encontrada.'] }
  if (valid.length > 2000) return { imported: 0, skipped: 0, contacts: 0, errors: ['Máximo de 2.000 empresas por arquivo. Divida em partes.'] }

  const admin = await createScopedAdmin()
  const errors: string[] = []

  // Duplicados por CNPJ: na base da empresa e dentro do próprio arquivo
  const cnpjs = [...new Set(valid.map(r => (r.cnpj ?? '').replace(/\D/g, '')).filter(Boolean))]
  const { data: existing } = cnpjs.length
    ? await admin.from('companies').select('cnpj').in('cnpj', cnpjs)
    : { data: [] as { cnpj: string | null }[] }
  const seen = new Set((existing ?? []).map(c => c.cnpj))

  let imported = 0, skipped = 0, contacts = 0
  for (const [i, r] of valid.entries()) {
    const line = i + 2
    const cnpj = (r.cnpj ?? '').replace(/\D/g, '') || null
    if (cnpj && cnpj.length !== 14) { errors.push(`Linha ${line}: CNPJ "${r.cnpj}" não tem 14 dígitos — importada sem CNPJ.`) }
    const cnpjOk = cnpj && cnpj.length === 14 ? cnpj : null
    if (cnpjOk && seen.has(cnpjOk)) { skipped++; continue }

    const statusKey = normalizeHeader(r.status ?? '')
    const status = statusKey ? STATUS_VALUES[statusKey] : 'lead'
    if (statusKey && !status) errors.push(`Linha ${line}: status "${r.status}" desconhecido — usado "lead".`)
    const email = (r.email ?? '').trim()
    const uf = (r.uf ?? '').trim().toUpperCase().slice(0, 2) || null

    const { data: company, error } = await admin.from('companies').insert({
      name: r.razao_social.trim(),
      trade_name: r.nome_fantasia?.trim() || null,
      cnpj: cnpjOk,
      status: status || 'lead',
      segment: r.segmento?.trim() || null,
      phone: r.telefone?.trim() || null,
      email: email && EMAIL_RE.test(email) ? email : null,
      zip_code: (r.cep ?? '').replace(/\D/g, '') || null,
      street: r.logradouro?.trim() || null,
      street_number: r.numero?.trim() || null,
      neighborhood: r.bairro?.trim() || null,
      city: r.cidade?.trim() || null,
      state: uf,
      notes: r.observacoes?.trim() || null,
      owner_id: user.id,
    }).select('id').single()
    if (error || !company) { errors.push(`Linha ${line} (${r.razao_social}): ${error?.message ?? 'falha ao gravar'}`); continue }
    imported++
    if (cnpjOk) seen.add(cnpjOk)

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

  revalidatePath('/companies')
  return { imported, skipped, contacts, errors }
}
