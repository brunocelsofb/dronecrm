'use client'
// Usuários: área da pessoa (abas e regra de valores) e liberação avulsa de valores.
export function UserAccessSelect({
  defaultValue,
  areas,
  action,
  seesValues,
  valuesAction,
}: {
  defaultValue: string | null
  areas: { id: string; label: string; description: string; seesValues: boolean }[]
  action: (formData: FormData) => void
  seesValues?: boolean | null
  valuesAction?: (formData: FormData) => void
}) {
  const cur = areas.find(a => a.id === (defaultValue ?? 'gestor'))
  return (
    <div className="space-y-1">
      <form action={action}>
        <select
          name="access_profile"
          defaultValue={defaultValue ?? 'gestor'}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          title={cur?.description}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none"
        >
          {areas.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          {defaultValue && !areas.some(a => a.id === defaultValue) && <option value={defaultValue}>{defaultValue} (excluída)</option>}
        </select>
      </form>
      {valuesAction && (
        <form action={valuesAction}>
          <select
            name="sees_values"
            defaultValue={seesValues === true ? 'sim' : seesValues === false ? 'nao' : ''}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            title="Valores: segue a regra da área ou é liberado/bloqueado só para esta pessoa"
            className="rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 focus:border-brand-700 focus:outline-none"
          >
            <option value="">Valores: {cur?.seesValues === false ? 'não vê' : 'vê'} (regra da área)</option>
            <option value="sim">Valores: liberado (avulso)</option>
            <option value="nao">Valores: bloqueado (avulso)</option>
          </select>
        </form>
      )}
    </div>
  )
}
