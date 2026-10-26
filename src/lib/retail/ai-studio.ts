// ─── Varejo: Estúdio de imagens com IA (regras puras) ─────────────────────────
// Modelos virtuais (pessoas que não existem), cenários e fotos de look geradas com a
// conta de IA da própria responsável (Gemini ou ChatGPT). Imagens ficam em
// "<tenant>/ia/..." no bucket retail-media: a vitrine marca essas fotos como "criada por IA".

export type AiProvider = 'gemini' | 'openai'
export type AiImageKind = 'modelo' | 'cenario' | 'look'

export const AI_PROVIDERS: { id: AiProvider; label: string; keyUrl: string; keyHelp: string; models: { id: string; label: string }[] }[] = [
  {
    id: 'gemini', label: 'Google Gemini (Nano Banana)', keyUrl: 'https://aistudio.google.com/apikey',
    keyHelp: 'Entre no Google AI Studio com a sua conta Google, crie a chave (API key) e cole aqui. O uso é cobrado na sua conta do Google.',
    models: [
      { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1' },
      { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2 (rápido)' },
      { id: 'gemini-3-pro-image', label: 'Nano Banana Pro (mais detalhe)' },
    ],
  },
  {
    id: 'openai', label: 'ChatGPT (OpenAI)', keyUrl: 'https://platform.openai.com/api-keys',
    keyHelp: 'Entre na plataforma da OpenAI com a sua conta, crie a chave (API key) e cole aqui. A assinatura do ChatGPT não inclui a API: o uso é cobrado à parte na sua conta da OpenAI.',
    models: [
      { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare (rápido)' },
      { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst (mais fiel na edição)' },
    ],
  },
]
export const isAiProvider = (v: unknown): v is AiProvider => v === 'gemini' || v === 'openai'
export const isAiKind = (v: unknown): v is AiImageKind => v === 'modelo' || v === 'cenario' || v === 'look'
export const defaultModel = (p: AiProvider) => AI_PROVIDERS.find(x => x.id === p)!.models[0].id
export const validModel = (p: AiProvider, m: unknown) => AI_PROVIDERS.find(x => x.id === p)!.models.some(x => x.id === m)

export const MAX_LOOK_PIECES = 8

// Tamanho padrão das fotos para a vitrine: look em pé 4:5 (1600 × 2000), que serve nos
// cartões de look e na capa do computador. Modelo e cenário são referência (2:3).
export const IMAGE_FORMAT = {
  look: { openai: '1600x2000', gemini: '4:5', label: '1600 × 2000 px (4:5, vertical)' },
  modelo: { openai: '1024x1536', gemini: '2:3', label: '1024 × 1536 px (2:3)' },
  cenario: { openai: '1024x1536', gemini: '2:3', label: '1024 × 1536 px (2:3)' },
} as const

// Poses: com 2 fotos, cada uma sai numa pose diferente
export const POSES = [
  'em pé de frente, corpo inteiro, uma mão na cintura e sorriso leve',
  'em três quartos (levemente de lado), caminhando, olhar para a câmera',
  'de lado, olhando por cima do ombro, mostrando as costas e o caimento da peça',
  'em pé de frente, mãos relaxadas ao lado do corpo, postura confiante',
  'encostada levemente numa parede ou móvel do cenário, pernas cruzadas na altura dos tornozelos',
  'sentada de forma elegante, mostrando o caimento da roupa sentada',
] as const
export const isPose = (v: unknown): v is string => typeof v === 'string' && (POSES as readonly string[]).includes(v)

// Modelo virtual: descrição → prompt (pessoa fictícia, foto de catálogo neutra para reusar)
export type ModelSpec = { age: string; body: string; skin: string; hair: string; style: string; extra: string }
export function modelPrompt(s: ModelSpec): string {
  const parts = [
    'Fotografia realista de catálogo de moda, corpo inteiro, de uma modelo feminina fictícia (pessoa que não existe).',
    s.age && `Idade aparente: ${s.age}.`, s.body && `Tipo de corpo: ${s.body}.`, s.skin && `Tom de pele: ${s.skin}.`, s.hair && `Cabelo: ${s.hair}.`,
    s.style && `Estilo e expressão: ${s.style}.`,
    'Em pé, de frente, braços relaxados, roupa básica justa e lisa em tom neutro (para depois vestir outras peças), descalça ou com sandália nude.',
    'Fundo de estúdio cinza-claro liso, luz suave e uniforme, foco nítido, sem textos, sem logotipos.',
    s.extra,
  ]
  return parts.filter(Boolean).join(' ')
}

export type SceneSpec = { place: string; mood: string; extra: string }
export const SCENE_PLACES = ['Provador de loja de roupas', 'Interior de loja de roupas', 'Rua charmosa da cidade', 'Escritório moderno', 'Igreja (entrada, luz natural)', 'Café', 'Estúdio fotográfico']
export function scenePrompt(s: SceneSpec): string {
  return [
    `Fotografia realista de ambiente, sem pessoas: ${s.place || 'provador de loja de roupas'}.`,
    s.mood && `Clima: ${s.mood}.`,
    'Enquadramento vertical, espaço livre no centro para uma pessoa em pé, luz agradável, sem textos, sem logotipos e sem marcas.',
    s.extra,
  ].filter(Boolean).join(' ')
}

// Foto do look: modelo + peças + cenário (o texto segue o prompt combinado com a loja)
export function lookPrompt(pieces: number, hasScene: boolean): string {
  const total = 1 + pieces + (hasScene ? 1 : 0)
  const pecas = pieces === 1 ? 'A segunda imagem é a de uma peça de roupa feminina.' : `As imagens 2 a ${pieces + 1} são as peças de um look de roupas femininas.`
  return [
    `Vou te enviar ${total} imagens e quero que você execute rigorosamente as orientações a seguir.`,
    'A primeira imagem é a de uma modelo.',
    pecas,
    hasScene ? `A última imagem é a de um provador de loja de roupas (cenário).` : '',
    `Quero que você coloque ${pieces === 1 ? 'a peça' : 'as roupas dessas peças'} na modelo da primeira imagem, mantendo todas as características tanto da modelo quanto da roupa inalteradas (cor, estampa, tecido, comprimento e detalhes).`,
    hasScene
      ? 'E para finalizar, depois de vestir a modelo, coloque a modelo no cenário da última imagem, em uma posição onde é possível notar as principais características tanto da roupa quanto dos acessórios.'
      : 'Mostre a modelo de corpo inteiro, em uma posição onde é possível notar as principais características tanto da roupa quanto dos acessórios.',
    'Foto realista, vertical, sem textos e sem logotipos.',
  ].filter(Boolean).join('\n')
}

// A foto é do Estúdio IA? (pasta "<tenant>/ia/" no bucket)
export function isAiPhotoUrl(url: string | null | undefined, tenantId: string): boolean {
  return !!url && url.includes(`/retail-media/${tenantId}/ia/`)
}

// ── Texto do look (site + rede social + ocasião sugerida) ─────────────────────
export const AI_TEXT_MODEL: Record<AiProvider, string> = { openai: 'gpt-6-astra', gemini: 'gemini-3.8-flash' }
export type LookCopy = { site: string; social: string; hashtags: string[]; occasion: { id: string | null; name: string; why: string } }

export function copyPrompt(o: { store: string; essence: string; pieces: string[]; occasions: { id: string; name: string }[] }): string {
  return [
    `Você é redatora de moda da loja ${o.store}. Essência da marca: "${o.essence}".`,
    'Olhe a foto do look (modelo vestindo as peças) e escreva em português do Brasil, com tom elegante, acolhedor e direto, sem exagero e sem prometer o que não está na foto.',
    o.pieces.length ? `Peças do look: ${o.pieces.join('; ')}.` : '',
    `Ocasiões que a loja já usa: ${o.occasions.length ? o.occasions.map(x => `${x.id} = ${x.name}`).join('; ') : 'nenhuma ainda'}.`,
    'Responda SOMENTE com um JSON neste formato:',
    '{"site": "texto curto para a vitrine (2 a 3 frases, até 300 caracteres)", "social": "legenda para Instagram (até 600 caracteres, pode ter 1 ou 2 emojis discretos e uma chamada para comprar pelo site ou WhatsApp)", "hashtags": ["até 8 hashtags sem o #"], "occasion": {"id": "id de uma ocasião da lista que combine, ou null", "name": "nome da ocasião (da lista ou uma nova sugestão curta)", "why": "uma frase explicando a escolha"}}',
  ].filter(Boolean).join('\n')
}

// Lê o JSON da resposta (aceita bloco ```json); valida e limpa
export function parseLookCopy(text: string, occasionIds: string[]): LookCopy | null {
  const m = String(text ?? '').match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: Record<string, unknown>
  try { j = JSON.parse(m[0]) } catch { return null }
  const site = String(j.site ?? '').trim().slice(0, 400)
  const social = String(j.social ?? '').trim().slice(0, 900)
  if (!site || !social || /^texto curto para a vitrine/i.test(site)) return null
  const hashtags = (Array.isArray(j.hashtags) ? j.hashtags : []).map(h => String(h).replace(/^#/, '').replace(/\s+/g, '').trim()).filter(Boolean).slice(0, 10)
  const oc = (j.occasion && typeof j.occasion === 'object' ? j.occasion : {}) as Record<string, unknown>
  const id = typeof oc.id === 'string' && occasionIds.includes(oc.id) ? oc.id : null
  return { site, social, hashtags, occasion: { id, name: String(oc.name ?? '').trim().slice(0, 40), why: String(oc.why ?? '').trim().slice(0, 200) } }
}
