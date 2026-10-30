// Regras de senha do Drone (sem imports, para poder testar)
export const PASSWORD_MIN = 8
export function passwordProblem(pw: string, opts: { current?: string; email?: string } = {}): string | null {
  const p = String(pw ?? '')
  if (p.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`
  if (p.length > 72) return 'A senha pode ter no máximo 72 caracteres.'
  if (!/[A-Za-zÀ-ÿ]/.test(p) || !/\d/.test(p)) return 'Use letras e números na senha.'
  if (opts.current && p === opts.current) return 'A nova senha precisa ser diferente da atual.'
  const user = (opts.email ?? '').split('@')[0]?.split('+')[0]?.toLowerCase()
  if (user && user.length >= 4 && p.toLowerCase().includes(user)) return 'A senha não pode conter o seu e-mail.'
  return null
}
