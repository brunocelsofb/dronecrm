// Privacidade por empresa (organization_settings.privacy_settings).
// Sem 'use server': usado no servidor e na tela.

export type PrivacySettings = {
  whatsapp_retention_days: number | null   // null = guardar enquanto durar o contrato
}

export const RETENTION_OPTIONS = [30, 60, 90, 180, 365, 730] as const
export const DEFAULT_PRIVACY: PrivacySettings = { whatsapp_retention_days: null }

export function resolvePrivacySettings(raw: unknown): PrivacySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = Math.round(Number(r.whatsapp_retention_days))
  return { whatsapp_retention_days: Number.isFinite(d) && d >= 7 && d <= 3650 ? d : null }
}
