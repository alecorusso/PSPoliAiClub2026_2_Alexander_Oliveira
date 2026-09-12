import type { LinhaEditor, Natureza, Peso, Topico, TopicoSugerido } from './tipos';

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
