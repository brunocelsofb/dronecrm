// Cadastro completo de uma pessoa (login): nome e sobrenome, telefone, área de trabalho e e-mail.
// Obrigatório ao criar login e para quem envia mensagens automáticas dos agentes. Regras puras.
export type ProfileLike = { full_name?: string | null; phone?: string | null; department?: string | null; email?: string | null }

export const cleanPhoneBR = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export function profileProblems(p: ProfileLike): string[] {
  const out: string[] = []
  const name = String(p.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  if (name.length < 2) out.push('nome e sobrenome')
  const phone = cleanPhoneBR(p.phone)
  if (phone.length < 10 || phone.length > 13) out.push('telefone com DDD')
  if (!String(p.department ?? '').trim()) out.push('área de trabalho')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.email ?? '').trim())) out.push('e-mail')
  return out
}

export const isProfileComplete = (p: ProfileLike) => profileProblems(p).length === 0
