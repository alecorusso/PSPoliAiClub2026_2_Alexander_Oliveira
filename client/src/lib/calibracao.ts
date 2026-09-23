/**
 * Calibração da estimativa de tempo pelo histórico do próprio usuário.
 *
 * Só entram no histórico itens cuja estimativa veio do usuário ('faixa' ou
 * 'exata'). Estimativa da IA não calibra nada: mediria o erro do modelo, não o
 * de quem estuda. Esse filtro é feito no servidor, ao montar o histórico.
 */

/** Casos do mesmo tipo necessários para calibrar por tipo. */
export const MIN_CASOS_TIPO = 4;
/** Casos de qualquer tipo necessários para calibrar pelo histórico geral. */
export const MIN_CASOS_GLOBAL = 6;
/** Acréscimo aplicado quando o tipo da tarefa nunca foi concluído antes. */
export const FATOR_NOVIDADE = 1.3;
/** Faixa em que o fator final é sempre contido. */
export const CALIB_MIN = 0.8;
export const CALIB_MAX = 1.3;
/**
 * Teto da razão real/estimado. Item esquecido por semanas entra com esse valor
 * em vez do número real, para não dominar a amostra.
 */
export const TETO_RAZAO = 8;

export interface CasoHistorico {
  tipo_tarefa: string | null;
  tempo_estimado_min: number | null;
  criado_em: string | null;
  concluido_em: string | null;
}

export interface ResultadoCalibracao {
  fator: number;
  motivo: string;
}

/** Mediana — nunca média: uma semana ruim é ponto fora da curva. */
function mediana(valores: number[]) {
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? (ordenados[meio - 1] + ordenados[meio]) / 2
    : ordenados[meio];
}

/** Razão entre o tempo real (conclusão menos criação) e o estimado. */
function razao(caso: CasoHistorico): number | null {
  const estimado = Number(caso.tempo_estimado_min);
  if (!Number.isFinite(estimado) || estimado <= 0) return null;
  if (!caso.criado_em || !caso.concluido_em) return null;

  const inicio = new Date(caso.criado_em).getTime();
  const fim = new Date(caso.concluido_em).getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;

  const realMin = (fim - inicio) / 60000;
  if (realMin <= 0) return null;

  return Math.min(realMin / estimado, TETO_RAZAO);
}

const limitar = (n: number) => Math.min(Math.max(n, CALIB_MIN), CALIB_MAX);

const normalizar = (tipo: string | null | undefined) => (tipo ?? '').trim().toLowerCase();

/**
 * Quanto multiplicar a estimativa deste tipo de tarefa, e por quê.
 * O motivo é texto pronto para a interface — discreto, nunca um alerta.
 */
export function fatorCalibracao(
  tipo: string | null,
  historico: CasoHistorico[]
): ResultadoCalibracao {
  const casos = (historico ?? [])
    .map((c) => ({ tipo: normalizar(c.tipo_tarefa), valor: razao(c) }))
    .filter((c): c is { tipo: string; valor: number } => c.valor !== null);

  const alvo = normalizar(tipo);
  const doTipo = alvo ? casos.filter((c) => c.tipo === alvo) : [];

  // 6. Tipo que existe mas nunca foi concluído: estimativa acrescida.
  // Só vale quando já há algum histórico: sem nenhum dado, dizer "primeira
  // tarefa deste tipo" afirmaria mais do que se sabe.
  const tipoInedito = Boolean(alvo) && doTipo.length === 0 && casos.length > 0;

  let fator: number;
  let motivo: string;

  if (doTipo.length >= MIN_CASOS_TIPO) {
    fator = mediana(doTipo.map((c) => c.valor));
    motivo = `calibrado pelo seu histórico em ${String(tipo).trim()}`;
  } else if (casos.length >= MIN_CASOS_GLOBAL) {
    fator = mediana(casos.map((c) => c.valor));
    motivo = 'calibrado pelo seu histórico geral';
  } else {
    fator = 1;
    motivo = 'sem histórico suficiente';
  }

  if (tipoInedito) {
    fator *= FATOR_NOVIDADE;
    motivo = 'primeira tarefa deste tipo, estimativa acrescida';
  }

  return { fator: limitar(fator), motivo };
}

export interface ResumoTipo {
  /** O tipo como o usuário escreveu, na grafia mais usada. */
  tipo: string;
  casos: number;
  /** Mediana bruta da razão tempo real / tempo estimado. Null sem casos. */
  mediana: number | null;
  /** Há casos suficientes deste tipo para calibrar por ele? */
  suficiente: boolean;
  /** Fator que o cronograma aplica de fato — já contido na faixa. */
  fator: number;
  /** O fator foi limitado por CALIB_MIN/CALIB_MAX? */
  limitado: boolean;
  motivo: string;
}

/**
 * Um resumo por tipo de tarefa, para a tela de desempenho.
 *
 * Usa os mesmos auxiliares de `fatorCalibracao` — nada de cálculo paralelo —,
 * mas devolve também a mediana bruta, que a tela mostra, e diz quando o fator
 * aplicado no cronograma ficou contido pela faixa.
 *
 * É informação sobre as estimativas, não sobre quem estuda: não ordena tipos
 * por "acerto" nem classifica nada como certo ou errado.
 */
export function resumoPorTipo(historico: CasoHistorico[]): ResumoTipo[] {
  type Grupo = { grafias: Map<string, number>; valores: number[] };
  const grupos = new Map<string, Grupo>();

  for (const caso of historico ?? []) {
    const chave = normalizar(caso.tipo_tarefa);
    if (!chave) continue;
    const valor = razao(caso);
    if (valor === null) continue;

    const grupo: Grupo = grupos.get(chave) ?? { grafias: new Map<string, number>(), valores: [] };
    const escrito = String(caso.tipo_tarefa).trim();
    grupo.grafias.set(escrito, (grupo.grafias.get(escrito) ?? 0) + 1);
    grupo.valores.push(valor);
    grupos.set(chave, grupo);
  }

  const resumos = [...grupos].map(([, grupo]): ResumoTipo => {
    const tipo = [...grupo.grafias].sort((a, b) => b[1] - a[1])[0][0];
    const { fator, motivo } = fatorCalibracao(tipo, historico);
    const bruta = mediana(grupo.valores);
    const suficiente = grupo.valores.length >= MIN_CASOS_TIPO;
    return {
      tipo,
      casos: grupo.valores.length,
      mediana: bruta,
      suficiente,
      fator,
      // Só faz sentido falar em "limitado" quando é este tipo que manda no
      // fator: com poucos casos o cronograma usa o histórico geral.
      limitado: suficiente && limitar(bruta) !== bruta,
      motivo,
    };
  });

  // Ordem alfabética: qualquer outra insinuaria um ranking entre os tipos.
  return resumos.sort((a, b) => a.tipo.localeCompare(b.tipo, 'pt-BR'));
}
