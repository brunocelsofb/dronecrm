import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { isCurrentUserAdmin } from '@/lib/auth/role'
import { ALL_TOOLS, WRITE_TOOL_NAMES } from '@/lib/ai/assistant-tools'
import { executeReadTool } from '@/lib/ai/read-tools'
import { checkBudgetAvailable, logAssistantUsage } from '@/lib/ai/budget'
import { resolveTenantId } from '@/lib/tenant/context'
import { getAnthropicKeyForTenant, NO_AI_KEY_MESSAGE } from '@/lib/ai/tenant-key'

// NOTA DE INCERTEZA: a API do SDK @anthropic-ai/sdk usada aqui é a que
// eu conheço, mas nunca rodei isso de verdade neste ambiente — se algo
// der erro (formato de resposta, nomes de campo), me avise a mensagem
// exata do erro.
//
// IMPORTANTE: essa rota exige a variável de ambiente ANTHROPIC_API_KEY
// configurada no projeto (Vercel → Settings → Environment Variables).
// Sem isso, toda chamada aqui falha.

const SYSTEM_PROMPT = `Você é o Théo, o assistente de IA do CRM da ORBIS Gestão de Tecnologia em Saúde. Você ajuda a equipe a consultar e atualizar dados do CRM usando linguagem natural em português.

Regras importantes:
- Para AÇÕES DE ESCRITA (criar empresa, adicionar nota, mover etapa), você propõe a ação através da ferramenta — ela só é executada depois que a pessoa confirmar na tela, então pode chamar a ferramenta normalmente.
- Para encontrar o ID de um contrato ou empresa, use search_contracts ou search_companies primeiro — nunca invente um ID.
- Se não encontrar o que foi pedido, diga isso claramente em vez de inventar informação.
- Seja direto e conciso nas respostas em texto.
- Hoje é ${new Date().toLocaleDateString('pt-BR')}.`

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  // Trava de custo: só admin usa o assistente, mesmo se alguém tentar
  // chamar a rota direto (a tela já esconde o botão, mas isso sozinho
  // não é suficiente).
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: 'Só administradores podem usar o Théo.' }, { status: 403 })
  }

  // Chave da Anthropic da empresa (Configurações → Copiloto IA)
  const aiKey = await getAnthropicKeyForTenant(await resolveTenantId())
  if (!aiKey.key) return NextResponse.json({ error: NO_AI_KEY_MESSAGE }, { status: 400 })

  const budgetCheck = await checkBudgetAvailable()
  if (!budgetCheck.ok) {
    return NextResponse.json({ error: budgetCheck.message }, { status: 402 })
  }

  const { messages } = await request.json()

  const anthropic = new Anthropic({ apiKey: aiKey.key })

  const conversation = [...messages]
  let iterations = 0

  while (iterations < 6) {
    iterations++

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: ALL_TOOLS as unknown as Anthropic.Tool[],
      messages: conversation,
    })

    conversation.push({ role: 'assistant', content: response.content })
    await logAssistantUsage(user.id, response.usage.input_tokens, response.usage.output_tokens)

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b) => b.type === 'text')
      return NextResponse.json({
        messages: conversation,
        finalText: textBlock && textBlock.type === 'text' ? textBlock.text : '',
        pendingAction: null,
      })
    }

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use')
    const writeBlock = toolUseBlocks.find((b) => b.type === 'tool_use' && WRITE_TOOL_NAMES.has(b.name))

    if (writeBlock && writeBlock.type === 'tool_use') {
      // Ação de ESCRITA — para o loop aqui e devolve pra tela confirmar
      // antes de executar de verdade.
      return NextResponse.json({
        messages: conversation,
        finalText: null,
        pendingAction: {
          toolUseId: writeBlock.id,
          toolName: writeBlock.name,
          toolInput: writeBlock.input,
        },
      })
    }

    // Só ferramentas de LEITURA nesse turno — executa todas e continua
    // o loop pra deixar a IA formular a resposta final (ou pedir mais
    // alguma leitura).
    const toolResults = []
    for (const block of toolUseBlocks) {
      if (block.type !== 'tool_use') continue
      const result = await executeReadTool(block.name, block.input as Record<string, unknown>)
      toolResults.push({ type: 'tool_result' as const, tool_use_id: block.id, content: result })
    }
    conversation.push({ role: 'user', content: toolResults })
  }

  return NextResponse.json({ messages: conversation, finalText: 'Muitas etapas encadeadas — tente reformular seu pedido de forma mais direta.', pendingAction: null })
}
