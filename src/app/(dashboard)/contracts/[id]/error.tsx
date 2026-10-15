'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function ContractError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Contrato] Erro na página:', error)
  }, [error])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16, padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #dcadb3', padding: 24, maxWidth: 500, width: '100%' }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: '#8e4550', marginBottom: 8 }}>Erro ao carregar a página</p>
        <p style={{ fontSize: 12, color: '#52514e', marginBottom: 4 }}>
          {error.message || 'Ocorreu um erro inesperado.'}
        </p>
        {error.digest && (
          <p style={{ fontSize: 10, color: '#b0b8c8', fontFamily: 'monospace' }}>ID: {error.digest}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={reset}
            style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: 'none', background: '#1a1f36', color: '#fff', cursor: 'pointer' }}>
            Tentar novamente
          </button>
          <Link href="/pipeline"
            style={{ padding: '8px 16px', fontSize: 12, borderRadius: 8, border: '0.5px solid #d1d8e8', background: '#fff', color: '#52514e', textDecoration: 'none' }}>
            ← Voltar ao funil
          </Link>
        </div>
      </div>
    </div>
  )
}
