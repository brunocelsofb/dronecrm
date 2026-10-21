'use client'

import { useState, useRef } from 'react'
import { saveContractCustomFieldValues } from '@/lib/actions/custom-fields'
import { createClient } from '@/lib/supabase/client'
import { sanitizeStorageFileName, tenantStoragePath } from '@/lib/utils/storage'

type CustomField = { id: string; name: string; field_key: string; field_type: string; select_options: string[] | null }

export function ContractCustomFieldsSection({
  contractId,
  fields,
  values,
}: {
  contractId: string
  fields: CustomField[]
  values: Record<string, string>
}) {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // Pros campos de arquivo, guarda o caminho já enviado (começa com o
  // que já estava salvo, e atualiza na hora se subir um novo).
  const [filePaths, setFilePaths] = useState<Record<string, string>>(
    Object.fromEntries(fields.filter((f) => f.field_type === 'file').map((f) => [f.id, values[f.field_key] ?? '']))
  )
  const [uploadingFieldId, setUploadingFieldId] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  async function handleFileUpload(fieldId: string) {
    const file = fileInputRefs.current[fieldId]?.files?.[0]
    if (!file) return
    setUploadingFieldId(fieldId)

    const supabase = createClient()
    const storagePath = await tenantStoragePath(supabase, `custom-fields/${contractId}/${Date.now()}-${sanitizeStorageFileName(file.name)}`)
    const { error } = await supabase.storage.from('proposal-files').upload(storagePath, file)

    setUploadingFieldId(null)
    if (!error) {
      setFilePaths((prev) => ({ ...prev, [fieldId]: storagePath }))
    }
  }

  async function handleSave(formData: FormData) {
    // Injeta os caminhos de arquivo já enviados no formData antes de
    // salvar — eles não vêm de um <input> comum, foram enviados à
    // parte, direto pro Storage.
    for (const [fieldId, path] of Object.entries(filePaths)) {
      formData.set(`field_${fieldId}`, path)
    }

    // Junta os checkboxes marcados de cada campo de múltipla escolha
    // num valor só (separado por vírgula), porque cada checkbox marcado
    // manda o próprio valor separado — precisa combinar antes de salvar.
    for (const f of fields.filter((x) => x.field_type === 'multiselect')) {
      const checked = formData.getAll(`field_${f.id}_multi`) as string[]
      formData.set(`field_${f.id}`, checked.join(', '))
    }

    setBusy(true)
    setSaved(false)
    await saveContractCustomFieldValues(contractId, formData)
    setBusy(false)
    setSaved(true)
  }

  if (fields.length === 0) return null

  return (
    <form action={handleSave} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm font-medium text-gray-900">Campos customizados</p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.id} className={f.field_type === 'textarea' ? 'col-span-2' : ''}>
            <label className="block text-xs text-gray-500">{f.name}</label>

            {f.field_type === 'select' && (
              <select name={`field_${f.id}`} defaultValue={values[f.field_key] ?? ''} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none">
                <option value="">—</option>
                {(f.select_options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            )}

            {f.field_type === 'multiselect' && (
              <div className="mt-1 space-y-1 rounded-md border border-gray-300 p-2">
                {(f.select_options ?? []).map((opt) => {
                  const selected = (values[f.field_key] ?? '').split(',').map((s) => s.trim())
                  return (
                    <label key={opt} className="flex items-center gap-1.5 text-xs text-gray-700">
                      <input type="checkbox" name={`field_${f.id}_multi`} value={opt} defaultChecked={selected.includes(opt)} className="rounded border-gray-300" />
                      {opt}
                    </label>
                  )
                })}
              </div>
            )}

            {f.field_type === 'textarea' && (
              <textarea name={`field_${f.id}`} defaultValue={values[f.field_key] ?? ''} rows={3} className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none" />
            )}

            {f.field_type === 'file' && (
              <div className="mt-1 space-y-1">
                {filePaths[f.id] && (
                  <p className="text-xs text-positive-700">📎 Arquivo já enviado — suba outro pra substituir.</p>
                )}
                <input
                  ref={(el) => { fileInputRefs.current[f.id] = el }}
                  type="file"
                  className="w-full text-xs"
                />
                <button
                  type="button"
                  onClick={() => handleFileUpload(f.id)}
                  disabled={uploadingFieldId === f.id}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {uploadingFieldId === f.id ? 'Enviando...' : 'Enviar arquivo'}
                </button>
              </div>
            )}

            {(f.field_type === 'text' || f.field_type === 'number' || f.field_type === 'date') && (
              <input
                name={`field_${f.id}`}
                type={f.field_type === 'number' ? 'number' : f.field_type === 'date' ? 'date' : 'text'}
                defaultValue={values[f.field_key] ?? ''}
                className="mt-1 w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-700 focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>
      <button type="submit" disabled={busy} className="rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50">
        {busy ? 'Salvando...' : 'Salvar'}
      </button>
      {saved && <span className="ml-2 text-xs text-positive-700">Salvo!</span>}
    </form>
  )
}
