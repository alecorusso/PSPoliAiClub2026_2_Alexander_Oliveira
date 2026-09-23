// Integracao com a API do Google Gemini.
// A chave NUNCA e enviada ao cliente: todas as chamadas passam por aqui.
// Sem GEMINI_API_KEY definida, todas as funcoes retornam dados mock com atraso
// simulado e a aplicacao continua funcionando normalmente.

const CHAVE = process.env.GEMINI_API_KEY?.trim();
// 'gemini-flash-latest' acompanha o modelo flash atual. Versões fixas (como
// gemini-2.5-flash) são aposentadas com o tempo e passam a responder 404.
const MODELO = process.env.GEMINI_MODELO?.trim() || 'gemini-flash-latest';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const iaDisponivel = () => Boolean(CHAVE);
export const modeloEmUso = () => MODELO;

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

/** Status que costumam passar sozinhos: sobrecarga momentanea do modelo. */
const TRANSITORIOS = new Set([500, 502, 503, 504]);
const ESPERAS_MS = [800, 2500, 6000];

/**
 * Repete a chamada quando o modelo responde sobrecarregado. Nao repete 429
 * (cota estourada) nem 4xx de configuracao: nesses casos insistir nao ajuda.
 */
async function comNovaTentativa(fazerChamada) {
  let resposta = await fazerChamada();
  for (let i = 0; i < ESPERAS_MS.length && TRANSITORIOS.has(resposta.status); i++) {
    await espera(ESPERAS_MS[i]);
    resposta = await fazerChamada();
  }
  return resposta;
}

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

  const resposta = await comNovaTentativa(() =>
    fetch(`${BASE}/${MODELO}:generateContent?key=${CHAVE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
  );

  if (!resposta.ok) {
    const bruto = await resposta.text().catch(() => '');
    // O corpo de erro do Google e um JSON grande; a interface so precisa do motivo.
    let motivo = bruto.slice(0, 200);
    try {
      motivo = JSON.parse(bruto)?.error?.message ?? motivo;
    } catch {
      /* corpo nao era JSON */
    }
    // 404 aqui e quase sempre modelo aposentado: vale dizer o que fazer.
    if (resposta.status === 404) {
      throw new Error(
        `o modelo "${MODELO}" não está disponível para esta chave (${motivo.slice(0, 120)}). ` +
          'Ajuste GEMINI_MODELO no .env — "gemini-flash-latest" acompanha a versão atual.'
      );
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
  '- Títulos curtos, em português do Brasil, sem numeração.',
  '',
  // O peso alimenta a priorizacao do cronograma. Descrito como "importancia", o
  // modelo classificava quase tudo como alto ou medio e nunca usava baixo, o que
  // deixava a informacao inutil. Aqui ele e definido por esforco, ancorado nos
  // extremos do proprio conjunto e com distribuicao esperada.
  'Sobre o "peso":',
  '- O peso NÃO mede importância nem valor do tópico. Mede o esforço e o tempo de estudo que ele costuma exigir.',
  '- Um tópico pode ser fundamental para o assunto e ainda assim ter peso "baixo", se for rápido de dominar.',
  '- "baixo": resolve-se com uma leitura atenta ou um exemplo; pouca prática necessária.',
  '- "medio": exige alguns exercícios ou uma sessão dedicada para ficar seguro.',
  '- "alto": exige várias sessões, prática repetida ou articula muitos outros conceitos.',
  '',
  'Como atribuir o peso:',
  '1. Antes de classificar qualquer coisa, identifique no conjunto os tópicos MAIS exigentes e os MENOS exigentes.',
  '2. Use esses dois extremos como referência e classifique os demais por comparação relativa a eles, nunca julgando cada tópico isoladamente.',
  '3. A distribuição final deve se aproximar de 25% "alto", 50% "medio" e 25% "baixo". É esperado e correto que vários tópicos recebam peso "baixo"; classificar quase tudo como "alto" ou "medio" torna a informação inútil.',
  '4. A proporção é orientação, não regra rígida: um conjunto genuinamente homogêneo pode desviar dela. Mas em listas com mais de cinco tópicos, a categoria "baixo" nunca deve ficar vazia.',
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

/**
 * Tabela de conteudos a partir do material do bloco.
 * estruturado=true: o material traz, dos livros, so o SUMARIO e o inicio de
 * cada capitulo (nunca o livro inteiro), alem da ementa completa.
 */
export async function extrairTabelaConteudos(textoDocumentos, { estruturado = false } = {}) {
  if (!CHAVE) {
    await espera(1200);
    return { topicos: mockArvore('documentos enviados'), erro: null };
  }
  const texto = String(textoDocumentos || '').slice(0, 120000);
  if (!texto.trim()) {
    return { topicos: [], erro: 'Os documentos enviados não continham texto legível.' };
  }
  const orientacao = estruturado
    ? 'Extraia a tabela de conteúdos de estudo a partir do material abaixo. ' +
      'Dos livros e documentos longos vieram apenas o SUMÁRIO e o início de cada capítulo — o texto inteiro não foi enviado. ' +
      'Se houver EMENTA, ela define o escopo da disciplina: priorize os conteúdos que ela cobre e use os sumários para a estrutura e a terminologia. ' +
      'Sem ementa, use os sumários como estrutura principal. ' +
      'Não transforme em tópico o que é só parte do livro (prefácio, apêndices, respostas, tabelas, exercícios).'
    : 'Extraia a tabela de conteúdos de estudo a partir do material abaixo. ' +
      'Use a estrutura e a terminologia do próprio material.';
  return gerarArvore(`${orientacao}\n\n--- MATERIAL ---\n${texto}`);
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

/** Quando a fonte sao trechos: cada questao diz em qual trecho se apoia. */
const ESQUEMA_LISTA_TRECHOS = [
  'Responda APENAS com JSON puro, sem markdown, sem crases, sem preâmbulo e sem comentários.',
  'Formato exato:',
  '{"questoes":[{"numero":1,"enunciado":"texto da questão","trecho":"T1"}],"gabarito":[{"numero":1,"resposta":"resolução comentada"}]}',
  '',
  'Regras:',
  '- Gere exatamente a quantidade de questões pedida.',
  '- TODAS as questões devem avaliar o tópico indicado — e somente ele.',
  '- Use os trechos como referência de conteúdo, de notação e de nível de dificuldade.',
  '- Os trechos podem conter outros assuntos (o capítulo vizinho, um exemplo sobre outro tema). NÃO gere questões sobre esses outros assuntos, mesmo que apareçam nos trechos.',
  '- Em "trecho", indique o rótulo (T1, T2, ...) do trecho em que a questão se apoia.',
  '- Numere as questões de 1 em diante; o gabarito usa os mesmos números.',
  '- Cada "resposta" traz a resolução comentada, explicando o raciocínio, não apenas a alternativa.',
  '- Enunciados autocontidos, em português do Brasil: não escreva "segundo o trecho T2".',
  '- Não atribua pontuação, nota ou peso às questões.',
].join('\n');

function normalizarLista(bruto) {
  const extrair = (chave, campo, extra = () => ({})) =>
    (Array.isArray(bruto?.[chave]) ? bruto[chave] : [])
      .map((item, i) => ({
        numero: Number.isFinite(Number(item?.numero)) ? Number(item.numero) : i + 1,
        [campo]: String(item?.[campo] ?? '').trim(),
        ...extra(item),
      }))
      .filter((item) => item[campo]);

  return {
    questoes: extrair('questoes', 'enunciado', (item) =>
      item?.trecho ? { trecho: String(item.trecho).trim().toUpperCase() } : {}
    ),
    gabarito: extrair('gabarito', 'resposta'),
  };
}

/** "Regra da cadeia" (subtópicos: ...; dentro de: Derivadas) */
function descreverTopico(topico) {
  if (typeof topico === 'string') return `"${topico}"`;
  const partes = [`"${topico.titulo}"`];
  if (topico.subtopicos?.length) partes.push(`(inclui: ${topico.subtopicos.join('; ')})`);
  if (topico.pai) partes.push(`— parte de "${topico.pai}"`);
  return partes.join(' ');
}

const tituloDoTopico = (topico) => (typeof topico === 'string' ? topico : topico.titulo);

/** Rotulo e cabecalho de cada trecho enviado ao modelo. */
function blocoDoTrecho(t, i) {
  const onde = [
    t.nome,
    Number.isFinite(t.pagina_inicio)
      ? t.pagina_fim && t.pagina_fim !== t.pagina_inicio
        ? `pp. ${t.pagina_inicio}–${t.pagina_fim}`
        : `p. ${t.pagina_inicio}`
      : null,
    t.titulo_secao ? `seção "${t.titulo_secao}"` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `[T${i + 1}] (${onde})\n${t.texto}`;
}

/**
 * Gera uma lista de questoes.
 *
 * fonte:
 *   { tipo: 'documentos', trechos: [...] } — SO os trechos do topico, ja
 *       recuperados; nunca o documento inteiro;
 *   { tipo: 'internet' }                    — questoes buscadas na internet;
 *   { tipo: 'geral' }                       — conhecimento geral do modelo, usado
 *       so quando o usuario confirma que os documentos nao tratam do topico.
 * topico: titulo, ou { titulo, subtopicos, pai }.
 *
 * Com trechos, cada questao volta com "trecho" (o indice do trecho em que se apoia).
 */
export async function gerarListaQuestoes(fonte, topico, quantidade) {
  const qtd = Math.min(Math.max(Number(quantidade) || 5, 1), 20);
  const tipo = fonte?.tipo === 'internet' ? 'internet' : fonte?.tipo === 'geral' ? 'geral' : 'documentos';
  const trechos = Array.isArray(fonte?.trechos) ? fonte.trechos : [];

  if (tipo === 'documentos' && trechos.length === 0) {
    return { questoes: [], gabarito: [], erro: 'Nenhum trecho dos documentos foi encontrado para este tópico.' };
  }

  if (!CHAVE) {
    await espera(1400);
    return { ...mockLista(tituloDoTopico(topico), qtd, tipo, trechos), erro: null };
  }

  let instrucao = ESQUEMA_LISTA;
  let prompt;
  if (tipo === 'internet') {
    instrucao = `Busque na internet questões reais sobre o tema e adapte-as ao formato pedido.\n${ESQUEMA_LISTA}`;
    prompt = `Monte uma lista de ${qtd} questões sobre o tópico ${descreverTopico(topico)}. Use questões encontradas na internet como referência.`;
  } else if (tipo === 'geral') {
    prompt = `Monte uma lista de ${qtd} questões sobre o tópico ${descreverTopico(topico)}, a partir do conhecimento geral sobre o assunto, em nível de graduação.`;
  } else {
    instrucao = ESQUEMA_LISTA_TRECHOS;
    prompt =
      `Monte uma lista de ${qtd} questões que avaliem ESTE tópico específico: ${descreverTopico(topico)}.\n` +
      'Abaixo estão os trechos dos documentos do aluno que tratam do tópico. ' +
      'Use-os como referência de conteúdo, notação e nível; ignore os outros assuntos que aparecerem neles.\n\n' +
      trechos.map(blocoDoTrecho).join('\n\n---\n\n');
  }

  try {
    const texto = await chamar({
      instrucaoSistema: instrucao,
      conteudos: [{ role: 'user', parts: [{ text: prompt }] }],
      json: true,
      ferramentas: tipo === 'internet' ? [{ google_search: {} }] : null,
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

function mockLista(topico, qtd, tipo, trechos = []) {
  const origem =
    tipo === 'internet'
      ? 'a partir de uma busca na internet'
      : tipo === 'geral'
        ? 'a partir do conhecimento geral'
        : 'a partir dos trechos dos documentos';
  const questoes = [];
  const gabarito = [];
  for (let n = 1; n <= qtd; n++) {
    // No modo simulado, as questoes se apoiam nos trechos em rodizio — o
    // bastante para exercitar o caminho inteiro sem chave.
    const i = trechos.length ? (n - 1) % trechos.length : -1;
    const apoio = i >= 0 ? ` (apoiada em ${trechos[i].titulo_secao ?? 'um trecho'})` : '';
    questoes.push({
      numero: n,
      enunciado: `(simulado) Questão ${n} sobre "${topico}", gerada ${origem}${apoio}. Descreva e justifique sua resposta.`,
      ...(i >= 0 ? { trecho: `T${i + 1}` } : {}),
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

// ===========================================================================
// Estimativa de tempo de uma tarefa
// A sugestao e sempre um ponto de partida editavel: quem decide e o usuario.
// ===========================================================================
const ESQUEMA_ESTIMATIVA = [
  'Responda APENAS com JSON puro, sem markdown, sem crases e sem preâmbulo.',
  'Formato exato: {"minutos": 120, "justificativa": "uma frase curta"}',
  '',
  'Regras:',
  '- "minutos" é um inteiro entre 10 e 2400 (até 40 horas).',
  '- Estime o tempo de trabalho concentrado de um estudante de graduação.',
  '- A justificativa tem no máximo 15 palavras, descritiva e neutra.',
  '- Não avalie a pessoa, não motive, não cobre.',
].join('\n');

/**
 * Sugere quanto tempo uma tarefa deve levar, em minutos.
 * Nunca e um valor final: a interface entrega como campo editavel.
 */
export async function estimarTempoTarefa(descricao, tipo, contexto) {
  const texto = String(descricao || '').trim();
  if (!texto) return { minutos: null, justificativa: null, erro: 'Descreva a tarefa para receber uma sugestão.' };

  if (!CHAVE) {
    await espera(900);
    // Mock estavel: o mesmo texto sempre devolve o mesmo valor, para a
    // interface poder ser testada sem a chave.
    const base = 30 + (texto.length % 7) * 30;
    return {
      minutos: base,
      justificativa: `(simulado — sem GEMINI_API_KEY) estimativa de referência para "${tipo || 'tarefa'}".`,
      erro: null,
    };
  }

  const prompt = [
    `Tarefa: "${texto}"`,
    tipo ? `Tipo de tarefa: ${tipo}` : null,
    contexto ? `Contexto: ${contexto}` : null,
    'Quanto tempo de trabalho concentrado essa tarefa costuma levar?',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const saida = await chamar({
      instrucaoSistema: ESQUEMA_ESTIMATIVA,
      conteudos: [{ role: 'user', parts: [{ text: prompt }] }],
      json: true,
    });
    const dados = extrairJson(saida);
    const minutos = Math.round(Number(dados?.minutos));
    if (!Number.isFinite(minutos) || minutos <= 0) {
      return { minutos: null, justificativa: null, erro: 'A IA não retornou uma estimativa utilizável.' };
    }
    return {
      minutos: Math.min(Math.max(minutos, 10), 2400),
      justificativa: String(dados?.justificativa ?? '').trim() || null,
      erro: null,
    };
  } catch (e) {
    // Falha nunca bloqueia: faixa e tempo exato seguem disponiveis.
    return { minutos: null, justificativa: null, erro: `Não foi possível estimar (${e.message}).` };
  }
}

// ---------------------------------------------------------------------------
// 9. Extracao de eventos a partir de um documento (calendario de disciplina,
//    cronograma de curso, programacao)
//
// A IA propoe; quem confirma e o usuario, na tela de revisao. Por isso cada
// item volta com o trecho do documento de onde a data saiu e um grau de
// confianca: data incerta nunca e apresentada como certa.
// ---------------------------------------------------------------------------
const ESQUEMA_EVENTOS = [
  'Responda APENAS com JSON puro, sem markdown, sem crases, sem preâmbulo e sem comentários.',
  'Formato exato:',
  '{"eventos":[{"titulo":"string","data":"AAAA-MM-DD ou null","hora":"HH:MM ou null","tipo":"prova|entrega|aula|outro","trecho_origem":"string","confianca":"alta|baixa"}]}',
  '',
  'Regras:',
  '- Extraia apenas eventos PONTUAIS: provas, entregas, seminários, feriados, prazos.',
  '- "trecho_origem": o trecho curto do documento de onde a data foi tirada, copiado como está. É o que permite ao usuário conferir.',
  '- "titulo": curto, em português do Brasil, como aparece no documento.',
  '',
  'Sobre a data:',
  '- NUNCA invente data. Se um evento é mencionado sem data identificável, inclua-o com "data": null e confiança "baixa".',
  '- Quando o ano não estiver escrito no documento, infira o ano pelo período letivo mais provável em relação à data de hoje — e marque confiança "baixa", sempre.',
  '- Datas relativas ("semana 5", "aula 12") só podem ser resolvidas se o início do período letivo for informado; resolva a partir dele e marque confiança "baixa".',
  '',
  'Sobre a confiança:',
  '- "alta": a data está explícita e completa no documento, com dia, mês e ano.',
  '- "baixa": você inferiu o ano, converteu uma data relativa, ou o formato é ambíguo (03/04 pode ser 3 de abril ou 4 de março).',
  '- Na dúvida entre alta e baixa, use "baixa".',
].join('\n');

const TIPOS_EVENTO_EXTRAIDO = new Set(['prova', 'entrega', 'aula', 'outro']);

function mockEventos(contexto) {
  const base = contexto?.inicio_periodo || contexto?.hoje || new Date().toISOString().slice(0, 10);
  const mais = (dias) => {
    const d = new Date(base + 'T12:00:00');
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  return [
    {
      titulo: 'Prova 1',
      data: mais(30),
      hora: '14:00',
      tipo: 'prova',
      trecho_origem: '(modo simulado — sem GEMINI_API_KEY)',
      confianca: 'alta',
    },
    {
      titulo: 'Entrega do trabalho parcial',
      data: mais(45),
      hora: null,
      tipo: 'entrega',
      trecho_origem: '(modo simulado — sem GEMINI_API_KEY)',
      confianca: 'baixa',
    },
    {
      titulo: 'Seminário de encerramento',
      data: null,
      hora: null,
      tipo: 'outro',
      trecho_origem: '(modo simulado — data não identificada)',
      confianca: 'baixa',
    },
  ];
}

/**
 * Le um documento e devolve os eventos pontuais que ele menciona.
 *
 * @param {string} texto  conteudo do documento
 * @param {object} contexto  { hoje, inicio_periodo, bloco_nome, incluir_aulas }
 */
export async function extrairEventos(texto, contexto = {}) {
  const conteudo = String(texto || '').slice(0, 120000);

  if (!CHAVE) {
    await espera(1400);
    return { eventos: mockEventos(contexto), erro: null };
  }
  if (!conteudo.trim()) {
    return { eventos: [], erro: 'O documento não continha texto legível.' };
  }

  // Aulas regulares se repetem toda semana e encheriam o calendario de ruido:
  // so entram quando o usuario pede.
  const sobreAulas = contexto.incluir_aulas
    ? '- Inclua também as aulas regulares, uma entrada por data de aula identificada.'
    : '- NÃO extraia aulas regulares nem eventos recorrentes semanais. Apenas eventos pontuais.';

  const prompt = [
    `Hoje é ${contexto.hoje ?? new Date().toISOString().slice(0, 10)}.`,
    contexto.inicio_periodo
      ? `O período letivo começou em ${contexto.inicio_periodo}. Use essa data para resolver referências relativas como "semana 5" ou "aula 12".`
      : 'O início do período letivo não foi informado: referências relativas como "semana 5" não podem ser resolvidas e devem entrar com data nula.',
    contexto.bloco_nome ? `O documento é de: ${contexto.bloco_nome}.` : 'O documento não está ligado a uma disciplina específica.',
    sobreAulas,
    '',
    '--- DOCUMENTO ---',
    conteudo,
  ].join('\n');

  try {
    const resposta = await chamar({
      instrucaoSistema: ESQUEMA_EVENTOS,
      conteudos: [{ role: 'user', parts: [{ text: prompt }] }],
      json: true,
    });
    const bruto = extrairJson(resposta);
    const lista = Array.isArray(bruto?.eventos) ? bruto.eventos : [];

    const eventos = lista
      .map((e) => {
        const data = String(e?.data ?? '').trim();
        const hora = String(e?.hora ?? '').trim();
        const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null;
        return {
          titulo: String(e?.titulo ?? '').trim(),
          data: dataValida,
          hora: /^\d{2}:\d{2}$/.test(hora) ? hora : null,
          tipo: TIPOS_EVENTO_EXTRAIDO.has(e?.tipo) ? e.tipo : 'outro',
          trecho_origem: String(e?.trecho_origem ?? '').trim().slice(0, 300),
          // Sem data, a confianca nunca pode ser alta: nao ha o que conferir.
          confianca: e?.confianca === 'alta' && dataValida ? 'alta' : 'baixa',
        };
      })
      .filter((e) => e.titulo);

    if (eventos.length === 0) {
      return {
        eventos: [],
        erro: 'Nenhum evento com data foi identificado no documento. Você pode adicionar os eventos manualmente.',
      };
    }
    return { eventos, erro: null };
  } catch (e) {
    // Falha nunca bloqueia: o caminho manual continua disponivel.
    return {
      eventos: [],
      erro: `Não foi possível ler o documento automaticamente (${e.message}). Você pode adicionar os eventos manualmente.`,
    };
  }
}

// ---------------------------------------------------------------------------
// 10. Decomposicao de um roteiro de projeto em entregaveis
//
// A IA decompoe e estima; quem calcula as datas e o codigo. O modelo so informa
// data quando o proprio roteiro determina uma — e nunca inventa topico: escolhe
// entre os que a tabela de conteudos do bloco ja tem.
// ---------------------------------------------------------------------------
const ESQUEMA_ROTEIRO = [
  'Responda APENAS com JSON puro, sem markdown, sem crases, sem preâmbulo e sem comentários.',
  'Formato exato:',
  '{"entregaveis":[{"nome":"string","descricao":"string","tipo_tarefa":"string","tempo_estimado_min":numero,"topicos_ids":["string"],"data_fixa":"AAAA-MM-DD ou null","trecho_origem":"string"}],"topicos_sugeridos":["string"]}',
  '',
  'Regras:',
  '- Decomponha o projeto em entregáveis CONCRETOS e VERIFICÁVEIS — algo que se possa olhar e dizer se está pronto.',
  '- A lista deve vir ORDENADA na sequência em que faz sentido executar.',
  '- "descricao": uma ou duas frases sobre o que o entregável é.',
  '- "tempo_estimado_min": sua estimativa de esforço em minutos, um número inteiro.',
  '- "trecho_origem": o trecho curto do roteiro que deu origem ao entregável, copiado como está.',
  '',
  'Sobre os tópicos:',
  '- "topicos_ids": escolha APENAS entre os identificadores da lista de tópicos fornecida. NUNCA invente um identificador.',
  '- Se o entregável não se liga a nenhum tópico da lista, devolva uma lista vazia.',
  '- Se o roteiro exigir conhecimentos que NÃO estão na tabela de conteúdos, liste os títulos deles em "topicos_sugeridos", sem associá-los a entregável nenhum.',
  '',
  'Sobre as datas:',
  '- NÃO calcule datas. A distribuição ao longo do tempo é feita fora daqui.',
  '- "data_fixa": preencha SOMENTE quando o roteiro determinar explicitamente uma data para aquele entregável — entrega parcial, apresentação, checkpoint. Em todos os outros casos, null.',
  '- Nunca invente uma data que não esteja escrita no roteiro.',
  '',
  'Sobre o tipo de tarefa:',
  '- "tipo_tarefa": texto curto. Prefira reaproveitar um dos tipos que o usuário já usa, quando couber; só crie um novo se nenhum servir.',
].join('\n');

function mockRoteiro(topicos) {
  const ids = (Array.isArray(topicos) ? topicos : []).map((t) => t.id).filter(Boolean);
  return {
    entregaveis: [
      {
        nome: 'Levantamento de requisitos',
        descricao: 'Reunir e escrever o que o projeto precisa entregar. (modo simulado — sem GEMINI_API_KEY)',
        tipo_tarefa: 'documentação',
        tempo_estimado_min: 180,
        topicos_ids: ids.slice(0, 1),
        data_fixa: null,
        trecho_origem: '(modo simulado)',
      },
      {
        nome: 'Protótipo funcional',
        descricao: 'Primeira versão que roda de ponta a ponta. (modo simulado)',
        tipo_tarefa: 'implementação',
        tempo_estimado_min: 600,
        topicos_ids: ids.slice(0, 2),
        data_fixa: null,
        trecho_origem: '(modo simulado)',
      },
      {
        nome: 'Relatório final',
        descricao: 'Documento com método, resultados e conclusões. (modo simulado)',
        tipo_tarefa: 'relatório',
        tempo_estimado_min: 300,
        topicos_ids: [],
        data_fixa: null,
        trecho_origem: '(modo simulado)',
      },
    ],
    topicos_sugeridos: ['Controle de versão'],
  };
}

/**
 * Decompoe o roteiro de um projeto em entregaveis.
 *
 * @param {string} texto  roteiro do projeto
 * @param {Array} topicos  tabela de conteudos do bloco: { id, titulo, natureza }
 * @param {object} contexto  { hoje, inicio, fim, tipos_tarefa }
 */
export async function decomporRoteiro(texto, topicos, contexto = {}) {
  const conteudo = String(texto || '').slice(0, 120000);
  const lista = Array.isArray(topicos) ? topicos.filter((t) => t?.id && t?.titulo) : [];

  if (!CHAVE) {
    await espera(1600);
    return { ...mockRoteiro(lista), erro: null };
  }
  if (!conteudo.trim()) {
    return { entregaveis: [], topicos_sugeridos: [], erro: 'O roteiro não continha texto legível.' };
  }

  // Apelidos curtos no lugar dos UUIDs: identificador longo o modelo erra ao
  // copiar, e um id errado viraria associacao errada.
  const apelidos = new Map(lista.map((t, i) => [`t${i + 1}`, t.id]));
  const catalogo = lista
    .map((t, i) => `t${i + 1} — ${t.titulo}${t.natureza ? ` (${t.natureza})` : ''}`)
    .join('\n');

  const tipos = (Array.isArray(contexto.tipos_tarefa) ? contexto.tipos_tarefa : []).filter(Boolean);

  const prompt = [
    `Hoje é ${contexto.hoje ?? new Date().toISOString().slice(0, 10)}.`,
    contexto.inicio && contexto.fim
      ? `O projeto vai de ${contexto.inicio} até a entrega final em ${contexto.fim}.`
      : '',
    lista.length
      ? `Tópicos da tabela de conteúdos deste bloco (use estes identificadores em "topicos_ids"):\n${catalogo}`
      : 'O bloco ainda não tem tabela de conteúdos: devolva "topicos_ids" vazio em todos os entregáveis.',
    tipos.length ? `Tipos de tarefa que o usuário já usa: ${tipos.join(', ')}.` : '',
    '',
    '--- ROTEIRO DO PROJETO ---',
    conteudo,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const resposta = await chamar({
      instrucaoSistema: ESQUEMA_ROTEIRO,
      conteudos: [{ role: 'user', parts: [{ text: prompt }] }],
      json: true,
    });
    const bruto = extrairJson(resposta);
    const propostos = Array.isArray(bruto?.entregaveis) ? bruto.entregaveis : [];

    const entregaveis = propostos
      .map((e) => {
        const data = String(e?.data_fixa ?? '').trim();
        const minutos = Number(e?.tempo_estimado_min);
        return {
          nome: String(e?.nome ?? '').trim(),
          descricao: String(e?.descricao ?? '').trim(),
          tipo_tarefa: String(e?.tipo_tarefa ?? '').trim() || null,
          tempo_estimado_min: Number.isFinite(minutos) && minutos > 0 ? Math.round(minutos) : null,
          // Topico inventado e descartado aqui: so passa o que existe no bloco.
          topicos_ids: (Array.isArray(e?.topicos_ids) ? e.topicos_ids : [])
            .map((t) => apelidos.get(String(t).trim()))
            .filter(Boolean),
          data_fixa: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : null,
          trecho_origem: String(e?.trecho_origem ?? '').trim().slice(0, 300),
        };
      })
      .filter((e) => e.nome);

    const topicos_sugeridos = (Array.isArray(bruto?.topicos_sugeridos) ? bruto.topicos_sugeridos : [])
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 12);

    if (entregaveis.length === 0) {
      return {
        entregaveis: [],
        topicos_sugeridos,
        erro: 'Não foi possível decompor o roteiro em entregáveis. Você pode criá-los manualmente.',
      };
    }
    return { entregaveis, topicos_sugeridos, erro: null };
  } catch (e) {
    // Falha nunca bloqueia: "Novo entregável" e "Sugerir entregáveis" continuam.
    return {
      entregaveis: [],
      topicos_sugeridos: [],
      erro: `Não foi possível ler o roteiro automaticamente (${e.message}). Você pode criar os entregáveis manualmente.`,
    };
  }
}

// ===========================================================================
// Embeddings dos trechos de documentos
//
// Gerados UMA vez por documento, na indexacao, e guardados no banco. Nunca
// recalculados a cada lista: na geracao so a consulta ganha um embedding.
// ===========================================================================
const MODELO_EMBEDDING = process.env.GEMINI_MODELO_EMBEDDING?.trim() || 'gemini-embedding-001';
/** Dimensao pedida ao modelo: 768 guarda bem a relacao e ocupa 1/4 do padrao. */
export const DIMENSOES_EMBEDDING = 768;
/**
 * Trechos por chamada. Pequeno de proposito: o limite da API e por tokens por
 * minuto, e um lote de 16 trechos (~27 mil tokens) estourava sozinho no plano
 * gratuito. Com 6, cada chamada fica perto de 10 mil tokens.
 */
export const LOTE_EMBEDDING = 6;
/**
 * O modelo aceita ~2.000 tokens por texto; 1.200 palavras ficam abaixo disso.
 * Mudar isto muda a representacao: o LIMIAR_COSSENO foi calibrado com 1.200.
 */
const PALAVRAS_POR_EMBEDDING = 1200;
/** 429 (limite) e 5xx (sobrecarga) passam com o tempo: espera crescente. */
const STATUS_ESPERAR = new Set([429, 500, 502, 503, 504]);
export const ESPERAS_EMBEDDING_MS = [2000, 4000, 8000, 16000, 32000, 64000, 64000];

/**
 * Cota DIARIA esgotada: insistir nao adianta ate o dia virar. Os embeddings
 * ficam pausados por um tempo, e os documentos seguem pela busca por
 * palavras-chave sem esperar o backoff inteiro a cada um.
 */
const PAUSA_COTA_DIARIA_MS = 60 * 60 * 1000;
let embeddingsPausadosAte = 0;
export const embeddingsPausados = () => Date.now() < embeddingsPausadosAte;

export const modeloDeEmbedding = () => MODELO_EMBEDDING;

const cortarPalavras = (texto, n) => (String(texto).match(/\S+/g) ?? []).slice(0, n).join(' ');

/** Espera sugerida pelo proprio Google ("retryDelay": "37s"), quando vem. */
function esperaSugerida(bruto) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(bruto);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

/**
 * Chamada com espera crescente (backoff exponencial) para 429 e 5xx. Devolve
 * o JSON da resposta ou lanca um erro com o motivo, depois de esgotar as
 * tentativas. aoEsperar(ms, status) permite mostrar que esta aguardando.
 */
async function comEspera(fazerChamada, { esperas = ESPERAS_EMBEDDING_MS, aoEsperar } = {}) {
  for (let tentativa = 0; ; tentativa++) {
    const resposta = await fazerChamada();
    if (resposta.ok) return resposta.json();
    const bruto = await resposta.text().catch(() => '');
    const cotaDiaria = resposta.status === 429 && /PerDay/i.test(bruto);
    if (cotaDiaria) embeddingsPausadosAte = Date.now() + PAUSA_COTA_DIARIA_MS;
    if (STATUS_ESPERAR.has(resposta.status) && tentativa < esperas.length && !cotaDiaria) {
      const ms = Math.max(esperas[tentativa], esperaSugerida(bruto) ?? 0);
      aoEsperar?.(ms, resposta.status);
      await espera(ms);
      continue;
    }
    let motivo = bruto.slice(0, 200);
    try {
      motivo = JSON.parse(bruto)?.error?.message ?? motivo;
    } catch {
      /* corpo nao era JSON */
    }
    const erro = new Error(
      cotaDiaria
        ? 'a cota diária de embeddings da API acabou'
        : `Gemini respondeu ${resposta.status}: ${String(motivo).slice(0, 160)}`
    );
    erro.status = resposta.status;
    throw erro;
  }
}

/**
 * Embeddings de varios textos, em uma chamada de lote.
 * tarefa: 'RETRIEVAL_DOCUMENT' para trechos, 'RETRIEVAL_QUERY' para a consulta.
 */
export async function gerarEmbeddings(textos, { tarefa = 'RETRIEVAL_DOCUMENT', aoEsperar, esperas } = {}) {
  if (!CHAVE) throw new Error('Sem GEMINI_API_KEY: os embeddings não estão disponíveis.');
  if (embeddingsPausados()) throw new Error('a cota diária de embeddings da API acabou');
  const modelo = `models/${MODELO_EMBEDDING}`;
  const dados = await comEspera(
    () =>
      fetch(`${BASE}/${MODELO_EMBEDDING}:batchEmbedContents?key=${CHAVE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: textos.map((t) => ({
            model: modelo,
            content: { parts: [{ text: cortarPalavras(t, PALAVRAS_POR_EMBEDDING) || '(vazio)' }] },
            taskType: tarefa,
            outputDimensionality: DIMENSOES_EMBEDDING,
          })),
        }),
      }),
    { aoEsperar, esperas }
  );
  const vetores = (dados?.embeddings ?? []).map((e) => e?.values);
  if (vetores.length !== textos.length || vetores.some((v) => !Array.isArray(v) || v.length === 0)) {
    throw new Error('Gemini devolveu embeddings incompletos.');
  }
  return vetores;
}

/**
 * Embedding da consulta de um topico. Qualquer falha devolve null: a busca cai
 * para palavras-chave e a geracao segue, nunca trava.
 */
export async function embeddingDaConsulta(texto) {
  if (!CHAVE || embeddingsPausados()) return null;
  try {
    const [v] = await gerarEmbeddings([texto], { tarefa: 'RETRIEVAL_QUERY', esperas: [1500, 4000] });
    return v;
  } catch (e) {
    console.warn('[embedding] consulta sem vetor, usando palavras-chave:', e.message);
    return null;
  }
}
