/**
 * Configurações — cada assunto no seu quadro. Os formulários que antes ficavam
 * soltos no fim desta tela agora têm tela própria (Dados da empresa, Numeração
 * de chamados e propostas, Recebimento de e-mail, ZapSign, Assistente Théo e
 * Zona de risco). Textos neutros: valem para qualquer empresa.
 */

import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/role'
import { SettingsBoxes } from '@/components/settings/settings-boxes'

export default async function SettingsPage() {
  const profile = await getCurrentProfile()
  if (profile?.role !== 'admin') redirect('/')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Configurações</h1>
        <p className="mt-0.5 text-sm text-gray-500">Tudo o que é da sua empresa, organizado por assunto.</p>
      </div>
      <SettingsBoxes />
    </div>
  )
}
