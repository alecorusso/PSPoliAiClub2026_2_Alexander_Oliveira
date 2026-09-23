/**
 * Repositório de documentos do bloco.
 *
 * Um documento existe uma única vez por bloco: quem decide é o hash do
 * conteúdo, calculado no servidor. Excluir um documento nunca apaga o que foi
 * gerado a partir dele.
 */

export type CategoriaDocumento =
  | 'ementa'
  | 'livro_apostila'
  | 'lista_exercicios'
  | 'prova_antiga'
  | 'roteiro_projeto'
  | 'calendario'
  | 'outro';

export const CATEGORIAS: { id: CategoriaDocumento; rotulo: string }[] = [
  { id: 'ementa', rotulo: 'Ementa' },
  { id: 'livro_apostila', rotulo: 'Livro ou apostila' },
  { id: 'lista_exercicios', rotulo: 'Lista de exercícios' },
  { id: 'prova_antiga', rotulo: 'Prova antiga' },
  { id: 'roteiro_projeto', rotulo: 'Roteiro de projeto' },
  { id: 'calendario', rotulo: 'Calendário' },
  { id: 'outro', rotulo: 'Outro' },
];

export const rotuloCategoria = (c: string | null) =>
  CATEGORIAS.find((x) => x.id === c)?.rotulo ?? 'Outro';

export type TipoUso =
  | 'tabela_conteudos'
  | 'lista_questoes'
  | 'roteiro_projeto'
  | 'importacao_calendario';

export const ROTULO_USO: Record<TipoUso, { um: string; muitos: string }> = {
  tabela_conteudos: { um: 'tabela de conteúdos', muitos: 'tabelas de conteúdos' },
  lista_questoes: { um: 'lista', muitos: 'listas' },
  roteiro_projeto: { um: 'montagem de projeto', muitos: 'montagens de projeto' },
  importacao_calendario: { um: 'importação de calendário', muitos: 'importações de calendário' },
};

export interface Documento {
  id: string;
  bloco_id: string;
  nome_arquivo: string;
  categoria: CategoriaDocumento;
  criado_em: string;
  tamanho_bytes: number | null;
  tipo_mime: string | null;
  caminho_arquivo: string | null;
  caracteres: number | null;
  usos: { item_tipo: TipoUso; quantos: number }[];
  /** Processado no servidor: só 'pronto' pode ser escolhido nos fluxos. */
  status: StatusDocumento;
  etapa: 'extraindo' | 'dividindo' | 'indexando' | null;
  progresso_feito: number | null;
  progresso_total: number | null;
  /** Motivo da falha, espera pela API ou observação sobre a indexação. */
  motivo: string | null;
  /** 'semantico': busca por embeddings; 'palavras': busca por palavras-chave. */
  indice: 'semantico' | 'palavras' | null;
  paginas: number | null;
  tem_sumario: boolean;
  trechos: number;
  /** Ainda sem trechos, falhou ou com indexação incompleta. */
  precisa_indexar?: boolean;
}

export type StatusDocumento = 'processando' | 'pronto' | 'falhou';

/**
 * Situação do documento em uma linha curta, para a lista de materiais e o
 * seletor. Nulo quando está pronto e não há nada a dizer.
 */
export function situacaoDoDocumento(d: Documento): { texto: string; detalhe?: string } | null {
  // Status desconhecido nunca pode deixar o documento travado sem explicação.
  if (d.status !== 'pronto' && d.status !== 'processando' && d.status !== 'falhou') {
    return { texto: 'indisponível no momento', detalhe: d.motivo ?? undefined };
  }
  if (d.status === 'falhou') return { texto: 'não foi possível processar', detalhe: d.motivo ?? undefined };
  if (d.status === 'processando') {
    const de = (x: number | null, y: number | null, unidade: string) =>
      x != null && y ? `${x} de ${y} ${unidade}` : null;
    if (d.etapa === 'extraindo') {
      const p = de(d.progresso_feito, d.progresso_total, 'páginas');
      return { texto: p ? `lendo o arquivo: ${p}` : 'lendo o arquivo…' };
    }
    if (d.etapa === 'dividindo') return { texto: 'dividindo em trechos…' };
    if (d.etapa === 'indexando') {
      const p = de(d.progresso_feito, d.progresso_total, 'trechos');
      return { texto: p ? `indexando: ${p}` : 'indexando…', detalhe: d.motivo ?? undefined };
    }
    return { texto: 'na fila de processamento' };
  }
  // Pronto e ainda indexando: já pode ser usado; até terminar, palavras-chave.
  if (d.etapa === 'indexando') {
    const p = d.progresso_feito != null && d.progresso_total ? `${d.progresso_feito} de ${d.progresso_total} trechos` : null;
    return {
      texto: p ? `indexando: ${p} — já pode ser usado` : 'indexando — já pode ser usado',
      detalhe: d.motivo ?? undefined,
    };
  }
  // Pronto, mas a indexação parou no meio: segue pela busca por palavras-chave.
  if (d.indice === 'palavras' && d.motivo) {
    return { texto: 'busca por palavras-chave', detalhe: d.motivo };
  }
  return null;
}

/**
 * Por que o documento não pode ser escolhido agora, em uma frase completa —
 * para o texto ao lado da caixa e para o título ao passar o mouse.
 * Nulo quando pode ser escolhido. O TAMANHO nunca é motivo.
 */
export function motivoIndisponivel(d: Documento): string | null {
  if (d.status === 'pronto') return null;
  const s = situacaoDoDocumento(d);
  const base =
    d.status === 'falhou'
      ? 'Não pode ser usado: o processamento falhou'
      : 'Ainda sendo processado — fica disponível ao terminar';
  const partes = [base, s?.texto, s?.detalhe].filter(Boolean);
  return partes.join(' · ');
}

/** "usado em 3 listas · 1 tabela de conteúdos" */
export function textoDosUsos(usos: Documento['usos']) {
  if (usos.length === 0) return 'ainda não usado';
  const partes = usos.map((u) => {
    const r = ROTULO_USO[u.item_tipo];
    return `${u.quantos} ${u.quantos === 1 ? r.um : r.muitos}`;
  });
  return `usado em ${partes.join(' · ')}`;
}

export function formatarTamanho(bytes: number | null) {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Limite por arquivo — o mesmo do servidor (LIMITE_ARQUIVO_MB). */
export const LIMITE_ARQUIVO_MB = 100;



/** Categorias que cada fluxo sugere — sem esconder as demais. */
export const SUGESTOES_POR_FLUXO: Record<TipoUso, CategoriaDocumento[]> = {
  tabela_conteudos: ['ementa', 'livro_apostila'],
  lista_questoes: ['lista_exercicios', 'prova_antiga'],
  roteiro_projeto: ['roteiro_projeto'],
  importacao_calendario: ['calendario'],
};
