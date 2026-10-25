// Varejo: tipos de movimento do estoque (histórico)
export const STOCK_KINDS: Record<string, { label: string; style: string }> = {
  venda: { label: 'Venda', style: 'bg-brand-100 text-brand-800' },
  cancelamento: { label: 'Cancelamento (voltou)', style: 'bg-gray-100 text-gray-700' },
  entrada: { label: 'Entrada de mercadoria', style: 'bg-positive-100 text-positive-700' },
  contagem: { label: 'Contagem', style: 'bg-warn-100 text-warn-700' },
  importacao: { label: 'Planilha', style: 'bg-gray-100 text-gray-700' },
  ajuste: { label: 'Ajuste na peça', style: 'bg-warn-100 text-warn-700' },
  cadastro: { label: 'Cadastro', style: 'bg-gray-100 text-gray-700' },
}
export const stockKindLabel = (k: string) => STOCK_KINDS[k]?.label ?? k
