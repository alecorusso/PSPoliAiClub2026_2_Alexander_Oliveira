/**
 * Travessia do grafo de blocos.
 *
 * Em JavaScript puro de propósito: o servidor (ESM, sem etapa de build) importa
 * este mesmo arquivo. A regra de ciclo e a cadeia de pré-requisitos são uma só
 * implementação, em vez de duas que podem divergir com o tempo.
 *
 * Direções, como gravadas em `bloco_relacoes`:
 *   pre_requisito: origem É PRÉ-REQUISITO DE destino  → destino depende de origem
 *   deriva_de:     origem DERIVA DE destino           → origem depende de destino
 *   fusao_com:     origem é UMA DAS ORIGENS de destino (o resultado da fusão)
 *
 * As duas primeiras são relações de dependência e não podem formar ciclo. A
 * fusão não entra nessa conta: ela descreve composição, não pré-requisito.
 */

/**
 * @typedef {object} Aresta
 * @property {string} bloco_origem_id
 * @property {string} bloco_destino_id
 * @property {string} tipo
 */

/** Relações que criam dependência entre blocos. */
export const TIPOS_DEPENDENCIA = ['pre_requisito', 'deriva_de'];

/**
 * Quem depende de quem, normalizado: `dependente -> Set(dependências)`.
 * As duas relações são gravadas em direções opostas, e é aqui que isso some.
 *
 * @param {Aresta[]} arestas
 * @param {string[]} [tipos] quais relações considerar
 * @returns {Map<string, Set<string>>}
 */
export function mapaDeDependencias(arestas, tipos = TIPOS_DEPENDENCIA) {
  const permitidos = new Set(tipos);
  const mapa = new Map();

  const ligar = (dependente, dependencia) => {
    const atual = mapa.get(dependente) ?? new Set();
    atual.add(dependencia);
    mapa.set(dependente, atual);
  };

  for (const a of arestas ?? []) {
    if (!permitidos.has(a.tipo)) continue;
    if (a.tipo === 'pre_requisito') ligar(a.bloco_destino_id, a.bloco_origem_id);
    else if (a.tipo === 'deriva_de') ligar(a.bloco_origem_id, a.bloco_destino_id);
  }
  return mapa;
}

/**
 * Toda a cadeia ascendente de dependências de um bloco, sem limite de
 * profundidade. O próprio bloco nunca entra no resultado.
 *
 * @param {string} blocoId
 * @param {Aresta[]} arestas
 * @param {string[]} [tipos]
 * @returns {Set<string>}
 */
export function dependenciasTransitivas(blocoId, arestas, tipos = TIPOS_DEPENDENCIA) {
  const mapa = mapaDeDependencias(arestas, tipos);
  const vistos = new Set();
  const fila = [...(mapa.get(blocoId) ?? [])];

  while (fila.length > 0) {
    const atual = fila.pop();
    // Um ciclo herdado do banco não pode travar a travessia.
    if (atual === blocoId || vistos.has(atual)) continue;
    vistos.add(atual);
    for (const anterior of mapa.get(atual) ?? []) fila.push(anterior);
  }
  return vistos;
}

/**
 * Cadeia ascendente de PRÉ-REQUISITOS de um bloco — é o que o caminho de
 * pré-requisitos do grafo destaca.
 *
 * @param {string} blocoId
 * @param {Aresta[]} arestas
 * @returns {Set<string>}
 */
export function getPreRequisitosTransitivos(blocoId, arestas) {
  return dependenciasTransitivas(blocoId, arestas, ['pre_requisito']);
}

/**
 * As arestas que formam a cadeia de pré-requisitos de um bloco, para que o
 * destaque cubra também as ligações, não só os nós.
 *
 * @param {string} blocoId
 * @param {Aresta[]} arestas
 * @returns {Set<string>} ids das arestas
 */
export function arestasDoCaminho(blocoId, arestas) {
  const naCadeia = getPreRequisitosTransitivos(blocoId, arestas);
  naCadeia.add(blocoId);
  const ids = new Set();
  for (const a of arestas ?? []) {
    if (a.tipo !== 'pre_requisito') continue;
    // A aresta entra quando liga dois blocos da cadeia.
    if (naCadeia.has(a.bloco_origem_id) && naCadeia.has(a.bloco_destino_id)) ids.add(a.id);
  }
  return ids;
}

/**
 * Uma nova relação criaria um ciclo?
 *
 * Só olha relações de dependência: a fusão descreve composição e não entra.
 *
 * @param {Aresta[]} arestas arestas já existentes
 * @param {Aresta} nova
 * @returns {{ ciclo: boolean, dependente?: string, dependencia?: string }}
 */
export function criariaCiclo(arestas, nova) {
  if (!TIPOS_DEPENDENCIA.includes(nova.tipo)) return { ciclo: false };

  // Quem passa a depender de quem, com a nova aresta.
  const [dependente, dependencia] =
    nova.tipo === 'pre_requisito'
      ? [nova.bloco_destino_id, nova.bloco_origem_id]
      : [nova.bloco_origem_id, nova.bloco_destino_id];

  if (dependente === dependencia) return { ciclo: true, dependente, dependencia };

  // Há ciclo se a dependência já depende do dependente por algum caminho.
  const jaDepende = dependenciasTransitivas(dependencia, arestas);
  return jaDepende.has(dependente) ? { ciclo: true, dependente, dependencia } : { ciclo: false };
}

/**
 * As origens de cada fusão: `resultado -> [origens]`.
 *
 * Uma fusão é o conjunto de arestas 'fusao_com' que apontam para o mesmo
 * resultado — por isso um bloco é resultado de no máximo uma fusão, por
 * construção.
 *
 * @param {Aresta[]} arestas
 * @returns {Map<string, string[]>}
 */
export function fusoesPorResultado(arestas) {
  const mapa = new Map();
  for (const a of arestas ?? []) {
    if (a.tipo !== 'fusao_com') continue;
    const atual = mapa.get(a.bloco_destino_id) ?? [];
    if (!atual.includes(a.bloco_origem_id)) atual.push(a.bloco_origem_id);
    mapa.set(a.bloco_destino_id, atual);
  }
  return mapa;
}

/** Uma fusão precisa de pelo menos duas origens para existir. */
export const MIN_ORIGENS_FUSAO = 2;
