// Instâncias "privadas" da Evolution API
//
// Uma instância privada é usada só para ENVIAR (ex.: briefing gerencial no
// WhatsApp pessoal do gestor). O CRM nunca lê, lista, importa nem grava nada
// vindo dela, mesmo que um webhook seja ativado por engano.
//
// Onde fica a marcação: organization_settings.evo_instance_aliases[nome].private = true
// Como mudar: Configurações → Conexões → chave "Instância privada" de cada instância,
// ou a caixa "Instância privada" ao conectar uma nova pelo QR Code.

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'

type AliasValue = string | { label?: string; bot_enabled?: boolean; private?: boolean }

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

export async function getPrivateInstances(tenantId?: string): Promise<Set<string>> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('organization_settings')
      .select('evo_instance_aliases')
      .eq('tenant_id', tenantId ?? await resolveTenantId())
      .maybeSingle()
    if (error) throw error

    const aliases = (data?.evo_instance_aliases ?? {}) as Record<string, AliasValue>
    const names = Object.entries(aliases)
      .filter(([, v]) => typeof v === 'object' && v !== null && v.private === true)
      .map(([k]) => normalize(k))
    return new Set(names)
  } catch (err) {
    console.error('[private-instances] erro ao ler instâncias privadas:', err)
    return new Set()
  }
}

export async function isPrivateInstance(name: string | null | undefined, tenantId?: string): Promise<boolean> {
  if (!name) return false
  return (await getPrivateInstances(tenantId)).has(normalize(name))
}

export const PRIVATE_INSTANCE_ERROR = 'Instância reservada (privada) — não disponível no CRM'
