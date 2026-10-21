// O Supabase Storage rejeita certas chaves (caminhos) de arquivo — em
// especial acentos, espaços e alguns símbolos. O NOME de exibição (que
// o usuário vê e baixa) pode continuar sendo qualquer coisa, guardado
// à parte no banco — isso aqui só sanitiza o CAMINHO usado internamente.
export function sanitizeStorageFileName(fileName: string): string {
  const normalized = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos (ã → a, é → e, etc.)

  return normalized
    .replace(/[^a-zA-Z0-9._-]/g, '_') // troca qualquer coisa fora do seguro por _
    .replace(/_+/g, '_') // colapsa múltiplos _ seguidos
}

// ─── Pasta da empresa nos buckets contract-files / proposal-files ───────────────
// Todo arquivo novo fica em "<tenant_id>/...". O banco (políticas do Storage) só
// deixa a pessoa ver, enviar e apagar arquivos da pasta da própria empresa.
// O id vem de contract_crm.current_tenant_id() — a mesma função das políticas.
type RpcClient = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
let tenantPrefixCache: Promise<string> | null = null

export async function tenantStoragePath(supabase: RpcClient, relativePath: string): Promise<string> {
  tenantPrefixCache ??= Promise.resolve(supabase.rpc('current_tenant_id')).then(({ data, error }) => {
    if (error || typeof data !== 'string' || !data) {
      tenantPrefixCache = null
      throw new Error('Não foi possível identificar a empresa para salvar o arquivo.')
    }
    return data
  })
  return `${await tenantPrefixCache}/${relativePath.replace(/^\/+/, '')}`
}

// Para o servidor, quando a empresa já é conhecida
export function tenantStoragePathFor(tenantId: string, relativePath: string): string {
  return `${tenantId}/${relativePath.replace(/^\/+/, '')}`
}
