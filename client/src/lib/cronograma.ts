/**
 * Cronograma dinâmico: pontua e ordena tudo o que está pendente.
 *
 * A pontuação nunca é exibida ao usuário — a interface mostra apenas o motivo
 * em texto. O cálculo devolve a lista completa; o corte é decisão de tela.
 */
import { fatorCalibracao, type CasoHistorico } from './calibracao';

// ===========================================================================
// CONSTANTES CALIBRÁVEIS
// Reunidas aqui porque serão ajustadas com uso real.
// ===========================================================================

/** Estudo pessoal pesa menos que entregas concretas, sem sumir da lista. */
export const PESO_CLASSE_APRENDIZAGEM = 0.65;
/** Meia-vida do decaimento da urgência absoluta, em dias. */
export const MEIA_VIDA_DIAS = 7;
/** A partir daqui a urgência satura em 1: o prazo está em cima. */
export const DIAS_SATURACAO = 3;
/** Quanto a folga (tempo disponível ÷ trabalho restante) pesa na combinação. */
export const PESO_FOLGA = 0.65;
/** Quanto o prazo puro pesa, independentemente do tamanho da tarefa. */
export const PESO_URGENCIA_ABSOLUTA = 0.35;
/** Item grande entra cedo se o tempo restante for menor que este múltiplo do trabalho. */
export const MULTIPLO_HORIZONTE = 3;
/** Janela do cronograma, em dias. Além disso o item é agrupado à parte. */
export const HORIZONTE_DIAS = 14;
/** Desconto acumulativo por item repetido do mesmo bloco ou modo, nas sugestões do dia. */
export const PENALIDADE_REPETICAO = 0.15;
/** Orçamento diário de estudo padrão, em minutos. */
export const ORCAMENTO_PADRAO_MIN = 240;
/** Quanto um ajuste manual desloca a pontuação, por posição arrastada. */
export const PASSO_AJUSTE_MANUAL = 0.08;

/** Tempo de uma revisão de aprendizagem, por peso do tópico, em minutos. */
export const TEMPO_REVISAO_POR_PESO: Record<string, number> = {
  baixo: 15,
  medio: 25,
  alto: 40,
};

// Constantes da calibração: vivem em calibracao.ts, onde são usadas, e são
// reexportadas aqui para que todo o ajuste fino fique visível num lugar só.
export {
  MIN_CASOS_TIPO,
  MIN_CASOS_GLOBAL,
  FATOR_NOVIDADE,
  CALIB_MIN,
  CALIB_MAX,
} from './calibracao';

// ===========================================================================
// Tipos
// ===========================================================================
export type TipoItem = 'entregavel' | 'lista' | 'avaliacao' | 'revisao';
export type ClasseItem = 'prova' | 'projeto' | 'aprendizagem';
export type Grupo = 'hoje' | 'semana' | 'depois' | 'alem_horizonte';

export interface DadosCronograma {
  hoje: string;
  config: Record<string, string>;
  entregaveis: RegistroEntregavel[];
  listas: RegistroLista[];
  avaliacoes: RegistroAvaliacao[];
  revisoes: RegistroRevisao[];
  historico: CasoHistorico[];
  ajustes: AjustePrioridade[];
  vinculos?: VinculoAvaliacao[];
}

export interface RegistroEntregavel {
  id: string; bloco_id: string; bloco_nome: string; titulo: string;
  data_entrega: string | null; tempo_estimado_horas: number | null;
  concluido: number; tipo_tarefa: string | null;
}
export interface RegistroLista {
  id: string; bloco_id: string; bloco_nome: string; titulo: string;
  data_prevista: string | null; tempo_estimado_min: number | null;
  status: string; contexto: string; tipo_tarefa: string | null;
}
export interface RegistroAvaliacao {
  id: string; bloco_id: string; bloco_nome: string; titulo: string;
  data_prevista: string | null; tempo_estimado_min: number | null;
  nota: number | null; feita?: number; realizada?: number; tipo_tarefa: string | null;
}

/** Quais atividades realizam cada avaliação. */
export interface VinculoAvaliacao {
  avaliacao_id: string;
  item_tipo: 'entregavel' | 'lista_questoes';
  item_id: string;
}
export interface RegistroRevisao {
  id: string; numero: number; data_prevista: string; status: string;
  topico_id: string; topico_titulo: string; topico_peso: string;
  bloco_id: string; bloco_nome: string;
}
export interface AjustePrioridade {
  item_tipo: string; item_id: string; direcao: 'promover' | 'rebaixar'; magnitude: number;
}

export interface ItemCronograma {
  tipo: TipoItem;
  id: string;
  titulo: string;
  blocoId: string;
  blocoNome: string;
  classe: ClasseItem;
  prazo: string | null;
  /** Dias até o prazo; negativo quando já passou. Null sem prazo. */
  diasAteOPrazo: number | null;
  /** Minutos de trabalho ainda pendentes, já calibrados. */
  trabalhoRestanteMin: number;
  /** Só informativo, para a nota discreta da calibração. */
  motivoCalibracao: string;
  tipoTarefa: string | null;
  /** Pontuação interna: nunca exibida ao usuário. */
  pontuacao: number;
  grupo: Grupo;
  /** Texto curto que explica por que o item está onde está. */
  motivo: string;
  ajuste: 'promover' | 'rebaixar' | null;
  /** Rebaixamento desfeito porque o prazo entrou na saturação. */
  ajusteExpirado: boolean;
  /** Dados extras usados pelas telas. */
  detalhe?: Record<string, unknown>;
}

// ===========================================================================
// Auxiliares
// ===========================================================================
const MS_DIA = 86400000;

function diasEntre(de: string, ate: string) {
  const a = new Date(de + 'T12:00:00').getTime();
  const b = new Date(ate + 'T12:00:00').getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / MS_DIA);
}

/**
 * Folga normalizada: quanto tempo há em relação ao trabalho que falta.
 * Folga ≤ 1 (não cabe mais no prazo) satura em 1; folga grande tende a 0.
 */
export function termoFolga(diasAteOPrazo: number, trabalhoMin: number, orcamentoDiaMin: number) {
  const trabalhoEmDias = trabalhoMin / Math.max(orcamentoDiaMin, 1);
  // Já passou do prazo, ou não cabe: urgência máxima.
  if (diasAteOPrazo <= 0 || trabalhoEmDias <= 0) return 1;
  const folga = diasAteOPrazo / trabalhoEmDias;
  if (folga <= 1) return 1;
  // Curva decrescente suave: folga 2 → 0,5; folga 4 → 0,25.
  return Math.min(1, 1 / folga);
}

/** Urgência só pelo prazo: decaimento exponencial que satura perto do fim. */
export function termoUrgencia(diasAteOPrazo: number) {
  if (diasAteOPrazo <= DIAS_SATURACAO) return 1;
  const excedente = diasAteOPrazo - DIAS_SATURACAO;
  return 2 ** (-excedente / MEIA_VIDA_DIAS);
}

function textoDoPrazo(dias: number) {
  if (dias < -1) return `Prazo há ${Math.abs(dias)} dias`;
  if (dias === -1) return 'Prazo era ontem';
  if (dias === 0) return 'Prazo hoje';
  if (dias === 1) return 'Prazo amanhã';
  return `Prazo em ${dias} dias`;
}

// ===========================================================================
// Pipeline
// ===========================================================================
interface ItemBruto {
  tipo: TipoItem;
  id: string;
  titulo: string;
  blocoId: string;
  blocoNome: string;
  classe: ClasseItem;
  prazo: string | null;
  tipoTarefa: string | null;
  /** Minutos estimados antes da calibração. */
  estimadoMin: number;
  /** Fração ainda pendente do trabalho, de 0 a 1. Zero sai da fila. */
  fracaoRestante: number;
  detalhe?: Record<string, unknown>;
}

/** Etapas 1 e 3: estimativa e fração pendente, por tipo de item. */
function coletarItens(dados: DadosCronograma): ItemBruto[] {
  const itens: ItemBruto[] = [];

  // Uma avaliação vinculada é REALIZADA pelas atividades vinculadas: o trabalho
  // é representado por elas, e a avaliação sai da fila como item próprio. Sem
  // isso, o mesmo trabalho entraria duas vezes.
  const vinculos = dados.vinculos ?? [];
  const avaliacaoComItens = new Set(vinculos.map((v) => v.avaliacao_id));
  const prazoDaAvaliacao = new Map<string, string | null>();
  for (const v of vinculos) {
    const a = dados.avaliacoes.find((x) => x.id === v.avaliacao_id);
    if (a) prazoDaAvaliacao.set(`${v.item_tipo}:${v.item_id}`, a.data_prevista);
  }
  // Item vinculado sem data própria herda a data da avaliação como prazo.
  const prazoHerdado = (tipo: 'entregavel' | 'lista_questoes', id: string, proprio: string | null) =>
    proprio ?? prazoDaAvaliacao.get(`${tipo}:${id}`) ?? null;

  for (const e of dados.entregaveis) {
    if (e.concluido === 1) continue; // concluído sai da fila
    itens.push({
      tipo: 'entregavel',
      id: e.id,
      titulo: e.titulo,
      blocoId: e.bloco_id,
      blocoNome: e.bloco_nome,
      classe: 'projeto',
      prazo: prazoHerdado('entregavel', e.id, e.data_entrega),
      tipoTarefa: e.tipo_tarefa,
      estimadoMin: (e.tempo_estimado_horas ?? 0) * 60,
      fracaoRestante: 1,
    });
  }

  for (const l of dados.listas) {
    if (l.status === 'completa') continue;
    itens.push({
      tipo: 'lista',
      id: l.id,
      titulo: l.titulo,
      blocoId: l.bloco_id,
      blocoNome: l.bloco_nome,
      classe: l.contexto === 'projeto' ? 'projeto' : 'prova',
      prazo: prazoHerdado('lista_questoes', l.id, l.data_prevista),
      tipoTarefa: l.tipo_tarefa,
      estimadoMin: l.tempo_estimado_min ?? 0,
      fracaoRestante: l.status === 'incompleta' ? 0.5 : 1,
      detalhe: { status: l.status },
    });
  }

  for (const a of dados.avaliacoes) {
    // Concluída por qualquer um destes caminhos: nota registrada, marcada como
    // feita, ou marcada como realizada (a prova aconteceu, a nota não saiu).
    if (a.feita === 1 || a.realizada === 1) continue;
    if (a.nota !== null && a.nota !== undefined) continue;
    // Com atividades vinculadas, o trabalho está nelas: a avaliação não entra
    // como item próprio, para não ser contada duas vezes.
    if (avaliacaoComItens.has(a.id)) continue;
    // Avaliação sem prazo nem tempo existe só para a média: não entra na fila.
    if (!a.data_prevista && !a.tempo_estimado_min) continue;
    itens.push({
      tipo: 'avaliacao',
      id: a.id,
      titulo: a.titulo,
      blocoId: a.bloco_id,
      blocoNome: a.bloco_nome,
      classe: 'prova',
      prazo: a.data_prevista,
      tipoTarefa: a.tipo_tarefa,
      estimadoMin: a.tempo_estimado_min ?? 0,
      fracaoRestante: 1,
    });
  }

  for (const r of dados.revisoes) {
    itens.push({
      tipo: 'revisao',
      id: r.id,
      titulo: r.topico_titulo,
      blocoId: r.bloco_id,
      blocoNome: r.bloco_nome,
      classe: 'aprendizagem',
      prazo: r.data_prevista,
      tipoTarefa: null,
      estimadoMin: TEMPO_REVISAO_POR_PESO[r.topico_peso] ?? TEMPO_REVISAO_POR_PESO.medio,
      fracaoRestante: 1,
      detalhe: { numero: r.numero, status: r.status, topicoId: r.topico_id },
    });
  }

  return itens;
}

/** Monta a fila completa, pontuada, ordenada e agrupada. */
export function montarCronograma(dados: DadosCronograma): ItemCronograma[] {
  const orcamentoDia = Number(dados.config?.orcamento_diario_min) || ORCAMENTO_PADRAO_MIN;
  const ajustes = new Map(dados.ajustes.map((a) => [`${a.item_tipo}:${a.item_id}`, a]));

  const itens = coletarItens(dados).map((bruto): ItemCronograma => {
    // 2. CALIBRAÇÃO
    const calib = fatorCalibracao(bruto.tipoTarefa, dados.historico);
    const calibrado = bruto.estimadoMin * calib.fator;
    // 3. TRABALHO RESTANTE
    const trabalhoRestanteMin = Math.round(calibrado * bruto.fracaoRestante);

    const dias = bruto.prazo ? diasEntre(dados.hoje, bruto.prazo) : null;

    // 4 e 5. FOLGA e URGÊNCIA ABSOLUTA
    // Sem prazo, a folga não existe: sobra só o termo de urgência, neutro.
    const folga = dias === null ? 0 : termoFolga(dias, trabalhoRestanteMin, orcamentoDia);
    const urgencia = dias === null ? 0 : termoUrgencia(dias);

    // 6. COMBINAÇÃO
    let pontuacao = PESO_FOLGA * folga + PESO_URGENCIA_ABSOLUTA * urgencia;
    // Item sem prazo fica num piso baixo, presente mas nunca disputando o topo.
    if (dias === null) pontuacao = 0.15;

    // 7. CLASSE
    if (bruto.classe === 'aprendizagem') pontuacao *= PESO_CLASSE_APRENDIZAGEM;

    // 8. AJUSTE MANUAL
    const ajuste = ajustes.get(`${bruto.tipo}:${bruto.id}`) ?? null;
    const saturado = dias !== null && dias <= DIAS_SATURACAO;
    // Rebaixamento cede diante de um fato novo: o prazo chegou perto.
    const ajusteExpirado = Boolean(ajuste) && ajuste!.direcao === 'rebaixar' && saturado;
    if (ajuste && !ajusteExpirado) {
      const desloc = PASSO_AJUSTE_MANUAL * Math.max(1, ajuste.magnitude);
      pontuacao += ajuste.direcao === 'promover' ? desloc : -desloc;
    }
    pontuacao = Math.max(0, pontuacao);

    return {
      tipo: bruto.tipo,
      id: bruto.id,
      titulo: bruto.titulo,
      blocoId: bruto.blocoId,
      blocoNome: bruto.blocoNome,
      classe: bruto.classe,
      prazo: bruto.prazo,
      diasAteOPrazo: dias,
      trabalhoRestanteMin,
      motivoCalibracao: calib.motivo,
      tipoTarefa: bruto.tipoTarefa,
      pontuacao,
      grupo: 'depois',
      motivo: motivoDoItem(bruto, dias, trabalhoRestanteMin, orcamentoDia),
      ajuste: ajuste ? ajuste.direcao : null,
      ajusteExpirado,
      detalhe: bruto.detalhe,
    };
  });

  // 9. ORDENAÇÃO E AGRUPAMENTO
  // Empate acontece de verdade: quando nada mais cabe no prazo, vários itens
  // saturam no mesmo valor. Aí decide o prazo mais próximo, nunca a ordem em
  // que os itens saíram do banco.
  itens.sort((a, b) => {
    if (b.pontuacao !== a.pontuacao) return b.pontuacao - a.pontuacao;
    const pa = a.diasAteOPrazo ?? Infinity;
    const pb = b.diasAteOPrazo ?? Infinity;
    if (pa !== pb) return pa - pb;
    return a.titulo.localeCompare(b.titulo, 'pt-BR');
  });
  for (const item of itens) item.grupo = agrupar(item);
  return itens;
}

function agrupar(item: ItemCronograma): Grupo {
  const dias = item.diasAteOPrazo;
  if (dias === null) return 'depois';
  if (dias <= 0) return 'hoje';

  if (dias > HORIZONTE_DIAS) {
    // Item grande entra cedo: melhor descobrir agora que na última semana.
    const diasDeTrabalho = item.trabalhoRestanteMin / ORCAMENTO_PADRAO_MIN;
    const entraCedo = dias < MULTIPLO_HORIZONTE * diasDeTrabalho;
    return entraCedo ? 'depois' : 'alem_horizonte';
  }

  if (dias <= 1) return 'hoje';
  if (dias <= 7) return 'semana';
  return 'depois';
}

/** Motivo em texto — é isso que o usuário lê, nunca o número. */
function motivoDoItem(
  bruto: ItemBruto,
  dias: number | null,
  trabalhoMin: number,
  orcamentoDia: number
) {
  if (bruto.tipo === 'revisao' && dias !== null && dias < 0) {
    return `Revisão atrasada há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'}`;
  }
  if (dias === null) return 'Sem prazo definido';

  const diasDeTrabalho = trabalhoMin / Math.max(orcamentoDia, 1);
  if (dias > 0 && trabalhoMin > 0 && dias < diasDeTrabalho * 1.5) {
    return 'Pouco tempo para o trabalho restante';
  }
  return textoDoPrazo(dias);
}

// ===========================================================================
// Sugestões do dia
// ===========================================================================
export interface SugestoesDoDia {
  itens: ItemCronograma[];
  /** Soma do trabalho restante dos itens escolhidos. */
  totalMin: number;
  orcamentoMin: number;
}

/**
 * Monta a lista do dia sobre a fila já ordenada.
 * Variar de bloco e de modo importa mais do que espremer tudo de um assunto só,
 * então itens repetidos do mesmo bloco/modo perdem pontos — mas os realmente
 * urgentes sobrevivem ao desconto.
 */
export function sugestoesDoDia(fila: ItemCronograma[], orcamentoMin: number): SugestoesDoDia {
  // Escolha gulosa: a cada passo o desconto é recalculado sobre o que já foi
  // escolhido. Aplicar o desconto numa passada só e reordenar depois faria a
  // penalidade virar penalidade de posição — o terceiro item seria descontado
  // por ser o terceiro, mesmo vindo de outro bloco.
  const restantes = [...fila];
  const porBloco = new Map<string, number>();
  const porModo = new Map<string, number>();
  const escolhidos: ItemCronograma[] = [];
  let total = 0;

  while (restantes.length > 0) {
    let melhor = 0;
    let melhorPontuacao = -Infinity;
    for (let i = 0; i < restantes.length; i++) {
      const item = restantes[i];
      const repeticoes = (porBloco.get(item.blocoId) ?? 0) + (porModo.get(item.classe) ?? 0);
      const pontuacao = Math.max(0, item.pontuacao * (1 - PENALIDADE_REPETICAO * repeticoes));
      if (pontuacao > melhorPontuacao) {
        melhorPontuacao = pontuacao;
        melhor = i;
      }
    }

    const [item] = restantes.splice(melhor, 1);

    // O primeiro item entra mesmo estourando o orçamento: é o mais prioritário,
    // e escondê-lo não o faria sumir.
    const cabe = escolhidos.length === 0 || total + item.trabalhoRestanteMin <= orcamentoMin;
    if (!cabe) continue;

    escolhidos.push(item);
    total += item.trabalhoRestanteMin;
    porBloco.set(item.blocoId, (porBloco.get(item.blocoId) ?? 0) + 1);
    porModo.set(item.classe, (porModo.get(item.classe) ?? 0) + 1);
  }

  return { itens: escolhidos, totalMin: total, orcamentoMin };
}

/**
 * Magnitude de um arraste: quantas posições o item andou.
 * O usuário nunca vê nem digita esse número.
 */
export function magnitudeDoArraste(de: number, para: number) {
  return Math.max(1, Math.abs(para - de));
}
