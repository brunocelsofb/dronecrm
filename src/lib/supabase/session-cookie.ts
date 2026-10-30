// Login do Drone vale só enquanto o navegador estiver aberto: os cookies de sessão do
// Supabase são gravados SEM validade (maxAge/expires), então o navegador os apaga ao fechar
// e é preciso entrar de novo. Exclusão de cookie (maxAge 0) passa como veio.
// Sem imports, para poder testar.
type Opts = { maxAge?: number; expires?: Date; [k: string]: unknown } | undefined

export function sessionOnly<T extends Opts>(options: T): T {
  if (!options) return options
  if (options.maxAge === 0 || (options.expires instanceof Date && options.expires.getTime() <= Date.now())) return options
  const rest = { ...options }
  delete rest.maxAge
  delete rest.expires
  return rest as T
}
