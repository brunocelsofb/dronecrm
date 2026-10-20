'use server'

// Arquivos da empresa (nem tudo vira oportunidade): ficam no bucket dos contratos,
// na pasta companies/<empresa>/, e o registro é da empresa (tenant).

import { revalidatePath } from 'next/cache'
import { getUserAccess } from '@/lib/auth/access'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createAdminClient } from '@/lib/supabase/admin'

type Res = { ok: true } | { ok: false; error: string }

export async function registerCompanyFile(companyId: string, input: { name: string; path: string; size: number; type: string; description?: string }): Promise<Res> {
  const me = await getUserAccess()
  if (!me) return { ok: false, error: 'Usuário não autenticado.' }
  const db = await createScopedAdmin()
  const { data: c } = await db.from('companies').select('id').eq('id', companyId).maybeSingle()
  if (!c) return { ok: false, error: 'Empresa não encontrada.' }
  if (!input.path.startsWith(`companies/${companyId}/`)) return { ok: false, error: 'Caminho do arquivo inválido.' }
  const { error } = await db.from('company_files').insert({
    company_id: companyId, storage_path: input.path, file_name: input.name.slice(0, 250), file_size: input.size || null,
    mime_type: input.type || null, description: (input.description ?? '').trim().slice(0, 300) || null, uploaded_by: me.userId,
  })
  if (error) return { ok: false, error: error.message }
  await db.from('activities').insert({ company_id: companyId, user_id: me.userId, type: 'file', content: `📎 Arquivo anexado na empresa: ${input.name}` })
  revalidatePath(`/companies/${companyId}`)
  return { ok: true }
}

// Link temporário (1 h) — só para arquivo desta empresa (tenant)
export async function companyFileUrl(fileId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const db = await createScopedAdmin()
  const { data: f } = await db.from('company_files').select('storage_path').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: 'Arquivo não encontrado.' }
  const { data, error } = await createAdminClient().storage.from('contract-files').createSignedUrl(f.storage_path as string, 3600)
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao gerar link.' }
  return { ok: true, url: data.signedUrl }
}

// Arquivo de uma oportunidade da empresa (aba Arquivos da empresa mostra os dois)
export async function contractFileUrl(fileId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const db = await createScopedAdmin()
  const { data: f } = await db.from('contract_files').select('storage_path').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: 'Arquivo não encontrado.' }
  const { data, error } = await createAdminClient().storage.from('contract-files').createSignedUrl(f.storage_path as string, 3600)
  if (error || !data) return { ok: false, error: error?.message ?? 'Falha ao gerar link.' }
  return { ok: true, url: data.signedUrl }
}

export async function deleteCompanyFile(fileId: string): Promise<Res> {
  const me = await getUserAccess()
  if (!me?.isAdmin) return { ok: false, error: 'Só administradores excluem arquivos.' }
  const db = await createScopedAdmin()
  const { data: f } = await db.from('company_files').select('id, company_id, storage_path, file_name').eq('id', fileId).maybeSingle()
  if (!f) return { ok: false, error: 'Arquivo não encontrado.' }
  await createAdminClient().storage.from('contract-files').remove([f.storage_path as string])
  const { error } = await db.from('company_files').delete().eq('id', fileId)
  if (error) return { ok: false, error: error.message }
  await db.from('activities').insert({ company_id: f.company_id, user_id: me.userId, type: 'file', content: `🗑️ Arquivo removido da empresa: ${f.file_name}` })
  revalidatePath(`/companies/${f.company_id}`)
  return { ok: true }
}
