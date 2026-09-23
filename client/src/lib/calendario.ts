/**
 * Montagem das grades do calendário.
 *
 * Só datas, nada de interface: as semanas começam no domingo, como num
 * calendário de parede brasileiro, e tudo trafega como 'YYYY-MM-DD' para nunca
 * depender do fuso do navegador.
 */

export type Visao = 'mes' | 'semana';

export type TipoItemCalendario = 'evento' | 'avaliacao' | 'entregavel' | 'lista' | 'revisao';

export interface ItemCalendario {
  tipo: TipoItemCalendario;
  id: string;
  titulo: string;
  data: string;
  bloco_id: string | null;
  bloco_nome: string | null;
  concluido: number;
  detalhe?: Record<string, unknown>;
}

export interface DiaDaGrade {
  data: string;
  /** Fora do mês em foco: pinta mais apagado, mas continua clicável. */
  foraDoPeriodo: boolean;
}

const MS_DIA = 86400000;

/** Meio-dia evita que horário de verão empurre a data para o dia anterior. */
const comoData = (iso: string) => new Date(iso + 'T12:00:00');

export const paraISO = (d: Date) => {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

export function somarDias(iso: string, dias: number) {
  const d = comoData(iso);
  d.setDate(d.getDate() + dias);
  return paraISO(d);
}

export function somarMeses(iso: string, meses: number) {
  const d = comoData(iso);
  const diaOriginal = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + meses);
  // 31 de janeiro + 1 mês não vira 3 de março: para no último dia de fevereiro.
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(diaOriginal, ultimoDia));
  return paraISO(d);
}

/** Domingo da semana em que a data cai. */
export function inicioDaSemana(iso: string) {
  const d = comoData(iso);
  d.setDate(d.getDate() - d.getDay());
  return paraISO(d);
}

export function primeiroDiaDoMes(iso: string) {
  return iso.slice(0, 8) + '01';
}

export function diasNoMes(iso: string) {
  const d = comoData(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export const mesmoMes = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

export function diferencaEmDias(de: string, ate: string) {
  return Math.round((comoData(ate).getTime() - comoData(de).getTime()) / MS_DIA);
}

/**
 * Grade do mês: semanas inteiras, do domingo ao sábado, cobrindo o mês todo.
 * O número de semanas acompanha o mês em vez de ser fixo em 6, para não deixar
 * uma linha inteira vazia no fim.
 */
export function gradeDoMes(ancora: string): DiaDaGrade[][] {
  const primeiro = primeiroDiaDoMes(ancora);
  const inicio = inicioDaSemana(primeiro);
  const ultimo = somarDias(primeiro, diasNoMes(ancora) - 1);
  const fim = somarDias(inicioDaSemana(ultimo), 6);

  const semanas: DiaDaGrade[][] = [];
  let cursor = inicio;
  while (cursor <= fim) {
    const semana: DiaDaGrade[] = [];
    for (let i = 0; i < 7; i++) {
      semana.push({ data: cursor, foraDoPeriodo: !mesmoMes(cursor, ancora) });
      cursor = somarDias(cursor, 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

export function gradeDaSemana(ancora: string): DiaDaGrade[][] {
  const inicio = inicioDaSemana(ancora);
  const semana: DiaDaGrade[] = [];
  for (let i = 0; i < 7; i++) {
    semana.push({ data: somarDias(inicio, i), foraDoPeriodo: false });
  }
  return [semana];
}

export const grade = (visao: Visao, ancora: string) =>
  visao === 'mes' ? gradeDoMes(ancora) : gradeDaSemana(ancora);

/** Avança ou volta um período inteiro, conforme a visão. */
export function navegar(visao: Visao, ancora: string, passo: number) {
  return visao === 'mes' ? somarMeses(ancora, passo) : somarDias(ancora, passo * 7);
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function rotuloDoPeriodo(visao: Visao, ancora: string) {
  const d = comoData(ancora);
  if (visao === 'mes') return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;

  const inicio = inicioDaSemana(ancora);
  const fim = somarDias(inicio, 6);
  const a = comoData(inicio);
  const b = comoData(fim);
  const dia = (x: Date) => x.getDate();
  if (a.getMonth() === b.getMonth()) {
    return `${dia(a)} a ${dia(b)} de ${MESES[a.getMonth()]} de ${a.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${dia(a)} de ${MESES[a.getMonth()]} a ${dia(b)} de ${MESES[b.getMonth()]} de ${a.getFullYear()}`;
  }
  return `${dia(a)} de ${MESES[a.getMonth()]} de ${a.getFullYear()} a ${dia(b)} de ${MESES[b.getMonth()]} de ${b.getFullYear()}`;
}

export function agruparPorData(itens: ItemCalendario[]) {
  const mapa = new Map<string, ItemCalendario[]>();
  for (const item of itens) {
    const lista = mapa.get(item.data);
    if (lista) lista.push(item);
    else mapa.set(item.data, [item]);
  }
  return mapa;
}

/** A data está na vista atual? Serve para decidir se é preciso navegar até ela. */
export function dataVisivel(visao: Visao, ancora: string, data: string) {
  return grade(visao, ancora).some((semana) => semana.some((d) => d.data === data));
}
