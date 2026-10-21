'use client'

import { useState, useRef, useEffect } from 'react'
import { Bold, Italic, Strikethrough } from 'lucide-react'
import { updateEmailSignature } from '@/lib/actions/email'
import { createClient } from '@/lib/supabase/client'
import { sanitizeStorageFileName, tenantStoragePath } from '@/lib/utils/storage'

const FONT_FAMILIES = ['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Trebuchet MS', 'Tahoma']
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32]

export function EmailSignatureForm({ currentSignature }: { currentSignature: string }) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const savedRangeRef = useRef<Range | null>(null)

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = currentSignature || ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Guarda onde estava selecionado no editor — os <select> da barra de
  // ferramentas tiram o foco do editor quando clicados, então sem isso
  // a seleção de texto se perderia antes de aplicar a formatação.
  function saveSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    }
  }

  function restoreSelection() {
    const sel = window.getSelection()
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges()
      sel.addRange(savedRangeRef.current)
    }
  }

  // Envolve o texto selecionado num <span> com o estilo desejado — mais
  // confiável que o antigo document.execCommand('fontSize', ...), que
  // só tem 7 tamanhos fixos e não deixa escolher em pixel/ponto.
  function wrapSelection(applyStyle: (style: CSSStyleDeclaration) => void) {
    restoreSelection()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const span = document.createElement('span')
    applyStyle(span.style)
    span.appendChild(range.extractContents())
    range.insertNode(span)
    sel.removeAllRanges()
    const newRange = document.createRange()
    newRange.selectNodeContents(span)
    sel.addRange(newRange)
    savedRangeRef.current = newRange.cloneRange()
  }

  function applyFontSize(px: string) {
    wrapSelection((style) => (style.fontSize = `${px}px`))
  }

  function applyFontFamily(font: string) {
    wrapSelection((style) => (style.fontFamily = font))
  }

  function applyInlineFormat(command: 'bold' | 'italic' | 'strikeThrough') {
    restoreSelection()
    editorRef.current?.focus()
    document.execCommand(command)
  }

  // Aumentar/diminuir tudo de uma vez (texto E imagem) continua
  // disponível, além do controle fino por seleção acima.
  function resizeAll(multiplier: number) {
    const root = editorRef.current
    if (!root) return

    const textElements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*:not(img)'))]
    for (const el of textElements) {
      const computed = window.getComputedStyle(el)
      const currentSize = parseFloat(el.style.fontSize || computed.fontSize || '14')
      el.style.fontSize = `${Math.max(8, Math.round(currentSize * multiplier))}px`
    }

    const images = root.querySelectorAll<HTMLImageElement>('img')
    for (const img of images) {
      const currentWidth = img.getBoundingClientRect().width || img.naturalWidth || 150
      const newWidth = Math.max(20, Math.round(currentWidth * multiplier))
      img.style.width = `${newWidth}px`
      img.style.maxWidth = `${newWidth}px`
      img.style.height = 'auto'
    }
  }

  async function handleImageUpload() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    setUploadingImage(true)
    setUploadError(null)

    const supabase = createClient()
    const storagePath = await tenantStoragePath(supabase, `signatures/${Date.now()}-${sanitizeStorageFileName(file.name)}`)
    const { error: uploadErr } = await supabase.storage.from('proposal-files').upload(storagePath, file)

    if (uploadErr) {
      setUploadError(`Falha no upload: ${uploadErr.message}`)
      setUploadingImage(false)
      return
    }

    const publicUrl = `${window.location.origin}/api/email-assets/${storagePath}`
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, `<img src="${publicUrl}" style="max-width:300px;display:block" />`)

    setUploadingImage(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSave() {
    setBusy(true)
    setSaved(false)
    const html = editorRef.current?.innerHTML ?? ''
    await updateEmailSignature(html)
    setBusy(false)
    setSaved(true)
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-6">
      <h3 className="text-sm font-medium text-gray-900">✍️ Assinatura de e-mail</h3>
      <p className="text-xs text-gray-400">
        Anexada automaticamente no fim de todo e-mail que você enviar pelo CRM. Selecione um trecho do texto pra aplicar fonte, tamanho, negrito, itálico ou tachado — igual num editor de texto comum.
      </p>

      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 p-1.5">
        <select
          onMouseDown={saveSelection}
          onChange={(e) => applyFontFamily(e.target.value)}
          defaultValue=""
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs focus:border-brand-700 focus:outline-none"
        >
          <option value="" disabled>Fonte</option>
          {FONT_FAMILIES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <select
          onMouseDown={saveSelection}
          onChange={(e) => applyFontSize(e.target.value)}
          defaultValue=""
          className="rounded border border-gray-300 bg-white px-1.5 py-1 text-xs focus:border-brand-700 focus:outline-none"
        >
          <option value="" disabled>Tamanho</option>
          {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
        </select>
        <div className="mx-1 h-5 w-px bg-gray-300" />
        <button type="button" onMouseDown={saveSelection} onClick={() => applyInlineFormat('bold')} title="Negrito" className="rounded border border-gray-300 bg-white p-1.5 hover:bg-gray-100">
          <Bold size={13} />
        </button>
        <button type="button" onMouseDown={saveSelection} onClick={() => applyInlineFormat('italic')} title="Itálico" className="rounded border border-gray-300 bg-white p-1.5 hover:bg-gray-100">
          <Italic size={13} />
        </button>
        <button type="button" onMouseDown={saveSelection} onClick={() => applyInlineFormat('strikeThrough')} title="Tachado" className="rounded border border-gray-300 bg-white p-1.5 hover:bg-gray-100">
          <Strikethrough size={13} />
        </button>
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        className="min-h-[120px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-700 focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="text-xs" />
        <button
          type="button"
          onClick={handleImageUpload}
          disabled={uploadingImage}
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {uploadingImage ? 'Enviando...' : '+ Inserir imagem/logo'}
        </button>
        <span className="mx-1 text-gray-300">|</span>
        <span className="text-xs text-gray-500">Aumentar/diminuir tudo:</span>
        <button type="button" onClick={() => resizeAll(0.87)} className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">A−</button>
        <button type="button" onClick={() => resizeAll(1.15)} className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">A+</button>
      </div>
      {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
      <button onClick={handleSave} disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
        {busy ? 'Salvando...' : 'Salvar assinatura'}
      </button>
      {saved && <span className="ml-2 text-xs text-positive-700">Salvo!</span>}
    </div>
  )
}
