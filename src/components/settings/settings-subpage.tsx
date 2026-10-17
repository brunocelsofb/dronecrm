// Cabeçalho padrão das telas de Configurações: título e explicação.
// O "← Configurações" aparece sozinho em toda tela de configuração (PageFrame).

export function SettingsSubpage({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
      </div>
      {children}
    </div>
  )
}
