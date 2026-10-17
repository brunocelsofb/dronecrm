// Cabeçalho padrão das telas de Configurações: voltar, título e explicação.
import Link from 'next/link'

export function SettingsSubpage({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/settings" className="text-xs text-gray-500 hover:underline">← Configurações</Link>
        <h1 className="mt-1 text-lg font-semibold text-gray-900">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
      </div>
      {children}
    </div>
  )
}
