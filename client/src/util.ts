import type {
  LinhaAvaliacao,
  LinhaEditor,
  Natureza,
  OrigemLista,
  Peso,
  Questao,
  RespostaGabarito,
  StatusLista,
  Topico,
  TopicoSugerido,
} from './tipos';

export function cn(...partes: Array<string | false | null | undefined>) {
  return partes.filter(Boolean).join(' ');
}

export const novoId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------------------------------------------------------------------------
// Datas (tudo em ISO curto, aaaa-mm-dd)
// ---------------------------------------------------------------------------
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function somarDias(dataISO: string, dias: number) {
  const d = new Date(dataISO + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function formatarData(iso: string | null | undefined) {
  if (!iso) return '—';
  const base = iso.slice(0, 10);
  const [a, m, d] = base.split('-');
  if (!a || !m || !d) return base;
  return `${d}/${m}/${a}`;
}

export function formatarDataHora(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatarData(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Rótulo relativo neutro — nunca usa linguagem de cobrança. */
export function diasRelativos(dataISO: string) {
  const alvo = new Date(dataISO + 'T12:00:00').getTime();
  const hoje = new Date(hojeISO() + 'T12:00:00').getTime();
  const dias = Math.round((alvo - hoje) / 86400000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  if (dias === -1) return 'ontem';
  if (dias > 1) return `em ${dias} dias`;
  return `há ${Math.abs(dias)} dias`;
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------
export const ROTULO_NATUREZA: Record<Natureza, string> = {
  declarativo: 'Declarativo',
  procedimental: 'Procedimental',
  relacional: 'Relacional',
};

export const ROTULO_PESO: Record<Peso, string> = {
  baixo: 'Baixo',
  medio: 'Médio',
  alto: 'Alto',
};

export const CORES_NATUREZA: Record<Natureza, string> = {
  declarativo: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  procedimental: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  relacional: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
};

/** Protocolo de sondagem exibido ao usuário, por natureza do tópico. */
export const PROTOCOLO: Record<Natureza, string> = {
  declarativo: 'Explique o conceito como se eu não soubesse nada sobre o assunto.',
  procedimental: 'Resolva um exemplo explicando cada passo e por que ele é necessário.',
  relacional: "Vou fazer perguntas do tipo 'e se...' sobre o comportamento do sistema.",
};

// ---------------------------------------------------------------------------
// Conversões entre a árvore do banco e as linhas do editor
// ---------------------------------------------------------------------------

/** Tópicos do banco (pai + ordem) → linhas em ordem de exibição, com nível. */
export function topicosParaLinhas(topicos: Topico[]): LinhaEditor[] {
  const filhos = new Map<string | null, Topico[]>();
  for (const t of topicos) {
    const chave = t.topico_pai_id ?? null;
    if (!filhos.has(chave)) filhos.set(chave, []);
    filhos.get(chave)!.push(t);
  }
  for (const lista of filhos.values()) lista.sort((a, b) => a.ordem - b.ordem);

  const saida: LinhaEditor[] = [];
  const visitados = new Set<string>();
  const percorrer = (pai: string | null, nivel: number) => {
    for (const t of filhos.get(pai) ?? []) {
      if (visitados.has(t.id)) continue; // protege contra ciclos acidentais
      visitados.add(t.id);
      saida.push({ id: t.id, titulo: t.titulo, natureza: t.natureza, peso: t.peso, nivel });
      percorrer(t.id, nivel + 1);
    }
  };
  percorrer(null, 0);
  // Qualquer tópico órfão entra no fim, no primeiro nível.
  for (const t of topicos) {
    if (!visitados.has(t.id)) {
      saida.push({ id: t.id, titulo: t.titulo, natureza: t.natureza, peso: t.peso, nivel: 0 });
    }
  }
  return saida;
}

/** Linhas do editor → payload da API (pai derivado do nível). */
export function linhasParaPayload(linhas: LinhaEditor[]) {
  const ultimoPorNivel: Record<number, string> = {};
  return linhas.map((l, i) => {
    ultimoPorNivel[l.nivel] = l.id;
    const pai = l.nivel === 0 ? null : (ultimoPorNivel[l.nivel - 1] ?? null);
    return {
      id: l.id,
      titulo: l.titulo.trim() || 'Sem título',
      natureza: l.natureza,
      peso: l.peso,
      ordem: i,
      topico_pai_id: pai,
    };
  });
}

/** Sugestões da IA (pai por título) → linhas do editor. */
export function sugestoesParaLinhas(sugestoes: TopicoSugerido[]): LinhaEditor[] {
  const nivelPorTitulo = new Map<string, number>();
  const linhas: LinhaEditor[] = [];
  for (const s of sugestoes) {
    const chavePai = s.topico_pai?.toLowerCase() ?? null;
    const nivelPai = chavePai != null ? nivelPorTitulo.get(chavePai) : undefined;
    const nivel = nivelPai === undefined ? 0 : Math.min(nivelPai + 1, 5);
    nivelPorTitulo.set(s.titulo.toLowerCase(), nivel);
    linhas.push({ id: novoId(), titulo: s.titulo, natureza: s.natureza, peso: s.peso, nivel });
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Operações estruturais do editor (sem drag-and-drop)
// ---------------------------------------------------------------------------

/** Índice logo após o fim da subárvore que começa em `i`. */
export function fimDaSubarvore(linhas: LinhaEditor[], i: number) {
  let j = i + 1;
  while (j < linhas.length && linhas[j].nivel > linhas[i].nivel) j++;
  return j;
}

export const NIVEL_MAXIMO = 5;

export function podeSubir(linhas: LinhaEditor[], i: number) {
  return indiceIrmaoAnterior(linhas, i) !== -1;
}

export function podeDescer(linhas: LinhaEditor[], i: number) {
  const fim = fimDaSubarvore(linhas, i);
  return fim < linhas.length && linhas[fim].nivel === linhas[i].nivel;
}

export function podeRebaixar(linhas: LinhaEditor[], i: number) {
  return i > 0 && linhas[i].nivel <= linhas[i - 1].nivel && linhas[i].nivel < NIVEL_MAXIMO;
}

export function podePromover(linhas: LinhaEditor[], i: number) {
  return linhas[i].nivel > 0;
}

function indiceIrmaoAnterior(linhas: LinhaEditor[], i: number) {
  const nivel = linhas[i].nivel;
  for (let j = i - 1; j >= 0; j--) {
    if (linhas[j].nivel === nivel) return j;
    if (linhas[j].nivel < nivel) return -1;
  }
  return -1;
}

export function moverParaCima(linhas: LinhaEditor[], i: number): LinhaEditor[] {
  const anterior = indiceIrmaoAnterior(linhas, i);
  if (anterior === -1) return linhas;
  const fim = fimDaSubarvore(linhas, i);
  const bloco = linhas.slice(i, fim);
  const resto = [...linhas.slice(0, i), ...linhas.slice(fim)];
  resto.splice(anterior, 0, ...bloco);
  return resto;
}

export function moverParaBaixo(linhas: LinhaEditor[], i: number): LinhaEditor[] {
  if (!podeDescer(linhas, i)) return linhas;
  const fim = fimDaSubarvore(linhas, i);
  const fimDoProximo = fimDaSubarvore(linhas, fim);
  const bloco = linhas.slice(i, fim);
  const proximo = linhas.slice(fim, fimDoProximo);
  return [...linhas.slice(0, i), ...proximo, ...bloco, ...linhas.slice(fimDoProximo)];
}

export function rebaixar(linhas: LinhaEditor[], i: number): LinhaEditor[] {
  if (!podeRebaixar(linhas, i)) return linhas;
  const fim = fimDaSubarvore(linhas, i);
  return linhas.map((l, j) => (j >= i && j < fim ? { ...l, nivel: l.nivel + 1 } : l));
}

export function promover(linhas: LinhaEditor[], i: number): LinhaEditor[] {
  if (!podePromover(linhas, i)) return linhas;
  const fim = fimDaSubarvore(linhas, i);
  return linhas.map((l, j) => (j >= i && j < fim ? { ...l, nivel: l.nivel - 1 } : l));
}

export function excluirLinha(linhas: LinhaEditor[], i: number): LinhaEditor[] {
  const fim = fimDaSubarvore(linhas, i);
  return [...linhas.slice(0, i), ...linhas.slice(fim)];
}

export function inserirIrmao(linhas: LinhaEditor[], i: number): LinhaEditor[] {
  const nova: LinhaEditor = { id: novoId(), titulo: '', natureza: 'declarativo', peso: 'medio', nivel: linhas[i].nivel };
  const fim = fimDaSubarvore(linhas, i);
  return [...linhas.slice(0, fim), nova, ...linhas.slice(fim)];
}

export function inserirFilho(linhas: LinhaEditor[], i: number): LinhaEditor[] {
  const nivel = Math.min(linhas[i].nivel + 1, NIVEL_MAXIMO);
  const nova: LinhaEditor = { id: novoId(), titulo: '', natureza: 'declarativo', peso: 'medio', nivel };
  return [...linhas.slice(0, i + 1), nova, ...linhas.slice(i + 1)];
}

// ---------------------------------------------------------------------------
// Listas de questões
// ---------------------------------------------------------------------------
export const ROTULO_ORIGEM: Record<OrigemLista, string> = {
  enviada: 'Enviada',
  gerada_fontes: 'Gerada de documentos',
  gerada_internet: 'Gerada da internet',
  gerada_geral: 'Gerada por conhecimento geral',
};

export const ROTULO_STATUS_LISTA: Record<StatusLista, string> = {
  nao_feita: 'Não feita',
  incompleta: 'Incompleta',
  completa: 'Completa',
};

export const STATUS_LISTA: StatusLista[] = ['nao_feita', 'incompleta', 'completa'];

/**
 * Questões e gabarito são guardados como JSON quando gerados pela IA e como
 * texto puro quando a lista foi colada ou enviada pelo usuário. Estas funções
 * devolvem a forma estruturada quando existir, e o texto cru caso contrário.
 */
export function lerQuestoes(bruto: string | null): Questao[] | string {
  if (!bruto) return '';
  try {
    const dados = JSON.parse(bruto);
    if (Array.isArray(dados) && dados.every((q) => q && typeof q.enunciado === 'string')) {
      return dados as Questao[];
    }
  } catch {
    /* não era JSON: é texto puro */
  }
  return bruto;
}

export function lerGabarito(bruto: string | null): RespostaGabarito[] | string | null {
  if (!bruto) return null;
  try {
    const dados = JSON.parse(bruto);
    if (Array.isArray(dados) && dados.every((g) => g && typeof g.resposta === 'string')) {
      return dados as RespostaGabarito[];
    }
  } catch {
    /* não era JSON: é texto puro */
  }
  return bruto;
}

/** Converte um texto colado em questões numeradas, quando possível. */
export function textoParaQuestoes(texto: string): Questao[] | string {
  const linhas = texto.split(/\n\s*(?=\d+[).\s])/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length < 2) return texto;
  return linhas.map((linha, i) => {
    const casou = linha.match(/^(\d+)[).\s]\s*([\s\S]*)$/);
    return {
      numero: casou ? Number(casou[1]) : i + 1,
      enunciado: (casou ? casou[2] : linha).trim(),
    };
  });
}

export const contarQuestoes = (questoes: Questao[] | string) =>
  Array.isArray(questoes) ? questoes.length : 0;

// ---------------------------------------------------------------------------
// Painel Acadêmico — aritmética de médias
//
// Nada aqui é um julgamento da plataforma: as notas são dado acadêmico
// informado pelo usuário, e o cálculo é a aritmética que ele mesmo faria.
// ---------------------------------------------------------------------------

export const numeroOuNulo = (v: string | number | null | undefined): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export type SituacaoMedia =
  | 'sem_dados'
  | 'em_andamento'
  | 'garantida'
  | 'inalcancavel'
  | 'sem_restantes';

export interface ResultadoMedias {
  /** Só avaliações com nota informada, ponderada por peso. */
  mediaAtual: number | null;
  /** Notas reais + simuladas; as demais assumem a média atual. */
  mediaProjetada: number | null;
  /** Média exigida nas restantes para atingir a média de aprovação. */
  notaNecessaria: number | null;
  situacao: SituacaoMedia;
  pesoTotal: number;
  pesoComNota: number;
  pesoRestante: number;
  /** Escala inferida das notas informadas (10 ou 100), usada só para dizer se algo é inalcançável. */
  escala: number;
  avisoPesos: string | null;
}

/**
 * `somaEsperada` é o total que os pesos deveriam fechar (10, 100…), escolhido
 * pelo usuário. Com `null`, os pesos são tratados como relativos e só um
 * quase-acerto (a menos de 5% de 10 ou 100) é sinalizado como possível engano.
 */
export function calcularMedias(
  linhas: LinhaAvaliacao[],
  simuladas: Record<string, string>,
  mediaAprovacao: number | null,
  somaEsperada: number | null = null
): ResultadoMedias {
  const itens = linhas.map((l) => ({
    peso: numeroOuNulo(l.peso) ?? 0,
    nota: numeroOuNulo(l.nota),
    simulada: numeroOuNulo(simuladas[l.id] ?? ''),
    semPeso: numeroOuNulo(l.peso) === null,
  }));

  const pesoTotal = itens.reduce((s, i) => s + i.peso, 0);
  const comNota = itens.filter((i) => i.nota !== null);
  const pesoComNota = comNota.reduce((s, i) => s + i.peso, 0);
  const pesoRestante = pesoTotal - pesoComNota;

  const mediaAtual =
    pesoComNota > 0 ? comNota.reduce((s, i) => s + (i.nota ?? 0) * i.peso, 0) / pesoComNota : null;

  // Escala: 100 quando alguma nota ou a média de aprovação passa de 10; senão 10.
  const valores = [
    ...itens.map((i) => i.nota ?? 0),
    ...itens.map((i) => i.simulada ?? 0),
    mediaAprovacao ?? 0,
  ];
  const escala = valores.some((v) => v > 10) ? 100 : 10;

  // Projeção: notas reais, depois as simuladas, e o que sobrar assume a média atual.
  let mediaProjetada: number | null = null;
  if (pesoTotal > 0 && (mediaAtual !== null || itens.some((i) => i.simulada !== null))) {
    const baseParaOResto = mediaAtual ?? 0;
    const soma = itens.reduce((s, i) => {
      const valor = i.nota ?? i.simulada ?? baseParaOResto;
      return s + valor * i.peso;
    }, 0);
    mediaProjetada = soma / pesoTotal;
  }

  // Nota necessária nas restantes para fechar a média de aprovação.
  let notaNecessaria: number | null = null;
  let situacao: SituacaoMedia = 'sem_dados';

  if (mediaAprovacao === null || pesoTotal === 0) {
    situacao = 'sem_dados';
  } else if (pesoRestante <= 0) {
    situacao = 'sem_restantes';
  } else {
    const acumulado = comNota.reduce((s, i) => s + (i.nota ?? 0) * i.peso, 0);
    notaNecessaria = (mediaAprovacao * pesoTotal - acumulado) / pesoRestante;
    if (notaNecessaria <= 0) situacao = 'garantida';
    else if (notaNecessaria > escala) situacao = 'inalcancavel';
    else situacao = 'em_andamento';
  }

  // Aviso informativo sobre os pesos — nunca impede o uso da calculadora.
  let avisoPesos: string | null = null;
  const semPeso = itens.filter((i) => i.semPeso).length;
  const quaseFecha = [10, 100].find(
    (alvo) => Math.abs(pesoTotal - alvo) > 1e-9 && Math.abs(pesoTotal - alvo) <= alvo * 0.05
  );

  if (semPeso > 0) {
    avisoPesos =
      semPeso === 1
        ? 'Uma avaliação está sem peso e por isso não entra no cálculo.'
        : `${semPeso} avaliações estão sem peso e por isso não entram no cálculo.`;
  } else if (somaEsperada !== null && Math.abs(pesoTotal - somaEsperada) > 1e-9) {
    avisoPesos = `A soma dos pesos é ${formatarNota(pesoTotal)}, e não ${formatarNota(somaEsperada)}.`;
  } else if (somaEsperada === null && quaseFecha) {
    avisoPesos = `A soma dos pesos é ${formatarNota(pesoTotal)} — perto de ${quaseFecha}, mas não exatamente.`;
  }

  return {
    mediaAtual,
    mediaProjetada,
    notaNecessaria,
    situacao,
    pesoTotal,
    pesoComNota,
    pesoRestante,
    escala,
    avisoPesos,
  };
}

export function formatarNota(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Texto neutro sobre as faltas restantes. Nunca cobrança nem culpa. */
export function textoFaltas(registradas: number, limite: number | null) {
  if (limite === null || limite <= 0) return 'Sem limite de faltas registrado.';
  const restam = limite - registradas;
  if (restam > 1) return `Restam ${restam} faltas.`;
  if (restam === 1) return 'Resta 1 falta.';
  if (restam === 0) return 'O limite de faltas foi atingido.';
  return `O limite foi ultrapassado em ${Math.abs(restam)} ${Math.abs(restam) === 1 ? 'falta' : 'faltas'}.`;
}

/** Formata uma duração em milissegundos como "1 h 12 min" ou "48 s". */
export function formatarDuracao(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

/** Cronômetro em hh:mm:ss. */
export function relogio(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
