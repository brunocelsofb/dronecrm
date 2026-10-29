'use client'

// Erro numa tela do sistema: mostra a mensagem (nunca a tela em branco) e se recupera
import { RecoverError } from '@/components/layout/recover-error'

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RecoverError error={error} reset={reset} />
}
