// Divisao de um documento em trechos.
//
// Feita UMA vez, quando o documento entra no repositorio. Os trechos sao a
// unidade de busca: a geracao de listas manda ao modelo so os trechos do
// topico, nunca o livro inteiro.
//
// Modulo puro — sem banco, sem rede — para poder ser testado isoladamente.

/** Tamanho alvo de um trecho, em palavras. */
export const PALAVRAS_POR_TRECHO = 1500;
/** Quantas palavras do fim de um trecho repetem no comeco do seguinte. */
export const SOBREPOSICAO = 150;
/**
 * Um trecho so e cortado numa troca de secao se ja tiver ao menos esta fracao
 * do tamanho alvo — senao as secoes curtas virariam trechos minusculos.
 */
const FRACAO_MINIMA_PARA_CORTE = 0.6;
/**
 * Troca de CAPITULO (o nivel mais raso do sumario) corta mais cedo: um trecho
 * que atravessa dois capitulos atrapalha a busca por topico.
 */
const FRACAO_MINIMA_CAPITULO = 0.25;

const contarPalavras = (t) => (t.match(/\S+/g) ?? []).length;

/**
 * Linha com cara de titulo de secao: curta, sem ponto final e comecando como
 * titulo ("Capitulo 3", "2.4 Variancia", "# Integrais").
 */
export function pareceTitulo(linha) {
  const l = linha.trim();
  if (l.length < 3 || l.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(l)) return true;
  if (/[.,;:]$/.test(l)) return false;
  if (contarPalavras(l) > 12) return false;
  if (/^(cap[ií]tulo|chapter|se[cç][aã]o|parte|unidade|m[oó]dulo|aula)\s+[\dIVXLC]+\b/i.test(l)) return true;
  // "2.4 Variância", "3 Probabilidades" — numero seguido de palavra em maiuscula.
  return /^\d{1,2}(\.\d{1,2}){0,3}\.?\s+[A-ZÀ-Ú][^\d=+*/<>]*$/.test(l);
}

const limparTitulo = (l) => l.trim().replace(/^#{1,6}\s+/, '');

/**
 * Secao de cada pagina a partir do sumario: a ultima entrada que comeca ate
 * aquela pagina. Entradas mais profundas vencem as mais rasas na mesma pagina.
 */
function secaoPorPagina(sumario, soOMaisRaso = false) {
  const validas = (sumario ?? []).filter((s) => Number.isFinite(s.pagina));
  const nivelMinimo = Math.min(...validas.map((s) => s.nivel ?? 0));
  const entradas = validas
    .filter((s) => !soOMaisRaso || (s.nivel ?? 0) === nivelMinimo)
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.pagina - b.pagina || a.i - b.i);
  if (entradas.length === 0) return null;
  return (pagina) => {
    if (!Number.isFinite(pagina)) return null;
    let atual = null;
    for (const e of entradas) {
      if (e.pagina > pagina) break;
      atual = e;
    }
    return atual?.titulo ?? null;
  };
}

/**
 * Unidades de texto: paragrafos e titulos, cada um com a pagina de onde veio.
 * Titulos viram unidades proprias, marcadas, para poderem abrir secao.
 */
function unidades(paginas) {
  const saida = [];
  for (const p of paginas) {
    const blocos = String(p.texto ?? '').split(/\n\s*\n/);
    for (const bloco of blocos) {
      let paragrafo = [];
      const fechar = () => {
        const texto = paragrafo.join(' ').replace(/\s+/g, ' ').trim();
        if (texto) saida.push({ texto, pagina: p.numero ?? null, titulo: null });
        paragrafo = [];
      };
      for (const linha of bloco.split('\n')) {
        if (!linha.trim()) continue;
        if (pareceTitulo(linha)) {
          fechar();
          saida.push({ texto: limparTitulo(linha), pagina: p.numero ?? null, titulo: limparTitulo(linha) });
        } else {
          paragrafo.push(linha.trim());
        }
      }
      fechar();
    }
  }
  return saida;
}

/** Quebra um paragrafo maior que o trecho em pedacos, por frases quando possivel. */
function partirParagrafo(unidade, limite) {
  const frases = unidade.texto.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [unidade.texto];
  const pedacos = [];
  let atual = [];
  let palavras = 0;
  const empurrar = () => {
    if (atual.length) pedacos.push({ ...unidade, texto: atual.join(' ').trim() });
    atual = [];
    palavras = 0;
  };
  for (const frase of frases) {
    const n = contarPalavras(frase);
    if (n > limite) {
      // Frase sem pontuacao (tabela, formula longa): corta por palavras.
      empurrar();
      const ps = frase.match(/\S+/g) ?? [];
      for (let i = 0; i < ps.length; i += limite) {
        pedacos.push({ ...unidade, texto: ps.slice(i, i + limite).join(' ') });
      }
      continue;
    }
    if (palavras + n > limite) empurrar();
    atual.push(frase.trim());
    palavras += n;
  }
  empurrar();
  return pedacos;
}

/**
 * Divide o documento em trechos de ~PALAVRAS_POR_TRECHO palavras, com
 * ~SOBREPOSICAO palavras repetidas entre trechos vizinhos, respeitando
 * paragrafos e trocas de secao quando possivel.
 *
 * paginas: [{ numero|null, texto }]; sumario: [{ titulo, pagina, nivel }]
 * Devolve [{ ordem, texto, pagina_inicio, pagina_fim, titulo_secao }].
 */
export function dividirEmTrechos(
  { paginas, sumario = [] },
  { alvo = PALAVRAS_POR_TRECHO, sobreposicao = SOBREPOSICAO } = {}
) {
  const secaoDoSumario = secaoPorPagina(sumario);
  const capituloDoSumario = secaoPorPagina(sumario, true);
  const lista = [];
  for (const u of unidades(paginas ?? [])) {
    if (contarPalavras(u.texto) > alvo) lista.push(...partirParagrafo(u, alvo));
    else lista.push(u);
  }

  const trechos = [];
  let atual = []; // unidades do trecho em montagem
  let palavras = 0;
  let palavrasNovas = 0; // sem contar a sobreposicao herdada
  let tituloDetectado = null; // ultimo titulo visto no texto

  const secaoDe = (u) => (secaoDoSumario ? secaoDoSumario(u.pagina) : null) ?? u.tituloSecao ?? null;

  const fechar = () => {
    if (palavrasNovas === 0) return;
    const paginasDoTrecho = atual.map((u) => u.pagina).filter(Number.isFinite);
    // A secao do trecho e a da primeira unidade nova (a sobreposicao e do anterior).
    const primeiraNova = atual.find((u) => !u.herdada) ?? atual[0];
    trechos.push({
      ordem: trechos.length,
      texto: atual.map((u) => u.texto).join('\n\n'),
      pagina_inicio: paginasDoTrecho.length ? Math.min(...paginasDoTrecho) : null,
      pagina_fim: paginasDoTrecho.length ? Math.max(...paginasDoTrecho) : null,
      titulo_secao: secaoDe(primeiraNova),
    });

    // Sobreposicao: as ultimas palavras seguem para o proximo trecho.
    const ultimas = [];
    let n = 0;
    for (let i = atual.length - 1; i >= 0 && n < sobreposicao; i--) {
      const ps = atual[i].texto.match(/\S+/g) ?? [];
      const falta = sobreposicao - n;
      const pegar = ps.slice(Math.max(0, ps.length - falta));
      ultimas.unshift({ ...atual[i], texto: pegar.join(' '), herdada: true, titulo: null });
      n += pegar.length;
    }
    atual = ultimas;
    palavras = n;
    palavrasNovas = 0;
  };

  for (const u of lista) {
    const n = contarPalavras(u.texto);
    if (u.titulo) tituloDetectado = u.titulo;
    const unidade = { ...u, tituloSecao: u.titulo ?? tituloDetectado };

    // Troca de secao: bom lugar para cortar, se o trecho ja tem corpo.
    const anterior = atual[atual.length - 1];
    const trocaCapitulo =
      capituloDoSumario &&
      anterior &&
      palavrasNovas >= alvo * FRACAO_MINIMA_CAPITULO &&
      capituloDoSumario(u.pagina) !== capituloDoSumario(anterior.pagina);
    const trocaSecao =
      trocaCapitulo ||
      (palavrasNovas >= alvo * FRACAO_MINIMA_PARA_CORTE &&
        (u.titulo !== null ||
          (secaoDoSumario && anterior && secaoDe(unidade) !== secaoDe(anterior))));
    if (trocaSecao || (palavras + n > alvo && palavrasNovas > 0)) fechar();

    atual.push(unidade);
    palavras += n;
    palavrasNovas += n;
  }
  fechar();
  return trechos;
}

/** Titulos de secao distintos, na ordem em que aparecem — o "sumario" de quem nao tem. */
export function titulosDasSecoes(trechos) {
  const vistos = new Set();
  const saida = [];
  for (const t of trechos) {
    if (!t.titulo_secao || vistos.has(t.titulo_secao)) continue;
    vistos.add(t.titulo_secao);
    saida.push({ titulo: t.titulo_secao, pagina: t.pagina_inicio, ordem: t.ordem });
  }
  return saida;
}
