// Recuperacao dos trechos relevantes a um topico.
//
// A geracao de listas manda ao modelo SO os trechos que tratam do topico. Com
// embeddings, a relevancia e a similaridade de cosseno; sem eles (sem chave, ou
// indexacao incompleta), e uma busca por palavras-chave (BM25 simples).
//
// Modulo puro — sem banco, sem rede — para poder ser testado isoladamente.

/** Quantos trechos, no maximo, vao para o modelo. */
export const TRECHOS_POR_LISTA = 8;
/** Teto de tamanho somado dos trechos enviados, em caracteres. */
export const TETO_CARACTERES = 70000;
/**
 * Similaridade minima para um trecho contar como "sobre o topico" quando ha
 * embeddings. Abaixo disso, o trecho so entra se tambem passar no criterio de
 * palavras-chave.
 *
 * Calibrado com trechos reais (gemini-embedding-001, 768 dimensoes, 120
 * trechos de Eletromagnetismo): a melhor similaridade dos 20 topicos do bloco
 * ficou entre 0,682 e 0,812; a de assuntos de fora (fotossintese, distribuicao
 * binomial, regra da cadeia...), entre 0,606 e 0,656.
 */
export const LIMIAR_COSSENO = 0.67;
/**
 * Com embeddings, as palavras-chave so resgatam trechos PERTO do limiar: um
 * livro de Eletromagnetismo que cita "amostragem" de passagem (cosseno 0,60)
 * nao pode fazer uma lista de Estatistica parecer tratada pelos documentos.
 */
const MARGEM_PALAVRAS = 0.05;
/**
 * Fracao minima dos termos do TITULO do topico que precisa aparecer num trecho
 * para ele contar como relevante na busca por palavras-chave.
 */
export const COBERTURA_MINIMA = 0.5;
/**
 * Trechos que sao o sumario impresso do livro, tabelas numericas ou listas de
 * respostas mencionam todos os termos e nao ensinam nada: ficam de fora.
 * Medido em livros reais — nas paginas de sumario o padrao "327 11.7 Titulo"
 * aparece ~3 vezes a cada 100 palavras; no corpo do texto, menos de 0,2.
 */
const LIMIAR_PADRAO_SUMARIO = 1.0; // ocorrencias por 100 palavras
const LIMIAR_DENSIDADE_NUMEROS = 0.5; // numeros por palavra

/** Pagina de sumario, tabela numerica ou lista de respostas. */
export function pareceIndiceOuTabela(texto) {
  const palavras = (String(texto).match(/\S+/g) ?? []).length || 1;
  const sumario = (texto.match(/\b\d{1,3}\s+(\d{1,2}(\.\d{1,2})+|Cap[ií]tulo \d+)\s+[A-ZÀ-Ú]/g) ?? []).length;
  const numeros = (texto.match(/\b\d+\b/g) ?? []).length;
  return (sumario / palavras) * 100 > LIMIAR_PADRAO_SUMARIO || numeros / palavras > LIMIAR_DENSIDADE_NUMEROS;
}

/** Bonus de pontuacao para trechos dentro do capitulo que o sumario indica. */
const BONUS_CAPITULO = 0.3;

// Parametros classicos do BM25.
const K1 = 1.2;
const B = 0.75;

const PALAVRAS_VAZIAS = new Set(
  (
    'a o e é de da do das dos em no na nos nas um uma uns umas para por pelo pela pelos pelas com sem ' +
    'que se ao aos à às ou como mais menos seu sua seus suas ele ela eles elas isso isto este esta esse essa ' +
    'entre sobre até após também já não sim ser são foi era há tem ter the of and in to for on with by an is ' +
    'are from at as be this that it or its introdução capítulo seção parte exemplo exemplos problemas'
  ).split(' ')
);

const semAcento = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Termos de busca: minusculas, sem acento, sem palavras vazias, e com um
 * radical grosseiro (os 6 primeiros caracteres) para "derivada", "derivadas"
 * e "derivação" se encontrarem.
 */
export function termos(texto) {
  return (semAcento(String(texto ?? '').toLowerCase()).match(/[a-z0-9]+/g) ?? [])
    .filter((p) => p.length >= 3 && !PALAVRAS_VAZIAS.has(p))
    .map((p) => (p.length > 6 ? p.slice(0, 6) : p));
}

/** Similaridade de cosseno entre dois vetores. */
export function cosseno(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let prod = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    prod += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? prod / Math.sqrt(na * nb) : 0;
}

/**
 * BM25 da consulta contra cada trecho. Os termos do titulo do topico valem em
 * dobro: os subtopicos e o pai so ajudam a ordenar.
 */
export function pontuarBM25(trechos, termosConsulta, pesos = new Map()) {
  const docs = trechos.map((t) => termos(t.texto));
  const N = docs.length || 1;
  const media = docs.reduce((s, d) => s + d.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

  const unicos = [...new Set(termosConsulta)];
  return docs.map((d) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let soma = 0;
    for (const t of unicos) {
      const f = tf.get(t);
      if (!f) continue;
      const n = df.get(t) ?? 0;
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
      soma += (pesos.get(t) ?? 1) * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / media)));
    }
    return soma;
  });
}

/** Fracao dos termos do titulo presentes no texto. */
export function cobertura(texto, termosTitulo) {
  const unicos = [...new Set(termosTitulo)];
  if (unicos.length === 0) return 0;
  const presentes = new Set(termos(texto));
  return unicos.filter((t) => presentes.has(t)).length / unicos.length;
}

/**
 * Faixas de paginas do sumario que tratam do topico: entradas cujo titulo cobre
 * os termos do titulo do topico. A faixa vai ate a proxima entrada de mesmo
 * nivel ou mais rasa.
 */
export function capitulosDoTopico(sumario, termosTitulo) {
  const entradas = (sumario ?? []).filter((s) => Number.isFinite(s.pagina));
  const faixas = [];
  entradas.forEach((e, i) => {
    if (cobertura(e.titulo, termosTitulo) < COBERTURA_MINIMA) return;
    const seguinte = entradas.slice(i + 1).find((x) => (x.nivel ?? 0) <= (e.nivel ?? 0));
    faixas.push({ titulo: e.titulo, de: e.pagina, ate: seguinte ? Math.max(e.pagina, seguinte.pagina - 1) : Infinity });
  });
  return faixas;
}

const dentroDe = (t, faixas) =>
  faixas.some(
    (f) =>
      Number.isFinite(t.pagina_inicio) &&
      t.pagina_inicio <= f.ate &&
      (t.pagina_fim ?? t.pagina_inicio) >= f.de
  );

/**
 * Escolhe os trechos a enviar ao modelo.
 *
 * trechos: [{ id, documento_id, texto, pagina_inicio, pagina_fim, titulo_secao, embedding? }]
 * consulta: { titulo, subtopicos: string[], pai: string|null }
 * vetorConsulta: embedding da consulta (ou null para usar BM25)
 * sumarios: Map documento_id -> sumario
 *
 * Devolve { selecionados, metodo, relevantes } — relevantes=false quando
 * nenhum trecho atinge a relevancia minima (e selecionados vem vazio).
 */
export function selecionarTrechos({
  trechos,
  consulta,
  vetorConsulta = null,
  sumarios = new Map(),
  limite = TRECHOS_POR_LISTA,
  teto = TETO_CARACTERES,
}) {
  if (!trechos.length) return { selecionados: [], metodo: 'nenhum', relevantes: false };

  const termosTitulo = termos(consulta.titulo);
  const termosResto = termos([...(consulta.subtopicos ?? []), consulta.pai ?? ''].join(' '));
  const pesos = new Map();
  for (const t of termosResto) pesos.set(t, 1);
  for (const t of termosTitulo) pesos.set(t, 2);

  const usarVetor = Boolean(vetorConsulta) && trechos.every((t) => Array.isArray(t.embedding));
  const bm25 = pontuarBM25(trechos, [...termosTitulo, ...termosResto], pesos);
  const maxBm25 = Math.max(...bm25, 0) || 1;

  const faixasPorDoc = new Map();
  for (const [docId, sumario] of sumarios) faixasPorDoc.set(docId, capitulosDoTopico(sumario, termosTitulo));

  const avaliados = trechos.map((t, i) => {
    const cob = cobertura(`${t.titulo_secao ?? ''} ${t.texto}`, termosTitulo);
    const porPalavras = cob >= COBERTURA_MINIMA && bm25[i] > 0;
    const sim = usarVetor ? cosseno(vetorConsulta, t.embedding) : null;
    const relevante = usarVetor
      ? sim >= LIMIAR_COSSENO || (porPalavras && sim >= LIMIAR_COSSENO - MARGEM_PALAVRAS)
      : porPalavras;
    const noCapitulo = dentroDe(t, faixasPorDoc.get(t.documento_id) ?? []);
    const base = usarVetor ? sim : bm25[i] / maxBm25;
    return { ...t, relevancia: base + (noCapitulo ? BONUS_CAPITULO : 0), relevante, noCapitulo, similaridade: sim, bm25: bm25[i] };
  });

  const candidatos = avaliados
    .filter((t) => t.relevante && !pareceIndiceOuTabela(t.texto))
    .sort((a, b) => b.relevancia - a.relevancia);
  const selecionados = [];
  let soma = 0;
  for (const t of candidatos) {
    if (selecionados.length >= limite) break;
    if (soma + t.texto.length > teto && selecionados.length > 0) continue;
    selecionados.push(t);
    soma += t.texto.length;
  }
  return {
    selecionados,
    metodo: usarVetor ? 'embeddings' : 'palavras',
    relevantes: selecionados.length > 0,
  };
}

/** Texto da consulta usado para o embedding: topico, subtopicos e pai. */
export function textoDaConsulta(consulta) {
  return [consulta.titulo, ...(consulta.subtopicos ?? []), consulta.pai ?? ''].filter(Boolean).join('; ');
}

/** Paginas vizinhas ate esta distancia viram uma faixa so. */
const FOLGA_ENTRE_FAIXAS = 2;

/**
 * Paginas de origem agrupadas por documento, para exibir discretamente:
 * [{ documento_id, nome, faixas: [{ de, ate }] }] — faixas proximas se fundem,
 * distantes ficam separadas ("paginas 112–130 e 245–250").
 */
export function paginasDeOrigem(trechos, nomes = new Map()) {
  const porDoc = new Map();
  for (const t of trechos) {
    const item = porDoc.get(t.documento_id) ?? {
      documento_id: t.documento_id,
      nome: nomes.get(t.documento_id) ?? null,
      faixas: [],
    };
    if (Number.isFinite(t.pagina_inicio)) {
      item.faixas.push({ de: t.pagina_inicio, ate: Number.isFinite(t.pagina_fim) ? t.pagina_fim : t.pagina_inicio });
    }
    porDoc.set(t.documento_id, item);
  }
  for (const item of porDoc.values()) {
    const ordenadas = item.faixas.sort((a, b) => a.de - b.de);
    const fundidas = [];
    for (const f of ordenadas) {
      const ultima = fundidas[fundidas.length - 1];
      if (ultima && f.de <= ultima.ate + FOLGA_ENTRE_FAIXAS) ultima.ate = Math.max(ultima.ate, f.ate);
      else fundidas.push({ ...f });
    }
    item.faixas = fundidas;
  }
  return [...porDoc.values()];
}

// A frase "Baseada nas paginas ..." e escrita igual no servidor e no cliente.
export { textoDaOrigem } from '../client/src/lib/origem.js';
