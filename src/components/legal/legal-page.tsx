// Página pública de texto legal (privacidade, termos, exclusão de dados)
import { OPERATOR } from '@/lib/legal/dpa'

export type LegalSection = { title: string; body: (string | { list: string[] })[] }

export function LegalPage({ title, updated, intro, sections, children }: { title: string; updated: string; intro?: string; sections: LegalSection[]; children?: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white px-4 py-16">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">{title}</h1>
        <p className="mb-8 text-sm text-gray-500">Última atualização: {updated}</p>
        {intro && <p className="mb-8 leading-relaxed text-gray-700">{intro}</p>}
        {children}
        {sections.map(s => (
          <section key={s.title} className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-gray-800">{s.title}</h2>
            {s.body.map((b, i) => typeof b === 'string'
              ? <p key={i} className="mb-3 leading-relaxed text-gray-600">{b}</p>
              : <ul key={i} className="mb-3 list-disc space-y-2 pl-6 text-gray-600">{b.list.map(li => <li key={li}>{li}</li>)}</ul>)}
          </section>
        ))}
        <hr className="mb-6 mt-12 border-gray-200" />
        <p className="text-center text-xs text-gray-400">
          {OPERATOR.name}{OPERATOR.cnpj ? ` · CNPJ ${OPERATOR.cnpj}` : ''} · {OPERATOR.product} · {OPERATOR.site} ·{' '}
          <a href="/privacy" className="underline">Privacidade</a> · <a href="/terms" className="underline">Termos</a> · <a href="/exclusao-de-dados" className="underline">Exclusão de dados</a> · <a href="/contrato-de-dados" className="underline">Contrato de tratamento de dados</a>
        </p>
      </div>
    </main>
  )
}
