// Integracao com a API do Google Gemini.
// A chave NUNCA e enviada ao cliente: todas as chamadas passam por aqui.
// Sem GEMINI_API_KEY definida, todas as funcoes retornam dados mock com atraso
// simulado e a aplicacao continua funcionando normalmente.

const CHAVE = process.env.GEMINI_API_KEY?.trim();
const MODELO = process.env.GEMINI_MODELO?.trim() || 'gemini-2.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const iaDisponivel = () => Boolean(CHAVE);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Protocolos de sondagem por natureza do topico.
// A IA conduz a conversa, mas NUNCA avalia: nao da nota, nao da veredito,
// nao sugere marcar o topico como estudado. Quem marca e sempre o usuario.
// ---------------------------------------------------------------------------
export const PROTOCOLOS = {
  declarativo: 'Explique o conceito como se eu não soubesse nada sobre o assunto.',
  procedimental: 'Resolva um exemplo explicando cada passo e por que ele é necessário.',
  relacional: "Vou fazer perguntas do tipo 'e se...' sobre o comportamento do sistema.",
};

const REGRAS_COMUNS = [
  'Você conduz uma sondagem de estudo em português do Brasil.',
  'Você NUNCA emite veredito, nota, porcentagem, score ou nível de domínio, e nunca diz "aprovado" ou "reprovado".',
  'Você NUNCA sugere marcar o tópico como estudado, concluído ou dominado. Essa decisão é exclusiva do usuário e acontece fora da conversa.',
  'Você não usa gamificação, elogios motivacionais, streaks ou cobrança.',
  'Use linguagem neutra e informativa. Pode apontar lacunas e fazer perguntas de acompanhamento, sempre de forma descritiva, nunca avaliativa.',
  'Responda de forma concisa, em texto corrido simples, sem cabeçalhos de markdown.',
].join(' ');

function instrucaoSondagem(topico, natureza) {
  const protocolo = PROTOCOLOS[natureza] || PROTOCOLOS.declarativo;
  return [
    REGRAS_COMUNS,
    `O tópico em sondagem é: "${topico}". A natureza do tópico é "${natureza}".`,
    `Protocolo desta sondagem — conduza a conversa a partir desta instrução ao usuário: "${protocolo}"`,
    natureza === 'relacional'
      ? 'Tome a iniciativa e faça perguntas do tipo "e se..." sobre o comportamento do sistema, uma de cada vez.'
      : 'Peça ao usuário que produza a explicação ou a resolução, e reaja com perguntas de acompanhamento sobre pontos não abordados.',
    'Contexto do modo ativo: aprendizagem.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Chamada bruta a API
// ---------------------------------------------------------------------------
async function chamar({ instrucaoSistema, conteudos, json = false }) {
  const corpo = {
    contents: conteudos,
    generationConfig: json
      ? { temperature: 0.3, responseMimeType: 'application/json' }
      : { temperature: 0.7 },
  };
  if (instrucaoSistema) {
    corpo.systemInstruction = { parts: [{ text: instrucaoSistema }] };
  }

  const resposta = await fetch(`${BASE}/${MODELO}:generateContent?key=${CHAVE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    const bruto = await resposta.text().catch(() => '');
    // O corpo de erro do Google e um JSON grande; a interface so precisa do motivo.
    let motivo = bruto.slice(0, 200);
    try {
      motivo = JSON.parse(bruto)?.error?.message ?? motivo;
    } catch {
      /* corpo nao era JSON */
    }
    throw new Error(`Gemini respondeu ${resposta.status}: ${motivo}`);
  }

  const dados = await resposta.json();
  const partes = dados?.candidates?.[0]?.content?.parts ?? [];
  const texto = partes.map((p) => p.text || '').join('').trim();
  if (!texto) throw new Error('Gemini retornou resposta vazia.');
  return texto;
}

// ---------------------------------------------------------------------------
// 1. Conversa de sondagem
// ---------------------------------------------------------------------------
export async function conversarSondagem(historico, topico, natureza) {
  if (!CHAVE) {
    await espera(700);
    return mockSondagem(historico, topico, natureza);
  }

  const conteudos = historico.map((m) => ({
    role: m.papel === 'assistente' ? 'model' : 'user',
    parts: [{ text: m.conteudo }],
  }));

  // O historico precisa comecar com uma mensagem do usuario.
  while (conteudos.length && conteudos[0].role === 'model') conteudos.shift();

  if (conteudos.length === 0) {
    conteudos.push({
      role: 'user',
      parts: [{ text: 'Inicie a sondagem seguindo o protocolo. Seja breve.' }],
    });
  }

  return chamar({ instrucaoSistema: instrucaoSondagem(topico, natureza), conteudos });
}

function mockSondagem(historico, topico, natureza) {
  const doUsuario = historico.filter((m) => m.papel === 'usuario').length;
  if (doUsuario === 0) {
    const p = PROTOCOLOS[natureza] || PROTOCOLOS.declarativo;
    return `(modo simulado — sem GEMINI_API_KEY)\n\n${p}\n\nTópico: ${topico}. Pode começar quando quiser.`;
  }
  const seguimentos = [
    'Entendi. Como você descreveria a relação disso com o que vem antes no assunto?',
    'Certo. Que parte desse raciocínio ficou menos detalhada?',
    'Anotado. Se um dos elementos que você citou fosse removido, o que mudaria?',
    'Ok. Consegue dar um exemplo concreto diferente do que já foi mencionado?',
  ];
  return `(modo simulado — sem GEMINI_API_KEY)\n\n${seguimentos[doUsuario % seguimentos.length]}`;
}

// ---------------------------------------------------------------------------
// 2 e 3. Geracao da arvore de topicos (JSON puro)
// ---------------------------------------------------------------------------
const ESQUEMA_ARVORE = [
  'Responda APENAS com JSON puro, sem markdown, sem crases, sem preâmbulo e sem comentários.',
  'Formato exato:',
  '{"topicos":[{"titulo":"string","natureza":"declarativo|procedimental|relacional","peso":"baixo|medio|alto","topico_pai":"titulo do topico pai ou null"}]}',
  '',
  'Regras:',
  '- "topico_pai" deve ser exatamente igual ao "titulo" de outro item da lista, ou null para tópicos de primeiro nível.',
  '- Liste o pai antes dos filhos.',
  '- No máximo 3 níveis de profundidade e no máximo 45 tópicos no total.',
  '- Deduplique conceitos repetidos: cada conceito aparece uma única vez, com um único título.',
  '- "natureza": declarativo = conceitos e definições; procedimental = métodos, cálculos e execuções; relacional = interações, comparações e comportamento de sistemas.',
  '- "peso": importância relativa do tópico dentro do assunto.',
  '- Títulos curtos, em português do Brasil, sem numeração.',
].join('\n');

function normalizarArvore(bruto) {
  const lista = Array.isArray(bruto?.topicos) ? bruto.topicos : Array.isArray(bruto) ? bruto : [];
  const naturezas = ['declarativo', 'procedimental', 'relacional'];
  const pesos = ['baixo', 'medio', 'alto'];
  const vistos = new Set();
  const saida = [];

  for (const item of lista) {
    const titulo = String(item?.titulo ?? '').trim();
    if (!titulo) continue;
    const chave = titulo.toLowerCase();
    if (vistos.has(chave)) continue; // deduplicacao de conceitos repetidos
    vistos.add(chave);
    const pai = item?.topico_pai == null ? null : String(item.topico_pai).trim() || null;
    saida.push({
      titulo,
      natureza: naturezas.includes(item?.natureza) ? item.natureza : 'declarativo',
      peso: pesos.includes(item?.peso) ? item.peso : 'medio',
      topico_pai: pai && pai.toLowerCase() !== chave ? pai : null,
    });
  }

  // Pais inexistentes viram topicos de primeiro nivel.
  const titulos = new Set(saida.map((t) => t.titulo.toLowerCase()));
  for (const t of saida) {
    if (t.topico_pai && !titulos.has(t.topico_pai.toLowerCase())) t.topico_pai = null;
  }
  return saida;
}

function extrairJson(texto) {
  let limpo = String(texto).trim();
  // Tolera cercas de markdown caso o modelo as inclua mesmo assim.
  limpo = limpo.replace(/^```[a-z]*/i, '').replace(/```$/, '').trim();
  const inicio = limpo.search(/[[{]/);
  if (inicio > 0) limpo = limpo.slice(inicio);
  const fim = Math.max(limpo.lastIndexOf('}'), limpo.lastIndexOf(']'));
  if (fim >= 0) limpo = limpo.slice(0, fim + 1);
  return JSON.parse(limpo);
}

async function gerarArvore(prompt) {
  try {
    const texto = await chamar({
      instrucaoSistema: ESQUEMA_ARVORE,
      conteudos: [{ role: 'user', parts: [{ text: prompt }] }],
      json: true,
    });
    const arvore = normalizarArvore(extrairJson(texto));
    if (arvore.length === 0) {
      return {
        topicos: [],
        erro: 'A IA não retornou tópicos utilizáveis. Você pode montar a tabela manualmente.',
      };
    }
    return { topicos: arvore, erro: null };
  } catch (e) {
    // Fallback de falha de parse ou de rede: arvore vazia + mensagem para a interface.
    // O caminho manual continua disponivel; a falha nunca bloqueia a tela.
    return {
      topicos: [],
      erro: `Não foi possível gerar a árvore automaticamente (${e.message}). Você pode montar a tabela manualmente.`,
    };
  }
}

export async function extrairTabelaConteudos(textoDocumentos) {
  if (!CHAVE) {
    await espera(1200);
    return { topicos: mockArvore('documentos enviados'), erro: null };
  }
  const texto = String(textoDocumentos || '').slice(0, 120000);
  if (!texto.trim()) {
    return { topicos: [], erro: 'Os documentos enviados não continham texto legível.' };
  }
  return gerarArvore(
    'Extraia a tabela de conteúdos de estudo a partir do material abaixo. ' +
      'Use a estrutura e a terminologia do próprio material.\n\n--- MATERIAL ---\n' +
      texto
  );
}

export async function buscarRoteiroEstudos(tema) {
  if (!CHAVE) {
    await espera(1200);
    return { topicos: mockArvore(String(tema || 'tema informado')), erro: null };
  }
  const t = String(tema || '').trim();
  if (!t) return { topicos: [], erro: 'Informe um tema para buscar o roteiro.' };
  return gerarArvore(
    `Monte um roteiro de estudos estruturado sobre o tema: "${t}". Organize do fundamento ao avançado.`
  );
}

function mockArvore(rotulo) {
  const raiz = `Fundamentos — ${rotulo}`;
  return [
    { titulo: raiz, natureza: 'declarativo', peso: 'alto', topico_pai: null },
    { titulo: 'Definições e vocabulário', natureza: 'declarativo', peso: 'medio', topico_pai: raiz },
    { titulo: 'Contexto e delimitação do assunto', natureza: 'declarativo', peso: 'baixo', topico_pai: raiz },
    { titulo: 'Métodos e procedimentos', natureza: 'procedimental', peso: 'alto', topico_pai: null },
    { titulo: 'Procedimento básico passo a passo', natureza: 'procedimental', peso: 'alto', topico_pai: 'Métodos e procedimentos' },
    { titulo: 'Casos limite e exceções', natureza: 'procedimental', peso: 'medio', topico_pai: 'Métodos e procedimentos' },
    { titulo: 'Comportamento do sistema', natureza: 'relacional', peso: 'medio', topico_pai: null },
    { titulo: 'Efeito de variações nos parâmetros', natureza: 'relacional', peso: 'medio', topico_pai: 'Comportamento do sistema' },
    { titulo: 'Comparação com abordagens alternativas', natureza: 'relacional', peso: 'baixo', topico_pai: 'Comportamento do sistema' },
  ];
}
