// O que cada fluxo manda de fato para o modelo.
//
// O tamanho que importa e o do conteudo ENVIADO, nunca o do documento bruto:
// um livro de 990 mil caracteres vira ~30 mil na tabela de conteudos (sumario
// e inicios de capitulo) e alguns trechos numa lista. O tamanho nunca bloqueia
// nada: quando o conteudo passa do teto, o proprio fluxo reduz (documentos
// longos viram sumario + inicios de capitulo; em ultimo caso, corte) e diz
// isso em uma linha.
//
//   tabela_conteudos       ementa completa + documentos curtos inteiros +
//                          sumario e inicios de capitulo dos longos
//   roteiro_projeto,       texto inteiro dos documentos; passando do teto, os
//   importacao_calendario  longos viram sumario + inicios de capitulo
//   lista_questoes         so os trechos recuperados do topico (recuperacao.js),
//                          que ja respeitam o proprio teto — nunca passa

import { db } from './db.js';
import { pareceIndiceOuTabela, TETO_CARACTERES as TETO_TRECHOS, TRECHOS_POR_LISTA } from './recuperacao.js';
import { titulosDasSecoes } from './trechos.js';

/** Teto do conteudo enviado ao modelo em cada fluxo, em caracteres. */
export const TETO_POR_FLUXO = {
  tabela_conteudos: 120000,
  roteiro_projeto: 120000,
  importacao_calendario: 120000,
  lista_questoes: TETO_TRECHOS,
};
/** Na tabela de conteudos, abaixo disto (em caracteres) o documento vai inteiro. */
const LIMITE_DOCUMENTO_CURTO = 40000;
/**
 * Ementa vai inteira ate este tamanho. Ementas reais tem poucas paginas; um
 * "ementa" de centenas de milhares de caracteres e um livro enviado com a
 * categoria sugerida — vai como livro (sumario + inicios), nunca cortado.
 */
const LIMITE_EMENTA = 60000;
const ementaDeVerdade = (d) => d.categoria === 'ementa' && d.conteudo_texto.length <= LIMITE_EMENTA;
/** Quanto do comeco de cada capitulo entra, em palavras. */
const PALAVRAS_INICIO_CAPITULO = 250;
/** Capitulos demais viram amostra: no maximo este numero de inicios por livro. */
const MAX_CAPITULOS_POR_LIVRO = 40;
/** Minimo reservado para os resumos dos livros quando o resto ja ocupa o teto. */
const MINIMO_PARA_LIVROS = 20000;

export const AVISO_RESUMO =
  'O material passa do limite desta leitura: dos documentos mais longos vão só o sumário e o início de cada capítulo.';
export const AVISO_INICIOS =
  'O material passa do limite desta leitura: dos livros vão o sumário e só parte dos inícios de capítulo.';
const avisoCorte = (teto) =>
  `O material passa do limite desta leitura mesmo resumido: vão os primeiros ${Math.round(teto / 1000)} mil caracteres.`;

const primeirasPalavras = (texto, n) => (String(texto).match(/\S+/g) ?? []).slice(0, n).join(' ');

/** Os capitulos de um livro: o nivel mais raso do sumario que tenha ao menos 3 entradas. */
function capitulosDoSumario(sumario) {
  const comPagina = sumario.filter((s) => Number.isFinite(s.pagina));
  const niveis = [...new Set(comPagina.map((s) => s.nivel ?? 0))].sort((a, b) => a - b);
  for (const n of niveis) {
    const doNivel = comPagina.filter((s) => (s.nivel ?? 0) === n);
    if (doNivel.length >= 3) return doNivel;
  }
  return comPagina;
}

/** Sumario e inicios de capitulo de um documento longo. */
function resumoDeLivro(doc) {
  const trechos = db
    .prepare(
      'SELECT ordem, texto, pagina_inicio, pagina_fim, titulo_secao FROM documento_trechos WHERE documento_id = ? ORDER BY ordem'
    )
    .all(doc.id)
    .filter((t) => !pareceIndiceOuTabela(t.texto));
  const sumario = doc.sumario ? JSON.parse(doc.sumario) : [];

  let linhasSumario;
  let capitulos;
  let origem;
  if (sumario.length) {
    origem = 'sumário do PDF';
    linhasSumario = sumario.map(
      (s) => `${'  '.repeat(s.nivel ?? 0)}${s.titulo}${Number.isFinite(s.pagina) ? ` (p. ${s.pagina})` : ''}`
    );
    capitulos = capitulosDoSumario(sumario).map((c) => ({
      titulo: c.titulo,
      trecho: trechos.find((t) => Number.isFinite(t.pagina_fim) && t.pagina_fim >= c.pagina) ?? null,
    }));
  } else {
    // Sem sumario extraivel: os titulos de secao identificados na divisao.
    origem = 'títulos de seção encontrados no texto';
    const secoes = titulosDasSecoes(trechos);
    linhasSumario = secoes.map((s) => `${s.titulo}${Number.isFinite(s.pagina) ? ` (p. ${s.pagina})` : ''}`);
    capitulos = secoes.map((s) => ({ titulo: s.titulo, trecho: trechos.find((t) => t.ordem === s.ordem) ?? null }));
    if (capitulos.length === 0) {
      // Nem sumario nem titulos: amostra espacada do texto.
      const passo = Math.max(1, Math.floor(trechos.length / 12));
      capitulos = trechos
        .filter((_, i) => i % passo === 0)
        .map((t) => ({ titulo: Number.isFinite(t.pagina_inicio) ? `p. ${t.pagina_inicio}` : `parte ${t.ordem + 1}`, trecho: t }));
    }
  }

  // Muitos capitulos: amostra espacada, para caber.
  if (capitulos.length > MAX_CAPITULOS_POR_LIVRO) {
    const passo = capitulos.length / MAX_CAPITULOS_POR_LIVRO;
    capitulos = Array.from({ length: MAX_CAPITULOS_POR_LIVRO }, (_, i) => capitulos[Math.floor(i * passo)]);
  }

  return {
    origem,
    sumario: linhasSumario.join('\n'),
    inicios: capitulos
      .filter((c) => c.trecho)
      .map((c) => `### ${c.titulo}\n${primeirasPalavras(c.trecho.texto, PALAVRAS_INICIO_CAPITULO)}…`),
  };
}

/** Resumos dos documentos longos, repartindo o espaco que sobrou entre eles. */
function resumirLongos(longos, espaco) {
  if (!longos.length) return { partes: [], cortou: false };
  const porLivro = Math.floor(Math.max(MINIMO_PARA_LIVROS, espaco) / longos.length);
  let cortou = false;
  const partes = longos.map((d) => {
    const r = resumoDeLivro(d);
    let parte =
      `=== LIVRO OU DOCUMENTO LONGO: ${d.nome_arquivo}${d.paginas ? ` (${d.paginas} páginas)` : ''} ===\n` +
      `SUMÁRIO (${r.origem}):\n${r.sumario}\n\nINÍCIO DE CADA CAPÍTULO:`;
    for (const inicio of r.inicios) {
      if (parte.length + inicio.length + 2 > porLivro) {
        cortou = true;
        break;
      }
      parte += `\n\n${inicio}`;
    }
    if (parte.length > porLivro) cortou = true;
    return parte.slice(0, porLivro);
  });
  return { partes, cortou };
}

const bloco = (rotulo, d) => `=== ${rotulo}: ${d.nome_arquivo} ===\n${d.conteudo_texto}`;

/**
 * Material que o fluxo envia ao modelo, a partir dos documentos escolhidos
 * (ou de todos os prontos do bloco, sem escolha).
 *
 * Devolve { texto, caracteres, teto, estruturado, reduzido, aviso }:
 *   estruturado — algum livro foi resumido por sumario e inicios de capitulo;
 *   reduzido    — o fluxo precisou reduzir alem do normal para caber no teto;
 *   aviso       — a linha que explica a reducao (null quando nao houve).
 * Para lista_questoes o conteudo depende do topico: texto vem vazio e
 * porTrechos=true (os trechos sao escolhidos na geracao, dentro do teto).
 */
export function materialDoFluxo(fluxo, blocoId, ids) {
  const teto = TETO_POR_FLUXO[fluxo] ?? 120000;
  const docs = db
    .prepare(
      `SELECT id, nome_arquivo, categoria, conteudo_texto, sumario, paginas
         FROM documentos_fonte
        WHERE bloco_id = ? AND COALESCE(status, 'pronto') = 'pronto' ORDER BY criado_em`
    )
    .all(blocoId)
    .filter((d) => (!ids?.length || ids.includes(d.id)) && String(d.conteudo_texto ?? '').trim());

  if (fluxo === 'lista_questoes') {
    return {
      texto: '',
      caracteres: null,
      teto,
      estruturado: false,
      reduzido: false,
      aviso: null,
      porTrechos: true,
      maxTrechos: TRECHOS_POR_LISTA,
    };
  }

  let inteiros;
  let longos;
  let reduzido = false;

  if (fluxo === 'tabela_conteudos') {
    // Regra normal: ementa e documentos curtos inteiros; os longos, resumidos.
    inteiros = docs.filter((d) => ementaDeVerdade(d) || d.conteudo_texto.length <= LIMITE_DOCUMENTO_CURTO);
    longos = docs.filter((d) => !inteiros.includes(d));
  } else {
    // Roteiro e calendario leem o texto inteiro; os longos so sao resumidos
    // se o total passar do teto.
    inteiros = [...docs];
    longos = [];
  }

  // Passou do teto: os maiores (fora a ementa) passam a ir resumidos.
  const soma = (lista) => lista.reduce((s, d) => s + d.conteudo_texto.length + d.nome_arquivo.length + 12, 0);
  const reservaLivros = () => (longos.length ? MINIMO_PARA_LIVROS : 0);
  const candidatos = inteiros
    .filter((d) => !ementaDeVerdade(d) && d.conteudo_texto.length > LIMITE_DOCUMENTO_CURTO / 4)
    .sort((a, b) => b.conteudo_texto.length - a.conteudo_texto.length);
  while (soma(inteiros) + reservaLivros() > teto && candidatos.length) {
    const maior = candidatos.shift();
    inteiros = inteiros.filter((d) => d !== maior);
    longos.push(maior);
    reduzido = true;
  }

  let texto = inteiros
    .map((d) => bloco(ementaDeVerdade(d) ? 'EMENTA' : 'DOCUMENTO', d))
    .join('\n\n');
  const { partes, cortou } = resumirLongos(longos, teto - texto.length);
  texto = [texto, ...partes].filter(Boolean).join('\n\n');
  // Resumir livros e a regra da tabela, nao uma reducao. Reducao e mandar
  // documentos inteiros como resumo, ou nao caber todos os inicios de capitulo.
  let aviso = reduzido ? AVISO_RESUMO : null;
  if (cortou) {
    reduzido = true;
    aviso = aviso ?? AVISO_INICIOS;
  }
  if (texto.length > teto) {
    // Ainda assim grande demais (varias ementas enormes, por exemplo): corta.
    texto = texto.slice(0, teto);
    reduzido = true;
    aviso = avisoCorte(teto);
  }

  return {
    texto,
    caracteres: texto.length,
    teto,
    estruturado: longos.length > 0,
    reduzido,
    aviso,
    porTrechos: false,
  };
}

/** Compatibilidade: a tabela de conteudos e um dos fluxos. */
export const materialParaTabela = (blocoId, ids) => materialDoFluxo('tabela_conteudos', blocoId, ids);
