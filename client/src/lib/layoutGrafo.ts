import dagre from 'dagre';
import { TIPOS_DEPENDENCIA } from './grafo';

/**
 * Posições dos blocos no mapa.
 *
 * O layout é calculado UMA vez e gravado no banco. Depois disso, quem manda são
 * as posições salvas: o mapa não se reorganiza sozinho a cada abertura, porque
 * a memória espacial de onde as coisas estão é metade da utilidade dele.
 */

// ===========================================================================
// CONSTANTES
// ===========================================================================

/** Tamanho do nó, usado pelo dagre e pelo cálculo de espaço livre. */
export const LARGURA_NO = 180;
export const ALTURA_NO = 44;

/** Espaço entre nós irmãos e entre níveis da hierarquia. */
export const ESPACO_HORIZONTAL = 60;
export const ESPACO_VERTICAL = 90;

/** Zoom em que o nó central fica num tamanho confortável de leitura. */
export const ZOOM_PADRAO = 1;
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 2.5;

/** Abaixo disto os nós viram pontos: o nome não caberia legível mesmo. */
export const ZOOM_MOSTRAR_NOMES = 0.45;
/** Rótulo de aresta só em zoom próximo, senão vira poluição. */
export const ZOOM_MOSTRAR_ROTULOS_ARESTA = 1.2;

/** Distância de um bloco novo para os blocos com que ele se relaciona. */
export const DISTANCIA_BLOCO_NOVO = ALTURA_NO + ESPACO_VERTICAL;
/** Margem entre a área ocupada e um bloco novo sem relações. */
export const MARGEM_AREA_LIVRE = LARGURA_NO + ESPACO_HORIZONTAL;

export interface BlocoDoGrafo {
  id: string;
  nome: string;
  favorito: number;
  oculto: number;
  wrapper_academico: number;
  pos_x: number | null;
  pos_y: number | null;
  /** Usado pelo botão "Centralizar" quando não há bloco em foco. */
  ultimo_acesso?: string | null;
}

export interface ArestaDoGrafo {
  id: string;
  bloco_origem_id: string;
  bloco_destino_id: string;
  tipo: string;
}

export interface Posicao {
  id: string;
  pos_x: number;
  pos_y: number;
}

// ===========================================================================
// Layout hierárquico
// ===========================================================================

/**
 * Calcula o mapa inteiro com dagre, orientado pelos pré-requisitos: quem é base
 * fica embaixo, quem depende fica acima.
 *
 * Blocos ocultos entram no cálculo: o lugar deles continua reservado, para que
 * mostrá-los depois não empurre nada.
 */
export function calcularLayout(blocos: BlocoDoGrafo[], relacoes: ArestaDoGrafo[]): Posicao[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    // De baixo para cima: o que é pré-requisito fica embaixo.
    rankdir: 'BT',
    nodesep: ESPACO_HORIZONTAL,
    ranksep: ESPACO_VERTICAL,
    marginx: ESPACO_HORIZONTAL,
    marginy: ESPACO_VERTICAL,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const existe = new Set(blocos.map((b) => b.id));
  for (const b of blocos) g.setNode(b.id, { width: LARGURA_NO, height: ALTURA_NO });

  for (const r of relacoes) {
    if (!existe.has(r.bloco_origem_id) || !existe.has(r.bloco_destino_id)) continue;

    // A aresta do layout vai sempre da dependência para quem depende dela.
    let de = r.bloco_origem_id;
    let para = r.bloco_destino_id;
    if (r.tipo === 'deriva_de') [de, para] = [para, de];
    else if (!TIPOS_DEPENDENCIA.includes(r.tipo)) {
      // Fusão: as origens ficam abaixo do resultado, como numa confluência.
      if (r.tipo !== 'fusao_com') continue;
    }
    if (de === para) continue;
    g.setEdge(de, para);
  }

  dagre.layout(g);

  return blocos.map((b) => {
    const no = g.node(b.id);
    // dagre devolve o centro; o mapa trabalha com o canto superior esquerdo.
    return {
      id: b.id,
      pos_x: Math.round((no?.x ?? 0) - LARGURA_NO / 2),
      pos_y: Math.round((no?.y ?? 0) - ALTURA_NO / 2),
    };
  });
}

// ===========================================================================
// Bloco novo
// ===========================================================================

/** Retângulo ocupado pelos blocos que já têm lugar. */
function areaOcupada(posicionados: BlocoDoGrafo[]) {
  if (posicionados.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of posicionados) {
    minX = Math.min(minX, b.pos_x as number);
    minY = Math.min(minY, b.pos_y as number);
    maxX = Math.max(maxX, (b.pos_x as number) + LARGURA_NO);
    maxY = Math.max(maxY, (b.pos_y as number) + ALTURA_NO);
  }
  return { minX, minY, maxX, maxY };
}

const ocupado = (x: number, y: number, posicionados: BlocoDoGrafo[]) =>
  posicionados.some(
    (b) =>
      Math.abs((b.pos_x as number) - x) < LARGURA_NO && Math.abs((b.pos_y as number) - y) < ALTURA_NO
  );

/**
 * Onde colocar um bloco que acabou de ganhar lugar no mapa, SEM mover nenhum
 * dos que já estão: perto de quem ele se relaciona, ou numa área livre à
 * direita de tudo quando ele ainda não se relaciona com nada.
 */
export function posicaoParaNovoBloco(
  blocoId: string,
  blocos: BlocoDoGrafo[],
  relacoes: ArestaDoGrafo[]
): { pos_x: number; pos_y: number } {
  const posicionados = blocos.filter(
    (b) => b.id !== blocoId && b.pos_x !== null && b.pos_y !== null
  );
  if (posicionados.length === 0) return { pos_x: 0, pos_y: 0 };

  const vizinhos = posicionados.filter((b) =>
    relacoes.some(
      (r) =>
        (r.bloco_origem_id === blocoId && r.bloco_destino_id === b.id) ||
        (r.bloco_destino_id === blocoId && r.bloco_origem_id === b.id)
    )
  );

  if (vizinhos.length > 0) {
    const x = vizinhos.reduce((s, b) => s + (b.pos_x as number), 0) / vizinhos.length;
    const y = vizinhos.reduce((s, b) => s + (b.pos_y as number), 0) / vizinhos.length;
    // Desce até achar espaço, em vez de empurrar quem já está no lugar.
    for (let passo = 0; passo < 40; passo++) {
      const tentativa = { x: Math.round(x), y: Math.round(y + passo * DISTANCIA_BLOCO_NOVO) };
      if (!ocupado(tentativa.x, tentativa.y, posicionados)) {
        return { pos_x: tentativa.x, pos_y: tentativa.y };
      }
    }
  }

  const area = areaOcupada(posicionados)!;
  return { pos_x: Math.round(area.maxX + MARGEM_AREA_LIVRE), pos_y: Math.round(area.minY) };
}

/** Quais blocos ainda não têm lugar no mapa. */
export const semPosicao = (blocos: BlocoDoGrafo[]) =>
  blocos.filter((b) => b.pos_x === null || b.pos_y === null);
