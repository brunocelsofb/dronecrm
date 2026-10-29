'use client'

// Erro antes de o layout carregar (ex.: arquivo de versão antiga logo depois de uma publicação)
import { RecoverError } from '@/components/layout/recover-error'
import './globals.css'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-gray-50">
        <RecoverError error={error} reset={reset} />
      </body>
    </html>
  )
}
