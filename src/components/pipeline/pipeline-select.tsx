'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

const TYPE_BADGE: Record<string, { bg: string; color: string }> = {
  vendas:          { bg: '#e3f5f1', color: '#1f8c7d' },
  gestao_contratos:{ bg: '#e8e7f4', color: '#524e9c' },
  servico_avulso:  { bg: '#fbeee5', color: '#c2683d' },
}

export function PipelineSelect({
  pipelines,
  selected,
}: {
  pipelines: { id: string; name: string; type?: string }[]
  selected?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleChange(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('pipeline', id)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {pipelines.map(p => {
        const isActive = p.id === selected
        const badge = TYPE_BADGE[(p.type ?? '')] ?? { bg: '#f1f3f8', color: '#8892a4' }
        return (
          <button
            key={p.id}
            onClick={() => handleChange(p.id)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              borderRadius: 20,
              border: '0.5px solid',
              cursor: 'pointer',
              transition: 'all 0.15s',
              borderColor: isActive ? '#1a1f36' : '#d1d8e8',
              background: isActive ? '#1a1f36' : '#fff',
              color: isActive ? '#fff' : '#52514e',
            }}
          >
            {!isActive && (
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: badge.color, marginRight: 5, verticalAlign: 'middle', marginTop: -1 }} />
            )}
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
