// Instâncias "privadas" da Evolution API
//
// Uma instância privada é usada só para ENVIAR (ex.: briefing gerencial no
// WhatsApp pessoal do gestor). O CRM nunca lê, lista, importa nem grava nada
// vindo dela, mesmo que um webhook seja ativado por engano.
//
// Configuração (Vercel → Environment Variables):
//   EVOLUTION_PRIVATE_INSTANCES = "bruno_gerencial"          (uma)
//   EVOLUTION_PRIVATE_INSTANCES = "bruno_gerencial,outra"    (várias, separadas por vírgula)
//
// Para tornar uma instância "pública" de novo: tire o nome da variável,
// faça redeploy e use "sincronizar webhooks" nas Conexões WhatsApp do CRM.
// Mensagens anteriores não entram retroativamente.

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

export function getPrivateInstances(): Set<string> {
  const raw = process.env.EVOLUTION_PRIVATE_INSTANCES ?? ''
  return new Set(raw.split(',').map(normalize).filter(Boolean))
}

export function isPrivateInstance(name: string | null | undefined): boolean {
  if (!name) return false
  return getPrivateInstances().has(normalize(name))
}

export const PRIVATE_INSTANCE_ERROR = 'Instância reservada (privada) — não disponível no CRM'
