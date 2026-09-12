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
async function chamar({ instrucaoSistema, conteudos, json = false, ferramentas = null }) {
  // A API nao aceita responseMimeType junto com ferramentas; nesses casos o JSON
  // vem em texto e e recuperado por extrairJson().
  const pedirJsonNativo = json && !ferramentas;
  const corpo = {
    contents: conteudos,
    generationConfig: pedirJsonNativo
      ? { temperature: 0.3, responseMimeType: 'application/json' }
      : { temperature: json ? 0.3 : 0.7 },
  };
  if (ferramentas) corpo.tools = ferramentas;
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

// ===========================================================================
// Chat lateral do bloco
// ===========================================================================
const REGRAS_BLOCO = [
  'Você é um assistente de estudos conversando em português do Brasil dentro de um bloco de estudo.',
  'Você NUNCA emite nota, score, porcentagem, nível de domínio ou contagem de acertos, e nunca diz "aprovado" ou "reprovado".',
  'Você NUNCA marca nem sugere marcar tópicos, listas ou entregáveis como concluídos. Essas decisões são exclusivas do usuário e acontecem fora da conversa.',
  'Você não usa gamificação, elogios motivacionais, streaks ou cobrança.',
  'Ao corrigir respostas, seja descritivo: aponte o que está incompleto ou incorreto e explique o porquê, sem atribuir pontuação nem veredito final.',
  'Use linguagem neutra e informativa, concisa, em texto corrido simples.',
].join(' ');

const MODOS_VALIDOS = new Set(['prova', 'projeto', 'aprendizagem']);

/**
 * Conversa do chat lateral do bloco.
 * O unico contexto enviado alem do historico e o rotulo do modo ativo.
 */
export async function conversarBloco(historico, modo) {
  const rotulo = MODOS_VALIDOS.has(modo) ? modo : 'aprendizagem';

  if (!CHAVE) {
    await espera(700);
    return mockChatBloco(historico, rotulo);
  }

  const conteudos = historico.map((m) => ({
    role: m.papel === 'assistente' ? 'model' : 'user',
    parts: [{ text: m.conteudo }],
  }));
  while (conteudos.length && conteudos[0].role === 'model') conteudos.shift();
  if (conteudos.length === 0) {
    conteudos.push({ role: 'user', parts: [{ text: 'Olá.' }] });
  }

  return chamar({
    instrucaoSistema: `${REGRAS_BLOCO}\nContexto do modo ativo: ${rotulo}.`,
    conteudos,
  });
}

function mockChatBloco(historico, rotulo) {
  const ultima = [...historico].reverse().find((m) => m.papel === 'usuario');
  const prefixo = '(modo simulado — sem GEMINI_API_KEY)\n\n';
  if (!ultima) {
    return `${prefixo}Chat do bloco, modo ${rotulo}. Escreva o que quiser discutir.`;
  }
  return (
    `${prefixo}Modo ativo: ${rotulo}. Recebi sua mensagem de ${ultima.conteudo.length} caracteres. ` +
    'Com a chave do Gemini configurada, aqui viria a resposta do modelo.'
  );
}

// ===========================================================================
// Listas de questoes
// ===========================================================================
const ESQUEMA_LISTA = [
  'Responda APENAS com JSON puro, sem markdown, sem crases, sem preâmbulo e sem comentários.',
  'Formato exato:',
  '{"questoes":[{"numero":1,"enunciado":"texto da questão"}],"gabarito":[{"numero":1,"resposta":"resolução comentada"}]}',
  '',
  'Regras:',
  '- Gere exatamente a quantidade de questões pedida.',
  '- Numere as questões de 1 em diante; o gabarito usa os mesmos números.',
  '- Cada "resposta" traz a resolução comentada, explicando o raciocínio, não apenas a alternativa.',
  '- Enunciados autocontidos, em português do Brasil.',
  '- Não atribua pontuação, nota ou peso às questões.',
].join('\n');

function normalizarLista(bruto) {
  const extrair = (chave, campo) =>
    (Array.isArray(bruto?.[chave]) ? bruto[chave] : [])
      .map((item, i) => ({
        numero: Number.isFinite(Number(item?.numero)) ? Number(item.numero) : i + 1,
        [campo]: String(item?.[campo] ?? '').trim(),
      }))
      .filter((item) => item[campo]);

  return { questoes: extrair('questoes', 'enunciado'), gabarito: extrair('gabarito', 'resposta') };
}

/**
 * Gera uma lista de questoes.
 * fonte: { tipo: 'documentos' | 'internet', texto?: string }
 */
export async function gerarListaQuestoes(fonte, topico, quantidade) {
  const qtd = Math.min(Math.max(Number(quantidade) || 5, 1), 20);
  const daInternet = fonte?.tipo === 'internet';

  if (!CHAVE) {
    await espera(1400);
    return { ...mockLista(topico, qtd, daInternet), erro: null };
  }

  if (!daInternet && !String(fonte?.texto || '').trim()) {
    return { questoes: [], gabarito: [], erro: 'Os documentos selecionados não continham texto legível.' };
  }

  const instrucao = daInternet
    ? `Busque na internet questões reais sobre o tema e adapte-as ao formato pedido.\n${ESQUEMA_LISTA}`
    : ESQUEMA_LISTA;

  const prompt = daInternet
    ? `Monte uma lista de ${qtd} questões sobre o tópico "${topico}". Use questões encontradas na internet como referência.`
    : `Monte uma lista de ${qtd} questões sobre o tópico "${topico}", baseada ESTRITAMENTE no material abaixo.\n\n--- MATERIAL ---\n${String(fonte?.texto || '').slice(0, 120000)}`;

  try {
    const texto = await chamar({
      instrucaoSistema: instrucao,
      conteudos: [{ role: 'user', parts: [{ text: prompt }] }],
      json: true,
      ferramentas: daInternet ? [{ google_search: {} }] : null,
    });
    const { questoes, gabarito } = normalizarLista(extrairJson(texto));
    if (questoes.length === 0) {
      return {
        questoes: [],
        gabarito: [],
        erro: 'A IA não retornou questões utilizáveis. Você pode enviar uma lista manualmente.',
      };
    }
    return { questoes, gabarito, erro: null };
  } catch (e) {
    // Falha nunca bloqueia a tela: "Enviar lista" continua disponivel.
    return {
      questoes: [],
      gabarito: [],
      erro: `Não foi possível gerar a lista (${e.message}). Você pode enviar uma lista manualmente.`,
    };
  }
}

function mockLista(topico, qtd, daInternet) {
  const origem = daInternet ? 'a partir de uma busca na internet' : 'a partir dos documentos';
  const questoes = [];
  const gabarito = [];
  for (let n = 1; n <= qtd; n++) {
    questoes.push({
      numero: n,
      enunciado: `(simulado) Questão ${n} sobre "${topico}", gerada ${origem}. Descreva e justifique sua resposta.`,
    });
    gabarito.push({
      numero: n,
      resposta: `(simulado) Resolução comentada da questão ${n}. Com a chave do Gemini configurada, aqui viria a resolução real.`,
    });
  }
  return { questoes, gabarito };
}

/** Gera o gabarito de uma lista enviada pelo usuario sem gabarito. */
export async function gerarGabarito(questoes) {
  const texto = Array.isArray(questoes)
    ? questoes.map((q) => `${q.numero}. ${q.enunciado}`).join('\n')
    : String(questoes || '');

  if (!texto.trim()) {
    return { gabarito: [], erro: 'A lista enviada não continha texto legível.' };
  }

  if (!CHAVE) {
    await espera(1200);
    const linhas = texto.split('\n').filter((l) => l.trim()).slice(0, 20);
    return {
      gabarito: linhas.map((_, i) => ({
        numero: i + 1,
        resposta: `(simulado) Resolução comentada da questão ${i + 1}. Com a chave do Gemini configurada, aqui viria a resolução real.`,
      })),
      erro: null,
    };
  }

  const esquema = [
    'Responda APENAS com JSON puro, sem markdown, sem crases e sem preâmbulo.',
    'Formato exato: {"gabarito":[{"numero":1,"resposta":"resolução comentada"}]}',
    'Uma entrada por questão da lista, na mesma numeração. Cada resposta explica o raciocínio.',
    'Não atribua nota, pontuação ou percentual.',
  ].join('\n');

  try {
    const saida = await chamar({
      instrucaoSistema: esquema,
      conteudos: [{ role: 'user', parts: [{ text: `Resolva as questões abaixo.\n\n${texto.slice(0, 120000)}` }] }],
      json: true,
    });
    const { gabarito } = normalizarLista(extrairJson(saida));
    if (gabarito.length === 0) {
      return { gabarito: [], erro: 'A IA não retornou um gabarito utilizável. A lista foi salva sem gabarito.' };
    }
    return { gabarito, erro: null };
  } catch (e) {
    // A lista e salva mesmo assim, sem gabarito.
    return { gabarito: [], erro: `Não foi possível gerar o gabarito (${e.message}). A lista foi salva sem ele.` };
  }
}

// ===========================================================================
// Sugestao de entregaveis (Modo Projeto)
// ===========================================================================
const ESQUEMA_ENTREGAVEIS = [
  'Responda APENAS com JSON puro, sem markdown, sem crases, sem preâmbulo e sem comentários.',
  'Formato exato:',
  '{"entregaveis":[{"titulo":"string","descricao":"string","ferramentas":"lista curta separada por vírgula","tempo_estimado_horas":8,"topicos":["título de tópico existente"]}]}',
  '',
  'Regras:',
  '- Entre 3 e 6 entregáveis, do mais fundamental ao mais avançado.',
  '- "topicos" deve conter apenas títulos que aparecem exatamente na lista de tópicos informada; use [] se nenhum se aplicar.',
  '- "tempo_estimado_horas" é um número inteiro de horas.',
  '- Títulos curtos e concretos, em português do Brasil.',
  '- Não atribua nota, pontuação, dificuldade numérica ou percentual.',
].join('\n');

export async function sugerirEntregaveis(descricao, topicos) {
  const titulos = (Array.isArray(topicos) ? topicos : [])
    .map((t) => String(t?.titulo ?? t))
    .filter(Boolean);

  if (!CHAVE) {
    await espera(1400);
    return { entregaveis: mockEntregaveis(descricao, titulos), erro: null };
  }

  if (!String(descricao || '').trim()) {
    return { entregaveis: [], erro: 'Descreva a expectativa do projeto para receber sugestões.' };
  }

  const prompt = [
    `Projeto descrito pelo usuário: "${String(descricao).trim()}"`,
    titulos.length ? `Tópicos disponíveis no bloco:\n- ${titulos.join('\n- ')}` : 'O bloco ainda não tem tópicos.',
    'Proponha os entregáveis do projeto.',
  ].join('\n\n');

  try {
    const texto = await chamar({
      instrucaoSistema: ESQUEMA_ENTREGAVEIS,
      conteudos: [{ role: 'user', parts: [{ text: prompt }] }],
      json: true,
    });
    const bruto = extrairJson(texto);
    const lista = Array.isArray(bruto?.entregaveis) ? bruto.entregaveis : [];
    const conhecidos = new Map(titulos.map((t) => [t.toLowerCase(), t]));

    const entregaveis = lista
      .map((e) => ({
        titulo: String(e?.titulo ?? '').trim(),
        descricao: String(e?.descricao ?? '').trim(),
        ferramentas: String(e?.ferramentas ?? '').trim(),
        tempo_estimado_horas: Number.isFinite(Number(e?.tempo_estimado_horas))
          ? Number(e.tempo_estimado_horas)
          : null,
        topicos: (Array.isArray(e?.topicos) ? e.topicos : [])
          .map((t) => conhecidos.get(String(t).trim().toLowerCase()))
          .filter(Boolean),
      }))
      .filter((e) => e.titulo);

    if (entregaveis.length === 0) {
      return {
        entregaveis: [],
        erro: 'A IA não retornou sugestões utilizáveis. Você pode criar os entregáveis manualmente.',
      };
    }
    return { entregaveis, erro: null };
  } catch (e) {
    return {
      entregaveis: [],
      erro: `Não foi possível gerar sugestões (${e.message}). Você pode criar os entregáveis manualmente.`,
    };
  }
}

function mockEntregaveis(descricao, titulos) {
  const alvo = String(descricao || 'o projeto').trim().slice(0, 60);
  const fatia = (i, n) => titulos.slice(i, i + n);
  return [
    {
      titulo: `Levantamento de requisitos — ${alvo}`,
      descricao: '(simulado) Reunir o que o projeto precisa entregar e delimitar o escopo.',
      ferramentas: 'documento de texto',
      tempo_estimado_horas: 4,
      topicos: fatia(0, 2),
    },
    {
      titulo: 'Protótipo funcional',
      descricao: '(simulado) Construir a primeira versão executável, ainda sem refinamento.',
      ferramentas: 'editor de código, controle de versão',
      tempo_estimado_horas: 12,
      topicos: fatia(2, 2),
    },
    {
      titulo: 'Versão final e documentação',
      descricao: '(simulado) Fechar a implementação e registrar como usar e manter.',
      ferramentas: 'editor de código, gerador de documentação',
      tempo_estimado_horas: 8,
      topicos: fatia(4, 2),
    },
  ];
}
