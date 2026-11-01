// Telas que se abrem a partir de Configurações: todas mostram "← Configurações"
// no topo (PageFrame). Prefixos de endereço; /settings sozinho não entra.
const SETTINGS_CHILD_PREFIXES = [
  '/settings/', '/users', '/minha-conta', '/pipelines', '/custom-fields', '/tags', '/automations',
  '/proposals/templates', '/proposals/catalog', '/email-templates', '/zapsign',
]

export function isSettingsChild(pathname: string): boolean {
  return SETTINGS_CHILD_PREFIXES.some(p => p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`))
}

// Marcador só do menu (não é aba de plano): o layout acrescenta para administradores,
// para a tela "IA da empresa" aparecer no grupo IA do menu
export const IA_ADMIN_FEATURE = 'ia-admin'
