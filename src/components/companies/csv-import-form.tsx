'use client'

// Importação de empresas por CSV: baixa o modelo, preenche, envia e confere antes de gravar.

import { useState } from 'react'
import Papa from 'papaparse'
import { useRouter } from 'next/navigation'
import { bulkImportCompanies, type ImportRow, type ImportResult } from '@/lib/actions/companies-import'
import { IMPORT_COLUMNS, EXAMPLE_MARK, buildTemplateCsv, headerToKey } from '@/lib/companies/import-template'

function downloadTemplate() {
  const blob = new Blob([buildTemplateCsv(true)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'modelo-importacao-empresas.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function toRows(data: Record<string, string>[]): { rows: ImportRow[]; unknown: string[] } {
  const unknown = new Set<string>()
  const rows = data.map(raw => {
    const out: ImportRow = {}
    for (const [h, v] of Object.entries(raw)) {
      const key = headerToKey(h)
      if (key) out[key] = (v ?? '').trim()
      else if (h.trim()) unknown.add(h.trim())
    }
    return out
  })
  return { rows, unknown: [...unknown] }
}

export function CsvImportForm() {
  const router = useRouter()
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [unknownCols, setUnknownCols] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isExample = (r: ImportRow) => (r.razao_social ?? '').toUpperCase().startsWith(EXAMPLE_MARK)
  const validRows = (rows ?? []).filter(r => r.razao_social && !isExample(r))

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParsing(true)
    setError(null)
    setResult(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      // separador detectado sozinho (; ou ,)
      complete: res => {
        setParsing(false)
        const { rows: parsed, unknown } = toRows(res.data)
        setUnknownCols(unknown)
        if (parsed.every(r => !r.razao_social)) {
          setError('Não encontrei a coluna "razao_social". Baixe o modelo abaixo e use os mesmos nomes de coluna.')
          setRows(null)
          return
        }
        setRows(parsed)
      },
      error: (err: Error) => {
        setParsing(false)
        setError(`Falha ao ler o arquivo: ${err.message}`)
      },
    })
  }

  async function handleImport() {
    setImporting(true)
    setError(null)
    const res = await bulkImportCompanies(validRows)
    setImporting(false)
    setResult(res)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* 1. Modelo */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">1. Baixe o modelo e preencha</p>
            <p className="text-xs text-gray-500">Abre no Excel ou Google Planilhas. Uma empresa por linha; salve como CSV.</p>
          </div>
          <button
            type="button"
            onClick={downloadTemplate}
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            ⬇ Baixar modelo CSV
          </button>
        </div>

        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-700">Ver o que vai em cada coluna</summary>
          <div className="mt-2 max-h-72 overflow-auto rounded border border-gray-100">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Coluna</th>
                  <th className="px-2 py-1.5 text-left font-medium">O que preencher</th>
                  <th className="px-2 py-1.5 text-left font-medium">Exemplo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {IMPORT_COLUMNS.map(c => (
                  <tr key={c.key}>
                    <td className="px-2 py-1 font-mono whitespace-nowrap">
                      {c.key}{c.required && <span className="text-red-600"> *</span>}
                    </td>
                    <td className="px-2 py-1">{c.label}{c.hint ? ` — ${c.hint}` : ''}</td>
                    <td className="px-2 py-1 text-gray-500">{c.example || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-4">
            <li><span className="text-red-600">*</span> Só a <strong>razão social</strong> é obrigatória; as demais podem ficar em branco.</li>
            <li>A linha de exemplo do modelo (começa com “EXEMPLO”) é ignorada automaticamente.</li>
            <li>CNPJ já cadastrado é pulado — dá para importar o mesmo arquivo de novo sem duplicar.</li>
            <li>Se preencher o contato, ele vira o contato principal da empresa (usado nos avisos por WhatsApp e e-mail).</li>
          </ul>
        </details>
      </div>

      {/* 2. Envio */}
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
        <p className="mb-2 text-sm font-semibold text-gray-900">2. Envie o arquivo preenchido</p>
        <input type="file" accept=".csv,text/csv" onChange={handleFile} className="mx-auto block text-sm" />
      </div>

      {parsing && <p className="text-sm text-gray-500">Lendo arquivo...</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {rows && rows.length > 0 && !result && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            <strong>{fileName}</strong> — {validRows.length} empresa(s) para importar
            {rows.length !== validRows.length && ` (${rows.length - validRows.length} linha(s) ignorada(s): sem razão social ou exemplo)`}.
          </p>
          {unknownCols.length > 0 && (
            <p className="text-xs text-amber-700">Colunas não reconhecidas (serão ignoradas): {unknownCols.join(', ')}</p>
          )}

          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Razão social</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">CNPJ</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Cidade/UF</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Contato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.slice(0, 50).map((r, i) => {
                  const ignored = !r.razao_social || isExample(r)
                  return (
                    <tr key={i} className={ignored ? 'bg-gray-50 text-gray-400' : ''}>
                      <td className="px-3 py-1.5">{r.razao_social || <span className="text-red-500">sem razão social — ignorada</span>}{isExample(r) && ' (exemplo — ignorada)'}</td>
                      <td className="px-3 py-1.5 font-mono">{r.cnpj || '—'}</td>
                      <td className="px-3 py-1.5">{[r.cidade, r.uf].filter(Boolean).join('/') || '—'}</td>
                      <td className="px-3 py-1.5">{r.contato_nome || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <p className="text-xs text-gray-400">Mostrando as primeiras 50 linhas de {rows.length}.</p>}

          <button
            onClick={handleImport}
            disabled={importing || validRows.length === 0}
            className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {importing ? 'Importando...' : `3. Importar ${validRows.length} empresa(s)`}
          </button>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <p className="font-medium text-gray-900">Importação concluída</p>
          <p className="mt-1 text-gray-600">
            {result.imported} empresa(s) importada(s)
            {result.contacts > 0 && ` · ${result.contacts} contato(s) criado(s)`}
            {result.skipped > 0 && ` · ${result.skipped} pulada(s) (CNPJ já cadastrado)`}
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto space-y-0.5 text-xs text-amber-700">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
