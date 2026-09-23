// Texto das paginas de origem de uma lista gerada.
//
// Compartilhado entre servidor e cliente (como grafo.js): o servidor calcula
// as faixas de pagina a partir dos trechos usados, e os dois lados escrevem a
// frase do mesmo jeito.

/** "112–130", ou "112" quando e uma pagina so. */
const faixa = (f) => (f.de === f.ate ? `${f.de}` : `${f.de}–${f.ate}`);

/** "112–130, 140 e 245–250" */
function juntar(partes) {
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0];
}

/**
 * "Baseada nas páginas 112–130 e 245–250 de Livro.pdf"
 * origens: [{ documento_id, nome, faixas: [{ de, ate }] }]
 */
export function textoDaOrigem(origens) {
  if (!Array.isArray(origens) || origens.length === 0) return '';
  const partes = origens.map((o) => {
    const nome = o.nome ?? 'documento removido';
    if (!o.faixas?.length) return nome;
    const plural = o.faixas.length > 1 || o.faixas[0].de !== o.faixas[0].ate;
    return `${plural ? 'páginas' : 'página'} ${juntar(o.faixas.map(faixa))} de ${nome}`;
  });
  return `Baseada ${partes[0].startsWith('página') ? 'nas ' : 'em '}${partes.join('; ')}`;
}

/** "Livro.pdf, pp. 112–118 · 11.6 Intervalos de Confiança" — o apoio de uma questão. */
export function textoDoApoio(apoio) {
  if (!apoio) return '';
  const paginas = Number.isFinite(apoio.pagina_inicio)
    ? apoio.pagina_fim && apoio.pagina_fim !== apoio.pagina_inicio
      ? `pp. ${apoio.pagina_inicio}–${apoio.pagina_fim}`
      : `p. ${apoio.pagina_inicio}`
    : null;
  const onde = [apoio.nome, paginas].filter(Boolean).join(', ');
  return apoio.titulo_secao ? `${onde} · ${apoio.titulo_secao}` : onde;
}
