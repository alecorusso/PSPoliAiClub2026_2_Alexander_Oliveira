import { fatorCalibracao, type CasoHistorico } from './calibracao';
import { ORCAMENTO_PADRAO_MIN } from './cronograma';

/**
 * Distribuição das datas dos entregáveis de um projeto.
 *
 * A IA estima o tamanho de cada entregável; quem calcula as datas é este
 * módulo. Nenhuma data é inventada: ou vem travada do roteiro, ou sai da
 * proporção entre o tempo de cada entregável e a janela até a entrega final.
 *
 * Função pura, sem banco: a tela de revisão a chama de novo a cada edição, sem
 * nova ida à IA.
 */

/** Fatia da janela reservada antes da entrega final, quando não se informa outra. */
export const FRACAO_MARGEM_PADRAO = 0.1;

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

export const diferencaEmDias = (de: string, ate: string) =>
  Math.round((comoData(ate).getTime() - comoData(de).getTime()) / MS_DIA);

/** Margem padrão: uma fatia da janela, nunca menos de um dia. */
export function margemPadraoEmDias(inicio: string, fim: string) {
  const janela = diferencaEmDias(inicio, fim);
  if (janela <= 1) return 0;
  return Math.max(1, Math.round(janela * FRACAO_MARGEM_PADRAO));
}

export interface EntregavelParaDistribuir {
  /** Chave local; a proposta ainda não existe no banco. */
  chave: string;
  nome: string;
  tipo_tarefa: string | null;
  tempo_estimado_min: number | null;
  /** Data travada: veio do roteiro ou o usuário travou na revisão. */
  data_fixa: string | null;
}

export interface EntregavelComData extends EntregavelParaDistribuir {
  data_entrega: string;
  /** A data saiu do cálculo ou está travada? */
  travada: boolean;
  /** Minutos depois da calibração — é o que pesa na distribuição. */
  tempoCalibradoMin: number;
}

/**
 * Tempo de um entregável depois da calibração pelo histórico do usuário.
 * É o mesmo fator que o cronograma aplica: a conta mora em calibracao.ts.
 */
export function tempoCalibrado(
  entregavel: EntregavelParaDistribuir,
  historico: CasoHistorico[]
): number {
  const bruto = Number(entregavel.tempo_estimado_min);
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;
  return bruto * fatorCalibracao(entregavel.tipo_tarefa, historico).fator;
}

/**
 * Distribui as datas ao longo da janela.
 *
 * Os entregáveis com data travada são marcos: eles partem a linha do tempo em
 * segmentos, e dentro de cada segmento os demais são espalhados
 * proporcionalmente ao tempo acumulado — entregável maior ganha mais dias de
 * calendário.
 *
 * @param entregaveis na ordem de execução
 * @param inicio primeira data possível
 * @param fimComMargem entrega final menos a margem
 */
export function distribuirDatas(
  entregaveis: EntregavelParaDistribuir[],
  inicio: string,
  fimComMargem: string,
  historico: CasoHistorico[] = []
): EntregavelComData[] {
  if (entregaveis.length === 0) return [];

  // Janela invertida não tem o que distribuir: tudo cai no início.
  const fim = diferencaEmDias(inicio, fimComMargem) < 0 ? inicio : fimComMargem;

  const tempos = entregaveis.map((e) => tempoCalibrado(e, historico));

  // Índices dos marcos travados, na ordem da sequência.
  const marcos = entregaveis
    .map((e, i) => (e.data_fixa ? i : -1))
    .filter((i) => i >= 0);

  const datas: string[] = new Array(entregaveis.length).fill(inicio);
  for (const i of marcos) datas[i] = entregaveis[i].data_fixa as string;

  // Cada segmento vai de um marco (ou do início) até o próximo (ou o fim).
  let cursor = 0;
  for (let m = 0; m <= marcos.length; m++) {
    const indiceMarco = m < marcos.length ? marcos[m] : entregaveis.length;
    const livres: number[] = [];
    for (let i = cursor; i < indiceMarco; i++) livres.push(i);
    cursor = indiceMarco + 1;
    if (livres.length === 0) continue;

    const inicioSegmento = m === 0 ? inicio : datas[marcos[m - 1]];
    const fimSegmento = m < marcos.length ? datas[marcos[m]] : fim;
    const duracao = Math.max(0, diferencaEmDias(inicioSegmento, fimSegmento));

    const totalSegmento = livres.reduce((s, i) => s + tempos[i], 0);

    let acumulado = 0;
    livres.forEach((i, posicao) => {
      acumulado += tempos[i];
      // Sem tempo estimado em nenhum, a única informação é a ordem: espalha por
      // contagem, em vez de empilhar tudo no fim do segmento.
      const fracao =
        totalSegmento > 0 ? acumulado / totalSegmento : (posicao + 1) / livres.length;
      datas[i] = somarDias(inicioSegmento, Math.round(fracao * duracao));
    });
  }

  // Nunca antes do início, e nunca fora de ordem na sequência.
  let anterior = inicio;
  for (let i = 0; i < datas.length; i++) {
    if (diferencaEmDias(inicio, datas[i]) < 0) datas[i] = inicio;
    if (diferencaEmDias(anterior, datas[i]) < 0) datas[i] = anterior;
    anterior = datas[i];
  }

  return entregaveis.map((e, i) => ({
    ...e,
    data_entrega: datas[i],
    travada: Boolean(e.data_fixa),
    tempoCalibradoMin: Math.round(tempos[i]),
  }));
}

// ===========================================================================
// Capacidade da janela
// ===========================================================================

export interface Capacidade {
  totalMin: number;
  disponivelMin: number;
  dias: number;
  /** O total estimado passa do que cabe na janela? */
  excede: boolean;
}

/**
 * Compara o tempo estimado com o que cabe na janela pelo orçamento diário.
 *
 * É informação, não impedimento: a tela mostra a linha e segue permitindo
 * confirmar.
 */
export function capacidadeDaJanela(
  entregaveis: EntregavelComData[],
  inicio: string,
  fim: string,
  orcamentoDiarioMin: number = ORCAMENTO_PADRAO_MIN
): Capacidade {
  const totalMin = entregaveis.reduce((s, e) => s + e.tempoCalibradoMin, 0);
  const dias = Math.max(0, diferencaEmDias(inicio, fim));
  const disponivelMin = dias * Math.max(orcamentoDiarioMin, 0);
  return { totalMin, disponivelMin, dias, excede: totalMin > disponivelMin };
}
