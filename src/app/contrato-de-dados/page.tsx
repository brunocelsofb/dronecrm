import { DpaDocument } from '@/components/legal/dpa-document'
import { OPERATOR } from '@/lib/legal/dpa'

export const metadata = {
  title: 'Contrato de Tratamento de Dados — Comercial Drone',
  description: 'O que a plataforma acessa e para quê: contrato de tratamento de dados pessoais com cada empresa cliente (LGPD).',
}

// Versão pública (genérica). Cada empresa aceita a sua em Configurações → Privacidade e dados.
export default function DpaPublicPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <DpaDocument controller={{ name: null, cnpj: null }} />
        <p className="mt-10 border-t border-gray-200 pt-4 text-center text-xs text-gray-400">
          {OPERATOR.name} · {OPERATOR.product} · {OPERATOR.site} · <a href="/privacy" className="underline">Política de Privacidade</a>
        </p>
      </div>
    </main>
  )
}
