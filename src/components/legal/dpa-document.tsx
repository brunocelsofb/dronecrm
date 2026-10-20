// Texto do Contrato de Tratamento de Dados (sem estado: serve a página pública e a de Configurações)
import { buildDpa, DPA_UPDATED_AT, DPA_VERSION, type DpaParty } from '@/lib/legal/dpa'

export function DpaDocument({ controller }: { controller: DpaParty }) {
  const sections = buildDpa(controller)
  return (
    <article className="space-y-5 text-sm leading-relaxed text-gray-700">
      <header>
        <h2 className="text-base font-semibold text-gray-900">Contrato de Tratamento de Dados Pessoais</h2>
        <p className="text-xs text-gray-500">Versão {DPA_VERSION} · atualizado em {new Date(`${DPA_UPDATED_AT}T12:00:00`).toLocaleDateString('pt-BR')}</p>
      </header>
      {sections.map(s => (
        <section key={s.title}>
          <h3 className="mb-1 font-semibold text-gray-900">{s.title}</h3>
          {s.paragraphs.map((p, i) => <p key={i} className="mb-1.5">{p}</p>)}
          {s.items && <ul className="list-disc space-y-1 pl-5">{s.items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
          {s.after?.map((p, i) => <p key={`a${i}`} className="mt-1.5">{p}</p>)}
        </section>
      ))}
    </article>
  )
}
