/**
 * Agregações da página de Desempenho.
 *
 * Tudo aqui descreve o que foi registrado — nunca julga quem estudou. Não há
 * score, percentual de domínio, tendência nem comparação entre períodos, e as
 * evidências de aprendizagem não entram em conta nenhuma: são log qualitativo.
 */
import { resumoPorTipo, type CasoHistorico, type ResumoTipo } from './calibracao';

export type TipoMeta = 'avaliacao' | 'entregavel' | 'lista';

export interface RegistroMeta {
  tipo: TipoMeta;
  id: string;
  bloco_id: string | null;
  titulo: string;
  /** Data ATUAL do item, já com qualquer reagendamento aplicado. */
  data_vigente: string;
  concluido_em: string;
}

export interface RegistroBloco {
  id: string;
  nome: string;
  wrapper_academico: number;
  limite_faltas: number | null;
  faltas_registradas: number;
  media_aprovacao: number | null;
  formula_media: string | null;
  usar_formula: number;
}

export interface RegistroAvaliacaoDesempenho {
  id: string;
  bloco_id: string | null;
  titulo: string;
  peso: number | null;
  nota: number | null;
}

export interface RegistroFoco {
  bloco_id: string | null;
  inicio: string;
  fim: string;
}

export interface RegistroRevisaoDesempenho {
  id: string;
  bloco_id: string | null;
  status: string;
  data_prevista: string;
}

export interface DadosDesempenho {
  hoje: string;
  blocos: RegistroBloco[];
  metas: RegistroMeta[];
  avaliacoes: RegistroAvaliacaoDesempenho[];
  calibracao: (CasoHistorico & { bloco_id: string | null })[];
  foco: RegistroFoco[];
  revisoes: RegistroRevisaoDesempenho[];
}

// ===========================================================================
// B. Cumprimento do plano vigente
// ===========================================================================

/** Mínimo de itens concluídos para o gráfico dizer alguma coisa. */
export const MIN_ITENS_GRAFICO = 3;

export interface MesDoPlano {
  /** 'YYYY-MM'. */
  mes: string;
  rotulo: string;
  naData: number;
  aposAData: number;
}

const MESES_CURTOS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

export function rotuloDoMes(mes: string) {
  const [ano, m] = mes.split('-');
  return `${MESES_CURTOS[Number(m) - 1]}/${ano.slice(2)}`;
}

/**
 * Concluído "na data" quando a conclusão aconteceu até a data vigente do item.
 * Como a data vigente já inclui reagendamentos, reagendar nunca vira atraso.
 */
export const concluiuNaData = (meta: RegistroMeta) =>
  meta.concluido_em.slice(0, 10) <= meta.data_vigente;

export function cumprimentoDoPlano(
  metas: RegistroMeta[],
  blocosSelecionados: Set<string>,
  tiposSelecionados: Set<TipoMeta>
): { meses: MesDoPlano[]; total: number; naData: number; aposAData: number } {
  const considerados = metas.filter(
    (m) =>
      tiposSelecionados.has(m.tipo) && (m.bloco_id === null || blocosSelecionados.has(m.bloco_id))
  );

  const porMes = new Map<string, MesDoPlano>();
  let naData = 0;
  let aposAData = 0;

  for (const meta of considerados) {
    // O mês é o da conclusão: é quando o trabalho aconteceu.
    const mes = meta.concluido_em.slice(0, 7);
    const atual = porMes.get(mes) ?? { mes, rotulo: rotuloDoMes(mes), naData: 0, aposAData: 0 };
    if (concluiuNaData(meta)) {
      atual.naData += 1;
      naData += 1;
    } else {
      atual.aposAData += 1;
      aposAData += 1;
    }
    porMes.set(mes, atual);
  }

  const meses = [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  return { meses, total: considerados.length, naData, aposAData };
}

// ===========================================================================
// C. Situação acadêmica
// ===========================================================================

/** Piso da margem de atenção; acima disso, um quarto do limite. */
export const FALTAS_PROXIMAS = 2;

/** Mesma regra do painel Acadêmico, para as duas telas não divergirem. */
export const margemDeAtencao = (limite: number) =>
  Math.max(FALTAS_PROXIMAS, Math.ceil(limite * 0.25));

export interface SituacaoAcademica {
  blocoId: string;
  nome: string;
  faltas: number;
  limiteFaltas: number | null;
  /** Perto do limite: âmbar, nunca vermelho, nunca cobrança. */
  pertoDoLimite: boolean;
  limiteAtingido: boolean;
  mediaAtual: number | null;
  mediaAprovacao: number | null;
  /** Quantas avaliações com nota sustentam a média. */
  avaliacoesComNota: number;
  totalAvaliacoes: number;
}

export function situacaoAcademica(
  blocos: RegistroBloco[],
  avaliacoes: RegistroAvaliacaoDesempenho[],
  blocosSelecionados: Set<string>,
  /** Média calculada fora daqui, porque pode vir de fórmula do usuário. */
  mediaDoBloco: (blocoId: string) => number | null
): SituacaoAcademica[] {
  return blocos
    .filter((b) => b.wrapper_academico === 1 && blocosSelecionados.has(b.id))
    .map((b) => {
      const doBloco = avaliacoes.filter((a) => a.bloco_id === b.id);
      const comNota = doBloco.filter((a) => a.nota !== null);
      // Limite zero é "não registrado", como no painel Acadêmico: dizer que o
      // limite foi atingido com zero faltas seria alarmar sem motivo.
      const limite = b.limite_faltas !== null && b.limite_faltas > 0 ? b.limite_faltas : null;
      const restantes = limite === null ? null : limite - b.faltas_registradas;
      return {
        blocoId: b.id,
        nome: b.nome,
        faltas: b.faltas_registradas,
        limiteFaltas: limite,
        pertoDoLimite: restantes !== null && restantes > 0 && restantes <= margemDeAtencao(limite!),
        limiteAtingido: restantes !== null && restantes <= 0,
        mediaAtual: mediaDoBloco(b.id),
        mediaAprovacao: b.media_aprovacao,
        avaliacoesComNota: comNota.length,
        totalAvaliacoes: doBloco.length,
      };
    });
}

// ===========================================================================
// D. Calibração das estimativas
// ===========================================================================

/** Reaproveita `resumoPorTipo` — o cálculo mora em calibracao.ts, e só lá. */
export function calibracaoPorTipo(
  casos: (CasoHistorico & { bloco_id: string | null })[],
  blocosSelecionados: Set<string>
): ResumoTipo[] {
  return resumoPorTipo(
    casos.filter((c) => c.bloco_id === null || blocosSelecionados.has(c.bloco_id))
  );
}

// ===========================================================================
// E. Tempo de foco
// ===========================================================================

export interface FocoPorBloco {
  blocoId: string | null;
  nome: string;
  minutos: number;
  sessoes: number;
}

/**
 * Só o acumulado por bloco. Sem série temporal, sem comparação entre dias,
 * sem tendência e sem meta — e nunca confrontado com o orçamento diário.
 */
export function focoPorBloco(
  foco: RegistroFoco[],
  blocos: RegistroBloco[],
  blocosSelecionados: Set<string>
): { linhas: FocoPorBloco[]; totalMin: number } {
  const nomes = new Map(blocos.map((b) => [b.id, b.nome]));
  const acumulado = new Map<string | null, { minutos: number; sessoes: number }>();

  for (const s of foco) {
    // Sessão sem bloco continua valendo: aparece na linha "Sem bloco".
    if (s.bloco_id !== null && !blocosSelecionados.has(s.bloco_id)) continue;
    const ms = new Date(s.fim).getTime() - new Date(s.inicio).getTime();
    if (!Number.isFinite(ms) || ms <= 0) continue;

    const atual = acumulado.get(s.bloco_id) ?? { minutos: 0, sessoes: 0 };
    atual.minutos += ms / 60000;
    atual.sessoes += 1;
    acumulado.set(s.bloco_id, atual);
  }

  const linhas = [...acumulado].map(([blocoId, v]) => ({
    blocoId,
    nome: blocoId === null ? 'Sem bloco' : (nomes.get(blocoId) ?? 'Bloco removido'),
    minutos: Math.round(v.minutos),
    sessoes: v.sessoes,
  }));

  linhas.sort((a, b) => b.minutos - a.minutos || a.nome.localeCompare(b.nome, 'pt-BR'));
  return { linhas, totalMin: linhas.reduce((s, l) => s + l.minutos, 0) };
}

// ===========================================================================
// F. Revisões de aprendizagem
// ===========================================================================

export interface ContagemRevisoes {
  emDia: number;
  atrasadas: number;
  reagendadas: number;
  pendentes: number;
  concluidas: number;
}

/**
 * Contagem de organização, não medida de desempenho. As três primeiras somam as
 * pendentes, para que os números fechem: uma revisão reagendada que já passou da
 * nova data conta como atrasada, pela mesma regra do plano vigente.
 */
export function contarRevisoes(
  revisoes: RegistroRevisaoDesempenho[],
  blocosSelecionados: Set<string>,
  hoje: string
): ContagemRevisoes {
  const consideradas = revisoes.filter(
    (r) => r.bloco_id === null || blocosSelecionados.has(r.bloco_id)
  );

  let emDia = 0;
  let atrasadas = 0;
  let reagendadas = 0;
  let concluidas = 0;

  for (const r of consideradas) {
    if (r.status === 'concluida') {
      concluidas += 1;
      continue;
    }
    if (r.data_prevista < hoje) atrasadas += 1;
    else if (r.status === 'reagendada') reagendadas += 1;
    else emDia += 1;
  }

  return { emDia, atrasadas, reagendadas, pendentes: emDia + atrasadas + reagendadas, concluidas };
}

// ===========================================================================
// Texto
// ===========================================================================

/** "1,2×" — vírgula decimal, como se escreve em português. */
export const formatarFator = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
