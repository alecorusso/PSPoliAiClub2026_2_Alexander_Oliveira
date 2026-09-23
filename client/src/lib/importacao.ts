/**
 * Importação de eventos a partir de um documento.
 *
 * A IA propõe, o usuário confirma: nada aqui grava coisa nenhuma. Este módulo
 * só prepara a tela de revisão — marca o que é provável duplicata, decide o que
 * vem marcado por padrão e diz em que cada item vai virar.
 */
import type { ItemCalendario } from './calendario';

export type TipoExtraido = 'prova' | 'entrega' | 'aula' | 'outro';
export type Confianca = 'alta' | 'baixa';

export interface ItemExtraido {
  titulo: string;
  data: string | null;
  hora: string | null;
  tipo: TipoExtraido;
  trecho_origem: string;
  confianca: Confianca;
}

/** O que cada item vira ao confirmar. */
export type Destino = 'avaliacao' | 'entregavel' | 'evento';

export interface LinhaImportacao extends ItemExtraido {
  /** Chave local da linha; a importação ainda não existe no banco. */
  chave: string;
  incluir: boolean;
  /** Item já no calendário que parece ser o mesmo. */
  duplicataDe: { tipo: string; titulo: string; data: string } | null;
  /** 'entrega' pode virar entregável do modo projeto, se o usuário pedir. */
  virarEntregavel: boolean;
}

// ===========================================================================
// Semelhança de títulos
// ===========================================================================

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Palavras que não distinguem um evento de outro. */
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'para']);

/** Fração de palavras em comum a partir da qual dois títulos são "o mesmo". */
export const LIMIAR_SEMELHANCA = 0.6;

/**
 * Dois títulos descrevem a mesma coisa?
 *
 * Comparação por palavras, não por texto exato: "Prova 1" e "Prova 1 —
 * Termodinâmica" são o mesmo compromisso escrito de dois jeitos.
 */
export function titulosSemelhantes(a: string, b: string) {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const palavras = (t: string) => new Set(t.split(' ').filter((p) => p && !VAZIAS.has(p)));
  const pa = palavras(na);
  const pb = palavras(nb);
  if (pa.size === 0 || pb.size === 0) return false;

  let comuns = 0;
  for (const p of pa) if (pb.has(p)) comuns += 1;
  // Sobre o menor conjunto: um título mais detalhado não deixa de ser o mesmo.
  return comuns / Math.min(pa.size, pb.size) >= LIMIAR_SEMELHANCA;
}

/** O item já existe no calendário? Mesma data e título semelhante. */
export function acharDuplicata(item: ItemExtraido, existentes: ItemCalendario[]) {
  if (!item.data) return null;
  const achado = existentes.find(
    (e) => e.data === item.data && titulosSemelhantes(e.titulo, item.titulo)
  );
  return achado ? { tipo: achado.tipo, titulo: achado.titulo, data: achado.data } : null;
}

// ===========================================================================
// Preparo da tela de revisão
// ===========================================================================

/**
 * Transforma o que a IA devolveu nas linhas da revisão.
 *
 * Vem DESMARCADO o que precisa de atenção: item sem data (não há o que gravar)
 * e provável duplicata (gravar criaria o mesmo compromisso duas vezes). Todo o
 * resto vem marcado, inclusive o de confiança baixa — que é sinalizado, não
 * escondido.
 */
export function prepararLinhas(
  eventos: ItemExtraido[],
  existentes: ItemCalendario[]
): LinhaImportacao[] {
  return eventos.map((e, i) => {
    const duplicataDe = acharDuplicata(e, existentes);
    return {
      ...e,
      chave: `linha-${i}-${e.titulo}`,
      incluir: Boolean(e.data) && duplicataDe === null,
      duplicataDe,
      virarEntregavel: false,
    };
  });
}

export function linhaVazia(chave: string): LinhaImportacao {
  return {
    chave,
    titulo: '',
    data: null,
    hora: null,
    tipo: 'outro',
    trecho_origem: '',
    confianca: 'alta',
    incluir: true,
    duplicataDe: null,
    virarEntregavel: false,
  };
}

/** Linha que precisa de conferência antes de virar registro. */
export const precisaConferir = (l: LinhaImportacao) => l.confianca === 'baixa' || l.data === null;

// ===========================================================================
// Destino de cada item
// ===========================================================================

/**
 * Em que o item vira ao confirmar.
 *
 * Uma prova de disciplina é a AVALIAÇÃO do bloco, nunca um evento à parte: é a
 * mesma regra de unificação do calendário, para o mesmo objetivo de estudo não
 * existir duas vezes.
 */
export function destinoDoItem(linha: LinhaImportacao, blocoTemWrapper: boolean): Destino {
  if (linha.tipo === 'prova' && blocoTemWrapper) return 'avaliacao';
  if (linha.tipo === 'entrega' && linha.virarEntregavel) return 'entregavel';
  return 'evento';
}

/** Há provas indo para evento só porque o bloco não tem wrapper acadêmico? */
export const temProvasSemWrapper = (linhas: LinhaImportacao[], blocoTemWrapper: boolean) =>
  !blocoTemWrapper && linhas.some((l) => l.incluir && l.tipo === 'prova');

export interface ResumoImportacao {
  total: number;
  avaliacoes: number;
  entregaveis: number;
  eventos: number;
}

export function resumirImportacao(
  linhas: LinhaImportacao[],
  blocoTemWrapper: boolean
): ResumoImportacao {
  const resumo: ResumoImportacao = { total: 0, avaliacoes: 0, entregaveis: 0, eventos: 0 };
  for (const l of linhas) {
    if (!l.incluir || !l.data) continue;
    resumo.total += 1;
    const destino = destinoDoItem(l, blocoTemWrapper);
    if (destino === 'avaliacao') resumo.avaliacoes += 1;
    else if (destino === 'entregavel') resumo.entregaveis += 1;
    else resumo.eventos += 1;
  }
  return resumo;
}

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

/** "12 itens importados: 3 avaliações, 2 entregáveis, 7 eventos." */
export function textoDoResumo(r: ResumoImportacao) {
  const partes = [
    r.avaliacoes > 0 ? plural(r.avaliacoes, 'avaliação', 'avaliações') : null,
    r.entregaveis > 0 ? plural(r.entregaveis, 'entregável', 'entregáveis') : null,
    r.eventos > 0 ? plural(r.eventos, 'evento', 'eventos') : null,
  ].filter(Boolean);

  const cabeca = plural(r.total, 'item importado', 'itens importados');
  return partes.length > 0 ? `${cabeca}: ${partes.join(', ')}.` : `${cabeca}.`;
}
