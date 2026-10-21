'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { addImageBlock, addTableBlock, deleteContentBlock, updateBlockIntroduction, updateTableBlock } from '@/lib/actions/proposals'
import { sanitizeStorageFileName, tenantStoragePath } from '@/lib/utils/storage'

type ContentBlock = {
  id: string
  block_type: string
  image_storage_path: string | null
  table_data: { rows: string[][] } | null
  header_color?: string | null
  image_size?: string | null
  introduction?: string | null
  show_totals?: boolean | null
  text_align?: string | null
}

type EditingState = {
  rows: string[][]
  headerColor: string
  showTotals: boolean
  textAlign: 'left' | 'center' | 'right'
  saving: boolean
}

const PRESET_COLORS = [
  { label: 'Orbis',  value: '#1B556B' },
  { label: 'Verde',  value: '#1f8c7d' },
  { label: 'Cinza',  value: '#374151' },
  { label: 'Azul',   value: '#1e40af' },
  { label: 'Preto',  value: '#111827' },
]

const BTN_SM = 'px-2 py-0.5 text-xs rounded border'

const IMAGE_SIZES = [
  { label: 'Pequena', value: 'small' },
  { label: 'Média',   value: 'medium' },
  { label: 'Grande',  value: 'large' },
  { label: 'Total',   value: 'full' },
]

// ── TableControls fora do componente para evitar remount a cada render ──────
function TableControls({ rows, onCell, onAddRow, onAddCol, onDelRow, onDelCol, color, onColor, totals, onTotals, align, onAlign }: {
  rows: string[][]
  onCell: (r: number, c: number, v: string) => void
  onAddRow: () => void; onAddCol: () => void
  onDelRow: () => void; onDelCol: () => void
  color: string; onColor: (v: string) => void
  totals: boolean; onTotals: (v: boolean) => void
  align: 'left' | 'center' | 'right'; onAlign: (v: 'left' | 'center' | 'right') => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs text-gray-500 mb-1">Cor do cabeçalho:</p>
        <div className="flex gap-1 flex-wrap items-center">
          {PRESET_COLORS.map(c => (
            <button key={c.value} onClick={() => onColor(c.value)} title={c.label}
              style={{ width: 20, height: 20, borderRadius: 4, background: c.value, border: color === c.value ? '2px solid #000' : '2px solid transparent' }} />
          ))}
          <input type="color" value={color} onChange={e => onColor(e.target.value)}
            style={{ width: 20, height: 20, border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4 }} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="border border-gray-200 p-0.5">
                    <input
                      value={cell}
                      onChange={e => onCell(r, c, e.target.value)}
                      className="w-20 px-1 py-0.5 outline-none text-xs"
                      style={{ background: r === 0 ? color + '22' : '#fff' }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-1 flex-wrap">
        <button onClick={onAddRow} className={`${BTN_SM} border-gray-300 text-gray-600`}>+ Linha</button>
        <button onClick={onAddCol} className={`${BTN_SM} border-gray-300 text-gray-600`}>+ Coluna</button>
        <button onClick={onDelRow} className={`${BTN_SM} border-red-200 text-red-400`}>- Linha</button>
        <button onClick={onDelCol} className={`${BTN_SM} border-red-200 text-red-400`}>- Col</button>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1">Alinhamento:</p>
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map(a => (
            <button key={a} onClick={() => onAlign(a)}
              className={`${BTN_SM} ${align === a ? 'bg-brand-700 text-white border-brand-700' : 'border-gray-300 text-gray-600'}`}>
              {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" checked={totals} onChange={e => onTotals(e.target.checked)} />
        Linha de total (soma colunas numéricas)
      </label>
    </div>
  )
}

export function ProposalContentBlocksEditor({
  proposalId, contractId, initialBlocks, canEdit,
}: {
  proposalId: string
  contractId: string
  initialBlocks: ContentBlock[]
  canEdit: boolean
}) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(initialBlocks)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditingState | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingIntro, setSavingIntro] = useState<string | null>(null)
  // Novos blocks
  const [tableRows, setTableRows] = useState<string[][]>([['', ''], ['', '']])
  const [headerColor, setHeaderColor] = useState('#1B556B')
  const [imageSize, setImageSize] = useState('medium')
  const [showTotals, setShowTotals] = useState(false)
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Edição inline ───────────────────────────────────────────────────────────
  function startEdit(b: ContentBlock) {
    setEditingId(b.id)
    setEditState({
      rows: b.table_data?.rows ?? [['', ''], ['', '']],
      headerColor: b.header_color ?? '#1B556B',
      showTotals: b.show_totals ?? false,
      textAlign: (b.text_align as 'left' | 'center' | 'right') ?? 'left',
      saving: false,
    })
  }

  function cancelEdit() { setEditingId(null); setEditState(null) }

  async function saveEdit(blockId: string) {
    if (!editState) return
    setEditState(p => p ? { ...p, saving: true } : p)
    const result = await updateTableBlock(blockId, editState.rows, editState.headerColor, editState.showTotals, editState.textAlign)
    if (result.error) { setError(result.error); setEditState(p => p ? { ...p, saving: false } : p); return }
    setBlocks(prev => prev.map(b => b.id === blockId ? {
      ...b,
      table_data: { rows: editState.rows },
      header_color: editState.headerColor,
      show_totals: editState.showTotals,
      text_align: editState.textAlign,
    } : b))
    setEditingId(null); setEditState(null)
  }

  function editCell(r: number, c: number, val: string) {
    setEditState(p => p ? { ...p, rows: p.rows.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? val : cell) : row) } : p)
  }
  function editAddRow() { setEditState(p => p ? { ...p, rows: [...p.rows, p.rows[0].map(() => '')] } : p) }
  function editAddCol() { setEditState(p => p ? { ...p, rows: p.rows.map(row => [...row, '']) } : p) }
  function editDelRow() { setEditState(p => p && p.rows.length > 2 ? { ...p, rows: p.rows.slice(0, -1) } : p) }
  function editDelCol() { setEditState(p => p && p.rows[0].length > 1 ? { ...p, rows: p.rows.map(row => row.slice(0, -1)) } : p) }

  // ── Adicionar novo block ────────────────────────────────────────────────────
  async function handleAddImage() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    setUploadingImage(true); setError(null)
    const supabase = createClient()
    const storagePath = await tenantStoragePath(supabase, `proposal-content/${proposalId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`)
    const { error: uploadError } = await supabase.storage.from('proposal-files').upload(storagePath, file)
    if (uploadError) { setError(`Falha no upload: ${uploadError.message}`); setUploadingImage(false); return }
    const result = await addImageBlock(proposalId, contractId, storagePath, imageSize)
    setUploadingImage(false)
    if (result.error) { setError(result.error) }
    else {
      setBlocks(prev => [...prev, { id: result.id ?? crypto.randomUUID(), block_type: 'image', image_storage_path: storagePath, table_data: null, image_size: imageSize, introduction: null }])
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function newUpdateCell(r: number, c: number, val: string) {
    setTableRows(prev => prev.map((row, ri) => ri === r ? row.map((cell, ci) => ci === c ? val : cell) : row))
  }
  function newAddRow() { setTableRows(prev => [...prev, prev[0].map(() => '')]) }
  function newAddCol() { setTableRows(prev => prev.map(row => [...row, ''])) }

  async function handleAddTable() {
    setError(null)
    const result = await addTableBlock(proposalId, contractId, tableRows, headerColor, showTotals, textAlign)
    if (result.error) { setError(result.error) }
    else {
      setBlocks(prev => [...prev, { id: result.id ?? crypto.randomUUID(), block_type: 'table', image_storage_path: null, table_data: { rows: tableRows }, header_color: headerColor, show_totals: showTotals, text_align: textAlign, introduction: null }])
      setTableRows([['', ''], ['', '']])
    }
  }

  async function handleDelete(blockId: string) {
    setBlocks(prev => prev.filter(b => b.id !== blockId))
    await deleteContentBlock(blockId, contractId, proposalId)
  }

  async function saveIntro(blockId: string, intro: string) {
    setSavingIntro(blockId)
    await updateBlockIntroduction(blockId, intro)
    setSavingIntro(null)
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, introduction: intro } : b))
  }

  const inp = 'border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-brand-700'

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-gray-900">Conteúdo extra (imagens e tabelas)</h2>
        <p className="text-xs text-gray-400 mt-0.5">Cada item pode ter um texto de introdução que aparece antes dele no PDF.</p>
      </div>

      {/* Lista de blocks */}
      <div className="space-y-4">
        {blocks.map((b) => (
          <div key={b.id} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            {/* Header do block */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {b.block_type === 'image' ? '🖼️ Imagem' : '▦ Tabela'}
                {b.block_type === 'table' && b.table_data ? ` (${b.table_data.rows.length}×${b.table_data.rows[0]?.length ?? 0})` : ''}
              </span>
              {canEdit && (
                <div className="flex gap-2">
                  {b.block_type === 'table' && editingId !== b.id && (
                    <button onClick={() => startEdit(b)} className="text-xs text-brand-700 hover:underline">✏️ Editar</button>
                  )}
                  {editingId === b.id && (
                    <button onClick={cancelEdit} className="text-xs text-gray-400 hover:underline">✕ Cancelar</button>
                  )}
                  <button onClick={() => handleDelete(b.id)} className="text-xs text-gray-400 hover:text-red-500">🗑️ Remover</button>
                </div>
              )}
            </div>

            {/* Introdução */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Texto de introdução para este item</label>
              <textarea defaultValue={b.introduction ?? ''} onBlur={e => saveIntro(b.id, e.target.value)}
                rows={5} placeholder="Digite o contexto ou introdução..." disabled={!canEdit}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:border-brand-700 resize-y disabled:bg-gray-50"
                style={{ minHeight: '80px' }} />
              {savingIntro === b.id && <span className="text-xs text-gray-400">Salvando...</span>}
              <p className="text-xs text-gray-400 mt-1">
                Dica: <code className="bg-gray-100 px-0.5 rounded">**palavra**</code> = <strong>negrito</strong> · <code className="bg-gray-100 px-0.5 rounded">*palavra*</code> = <em>itálico</em>. O PDF justifica automaticamente.
              </p>
            </div>

            {/* Modo de edição inline */}
            {editingId === b.id && editState && (
              <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
                <p className="text-xs font-semibold text-brand-700">✏️ Modo de edição</p>
                <TableControls
                  rows={editState.rows} onCell={editCell}
                  onAddRow={editAddRow} onAddCol={editAddCol}
                  onDelRow={editDelRow} onDelCol={editDelCol}
                  color={editState.headerColor} onColor={v => setEditState(p => p ? { ...p, headerColor: v } : p)}
                  totals={editState.showTotals} onTotals={v => setEditState(p => p ? { ...p, showTotals: v } : p)}
                  align={editState.textAlign} onAlign={v => setEditState(p => p ? { ...p, textAlign: v } : p)}
                />
                <button onClick={() => saveEdit(b.id)} disabled={editState.saving}
                  className="rounded-md bg-brand-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
                  {editState.saving ? 'Salvando...' : '✅ Salvar alterações'}
                </button>
              </div>
            )}

            {/* Preview (modo leitura) */}
            {editingId !== b.id && b.block_type === 'table' && b.table_data && (
              <div className="overflow-x-auto rounded border border-gray-100">
                <table className="text-xs border-collapse w-full">
                  {b.table_data.rows.map((row, r) => (
                    <tr key={r} style={{ background: r === 0 ? (b.header_color ?? '#1B556B') : r % 2 === 0 ? '#f9fafb' : '#fff' }}>
                      {row.map((cell, c) => (
                        <td key={c} className="border border-gray-100 px-2 py-1"
                          style={{ color: r === 0 ? '#fff' : '#111', fontWeight: r === 0 ? 600 : 400, textAlign: (b.text_align as any) ?? 'left' }}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </table>
                {b.show_totals && <p className="text-xs text-gray-400 px-2 py-1">∑ Linha de total ativa</p>}
              </div>
            )}
            {b.block_type === 'image' && b.image_storage_path && (
              <p className="text-xs text-gray-400">📎 {b.image_storage_path.split('/').pop()} · {IMAGE_SIZES.find(s => s.value === b.image_size)?.label ?? b.image_size}</p>
            )}
          </div>
        ))}
      </div>

      {/* Formulários de adição */}
      {canEdit && (
        <div className="grid grid-cols-2 gap-3">
          {/* Imagem */}
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">+ Adicionar imagem</p>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="text-xs" />
            <div>
              <p className="text-xs text-gray-500 mb-1">Tamanho:</p>
              <div className="flex gap-1 flex-wrap">
                {IMAGE_SIZES.map(s => (
                  <button key={s.value} onClick={() => setImageSize(s.value)}
                    className={`${BTN_SM} ${imageSize === s.value ? 'bg-brand-700 text-white border-brand-700' : 'border-gray-300 text-gray-600'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={handleAddImage} disabled={uploadingImage}
              className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
              {uploadingImage ? 'Enviando...' : 'Adicionar imagem'}
            </button>
          </div>

          {/* Nova tabela */}
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700">+ Adicionar tabela</p>
            <TableControls
              rows={tableRows} onCell={newUpdateCell}
              onAddRow={newAddRow} onAddCol={newAddCol}
              onDelRow={() => setTableRows(p => p.length > 2 ? p.slice(0,-1) : p)}
              onDelCol={() => setTableRows(p => p[0].length > 1 ? p.map(r => r.slice(0,-1)) : p)}
              color={headerColor} onColor={setHeaderColor}
              totals={showTotals} onTotals={setShowTotals}
              align={textAlign} onAlign={setTextAlign}
            />
            <button onClick={handleAddTable} className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800">
              Adicionar tabela
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
