import type {
  Avaliacao,
  Bloco,
  Compromisso,
  ContextoLista,
  Entregavel,
  Evidencia,
  ListaQuestoes,
  Evento,
  Fusao,
  Mensagem,
  Modo,
  OrigemEstimativa,
  OrigemLista,
  OrigemPaginas,
  Pasta,
  Questao,
  Relacao,
  RespostaArvore,
  RespostaGabarito,
  RespostaLista,
  Revisao,
  SessaoFoco,
  StatusLista,
  SugestaoEntregavel,
  TipoRelacao,
  Topico,
} from './tipos';

/** Erro da API, sempre com mensagem legível. O código vem do servidor, quando há. */
export class ErroApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly codigo: string | null = null
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export const SERVIDOR_INESPERADO = 'O servidor não respondeu como esperado.';

/**
 * Lê a resposta da API. Se ela não vier em JSON (uma página de erro, um proxy
 * fora do ar), a mensagem é legível — nunca o erro técnico de parse.
 */
export async function lerResposta<T>(r: Response): Promise<T> {
  const texto = await r.text().catch(() => '');
  let dados: unknown = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new ErroApi(SERVIDOR_INESPERADO, r.status, 'resposta_nao_json');
    }
  }
  if (!r.ok) {
    const d = dados as { erro?: string; codigo?: string } | null;
    throw new ErroApi(d?.erro || `Falha na requisição (${r.status}).`, r.status, d?.codigo ?? null);
  }
  return dados as T;
}

/** fetch que nunca deixa escapar "Failed to fetch" cru. */
export async function chamarApi(caminho: string, opcoes: RequestInit = {}) {
  try {
    return await fetch('/api' + caminho, opcoes);
  } catch {
    throw new ErroApi('Não foi possível falar com o servidor. Ele está ligado?', 0, 'sem_conexao');
  }
}

async function pedir<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const r = await chamarApi(caminho, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
  });
  return lerResposta<T>(r);
}

const get = <T,>(c: string) => pedir<T>(c);
const post = <T,>(c: string, corpo?: unknown) =>
  pedir<T>(c, { method: 'POST', body: JSON.stringify(corpo ?? {}) });
const patch = <T,>(c: string, corpo: unknown) =>
  pedir<T>(c, { method: 'PATCH', body: JSON.stringify(corpo) });
const put = <T,>(c: string, corpo: unknown) =>
  pedir<T>(c, { method: 'PUT', body: JSON.stringify(corpo) });
const remover = (c: string) => pedir<{ ok: true }>(c, { method: 'DELETE' });

export interface EntradaTopico {
  id: string;
  titulo: string;
  natureza: string;
  peso: string;
  ordem: number;
  topico_pai_id: string | null;
}

export const api = {
  status: () => get<{ ok: boolean; ia: boolean }>('/status'),

  // pastas
  listarPastas: () => get<Pasta[]>('/pastas'),
  criarPasta: (dados: { nome: string; pasta_pai_id: string | null }) => post<Pasta>('/pastas', dados),
  atualizarPasta: (id: string, dados: Partial<Pasta>) => patch<Pasta>(`/pastas/${id}`, dados),
  excluirPasta: (id: string) => remover(`/pastas/${id}`),

  // blocos
  listarBlocos: () => get<Bloco[]>('/blocos'),
  obterBloco: (id: string) => get<Bloco>(`/blocos/${id}`),
  criarBloco: (dados: Record<string, unknown>) => post<Bloco>('/blocos', dados),
  atualizarBloco: (id: string, dados: Record<string, unknown>) => patch<Bloco>(`/blocos/${id}`, dados),
  excluirBloco: (id: string) => remover(`/blocos/${id}`),

  // relações
  listarRelacoes: (id: string) => get<Relacao[]>(`/blocos/${id}/relacoes`),
  /** A fusão é direcional e de duas ou mais origens: tem rota própria. */
  obterFusao: (id: string) => get<Fusao>(`/blocos/${id}/fusao`),
  salvarFusao: (id: string, origens: string[]) =>
    put<{ ok: true }>(`/blocos/${id}/fusao`, { origens }),
  desfazerFusao: (id: string) => remover(`/blocos/${id}/fusao`),
  criarRelacao: (id: string, dados: { bloco_destino_id: string; tipo: TipoRelacao }) =>
    post<{ id: string }>(`/blocos/${id}/relacoes`, dados),
  excluirRelacao: (id: string) => remover(`/relacoes/${id}`),

  // tópicos
  listarTopicos: (blocoId: string) => get<Topico[]>(`/blocos/${blocoId}/topicos`),
  salvarTopicos: (blocoId: string, topicos: EntradaTopico[], marcarConstruida = false) =>
    put<Topico[]>(`/blocos/${blocoId}/topicos`, { topicos, marcar_construida: marcarConstruida }),
  marcarCheck: (
    topicoId: string,
    marcado: boolean,
    evidencia?: { modo: string; descricao: string }
  ) => post<Topico>(`/topicos/${topicoId}/check`, { marcado, evidencia }),

  // evidências
  listarEvidencias: (blocoId: string) => get<Evidencia[]>(`/blocos/${blocoId}/evidencias`),

  // revisões
  listarRevisoes: (blocoId: string) => get<Revisao[]>(`/blocos/${blocoId}/revisoes`),
  concluirRevisao: (id: string) => post<{ ok: true }>(`/revisoes/${id}/concluir`),
  reagendarRevisao: (id: string, data: string) =>
    post<{ ok: true }>(`/revisoes/${id}/reagendar`, { data_prevista: data }),

  // documentos
  listarDocumentos: (blocoId: string) => get<Documento[]>(`/blocos/${blocoId}/documentos`),

  // IA (sempre via servidor — a chave nunca chega ao cliente)
  extrairTabela: (blocoId: string, documentos_ids?: string[]) =>
    post<RespostaArvore>('/ia/extrair-tabela', { bloco_id: blocoId, documentos_ids }),
  buscarRoteiro: (tema: string) => post<RespostaArvore>('/ia/roteiro', { tema }),

  // sondagem
  mensagensSondagem: (blocoId: string, topicoId: string) =>
    get<Mensagem[]>(`/sondagem/${blocoId}/${topicoId}/mensagens`),
  iniciarSondagem: (blocoId: string, topicoId: string) =>
    post<{ mensagens: Mensagem[]; erro: string | null }>('/sondagem/iniciar', {
      bloco_id: blocoId,
      topico_id: topicoId,
    }),
  enviarMensagem: (blocoId: string, topicoId: string, conteudo: string) =>
    post<{ mensagens: Mensagem[]; erro: string | null }>('/sondagem/mensagem', {
      bloco_id: blocoId,
      topico_id: topicoId,
      conteudo,
    }),

  /** Tipos de tarefa já usados, para o autocomplete. */
  tiposTarefa: () => get<string[]>('/tipos-tarefa'),
  /**
   * Lê um documento e propõe os eventos que ele menciona. Nada é gravado aqui:
   * a lista vai para a tela de revisão, e só o confirmado vira registro.
   */
  extrairEventos: (dados: {
    texto: string;
    documentos_ids?: string[];
    bloco_id: string | null;
    inicio_periodo: string | null;
    incluir_aulas: boolean;
  }) => post<{ eventos: ItemExtraido[]; erro: string | null }>('/ia/extrair-eventos', dados),

  /**
   * Decompõe o roteiro de um projeto em entregáveis. A IA estima o tamanho; as
   * datas são calculadas pelo cliente, em lib/distribuicaoDatas.
   */
  decomporRoteiro: (dados: {
    texto?: string;
    documentos_ids?: string[];
    bloco_id: string;
    inicio: string;
    fim: string;
  }) =>
    post<{
      entregaveis: EntregavelProposto[];
      topicos_sugeridos: string[];
      erro: string | null;
    }>('/ia/decompor-roteiro', dados),

  /** Estimativa da IA: falha nunca bloqueia, devolve minutos nulos e um erro. */
  estimarTempo: (descricao: string, tipo?: string | null, contexto?: string | null) =>
    post<{ minutos: number | null; erro: string | null }>('/ia/estimar-tempo', {
      descricao,
      tipo,
      contexto,
    }),

  // início
  inicio: () =>
    get<{ blocos_recentes: (Bloco & { pasta_nome: string | null })[]; revisoes_hoje: Revisao[]; hoje: string }>(
      '/inicio'
    ),
};

// ---------------------------------------------------------------------------
// Chat lateral do bloco (mensagens com topico_id nulo)
// ---------------------------------------------------------------------------
export const apiChat = {
  historico: (blocoId: string) => get<Mensagem[]>(`/blocos/${blocoId}/chat`),
  enviar: (blocoId: string, conteudo: string, modo: Modo) =>
    post<{ mensagens: Mensagem[]; erro: string | null }>(`/blocos/${blocoId}/chat`, { conteudo, modo }),
  limpar: (blocoId: string) => remover(`/blocos/${blocoId}/chat`),
};

// ---------------------------------------------------------------------------
// Listas de questões (Modo Prova e testes teóricos do Modo Projeto)
// ---------------------------------------------------------------------------
export const apiListas = {
  listar: (blocoId: string, contexto: ContextoLista) =>
    get<ListaQuestoes[]>(`/blocos/${blocoId}/listas?contexto=${contexto}`),
  obter: (id: string) => get<ListaQuestoes>(`/listas/${id}`),
  criar: (
    blocoId: string,
    dados: {
      topico_id: string | null;
      titulo: string;
      questoes: Questao[] | string;
      gabarito?: RespostaGabarito[] | string | null;
      origem: OrigemLista;
      quantidade?: number | null;
      contexto: ContextoLista;
      data_prevista?: string | null;
      tempo_estimado_min?: number | string | null;
      origem_estimativa?: OrigemEstimativa | null;
      tipo_tarefa?: string | null;
      /** Páginas de onde a lista gerada saiu. */
      origem_paginas?: OrigemPaginas[] | null;
    }
  ) => post<ListaQuestoes>(`/blocos/${blocoId}/listas`, dados),
  atualizar: (
    id: string,
    dados: {
      status?: StatusLista;
      titulo?: string;
      gabarito?: RespostaGabarito[] | string | null;
      data_prevista?: string | null;
    }
  ) =>
    patch<ListaQuestoes>(`/listas/${id}`, dados),
  excluir: (id: string) => remover(`/listas/${id}`),
  /** Injeta o contexto da lista no chat do bloco. Nunca altera o status. */
  corrigir: (id: string) => post<{ mensagens: Mensagem[]; erro: string | null }>(`/listas/${id}/corrigir`),

  gerar: (dados: {
    bloco_id: string;
    topico_id: string;
    quantidade: number;
    /** 'geral' só depois de o usuário confirmar que os documentos não tratam do tópico. */
    fonte: { tipo: 'documentos' | 'internet' | 'geral'; documentos_ids?: string[] };
  }) => post<RespostaLista>('/ia/lista-questoes', dados),
  gerarGabarito: (questoes: Questao[] | string) =>
    post<{ gabarito: RespostaGabarito[]; erro: string | null }>('/ia/gabarito', { questoes }),
};

// ---------------------------------------------------------------------------
// Entregáveis (Modo Projeto)
// ---------------------------------------------------------------------------
export const apiEntregaveis = {
  listar: (blocoId: string) => get<Entregavel[]>(`/blocos/${blocoId}/entregaveis`),
  criar: (blocoId: string, dados: Record<string, unknown>) =>
    post<Entregavel>(`/blocos/${blocoId}/entregaveis`, dados),
  atualizar: (id: string, dados: Record<string, unknown>) => patch<Entregavel>(`/entregaveis/${id}`, dados),
  excluir: (id: string) => remover(`/entregaveis/${id}`),
  /** Ao concluir, registra evidência por tópico e pode gerar testes teóricos. */
  concluir: (id: string, concluido: boolean) =>
    post<{ ok: true; testes_gerados: ListaQuestoes[]; erro: string | null }>(`/entregaveis/${id}/concluir`, {
      concluido,
    }),
  /** Apenas move a data. Nunca conta como atraso. */
  reagendar: (id: string, data: string) =>
    post<{ ok: true }>(`/entregaveis/${id}/reagendar`, { data_entrega: data }),
  sugerir: (blocoId: string, descricao: string) =>
    post<{ entregaveis: SugestaoEntregavel[]; erro: string | null }>('/ia/sugerir-entregaveis', {
      bloco_id: blocoId,
      descricao,
    }),
};

// ---------------------------------------------------------------------------
// Avaliações (painel Acadêmico)
// ---------------------------------------------------------------------------
export const apiAvaliacoes = {
  listar: (blocoId: string) => get<Avaliacao[]>(`/blocos/${blocoId}/avaliacoes`),
  /** Só move a data. A nota continua sendo informada no painel Acadêmico. */
  reagendar: (id: string, data: string) => patch<Avaliacao>(`/avaliacoes/${id}`, { data_prevista: data }),
  /** Marca que a avaliação já foi feita. Não inventa nota nenhuma. */
  concluir: (id: string, feita: boolean) => patch<Avaliacao>(`/avaliacoes/${id}`, { feita }),
  /** A prova aconteceu e a nota ainda não saiu: sai da fila, sem nota. */
  marcarRealizada: (id: string, realizada: boolean) =>
    patch<Avaliacao>(`/avaliacoes/${id}`, { realizada }),
  salvar: (blocoId: string, avaliacoes: Record<string, unknown>[]) =>
    put<Avaliacao[]>(`/blocos/${blocoId}/avaliacoes`, { avaliacoes }),
};

// ---------------------------------------------------------------------------
// Sessões de foco
// ---------------------------------------------------------------------------
export const apiFoco = {
  ativa: () => get<SessaoFoco | null>('/foco/ativa'),
  iniciar: (blocoId: string | null) => post<SessaoFoco>('/foco/iniciar', { bloco_id: blocoId }),
  encerrar: (id: string) => post<SessaoFoco & { decorrido_ms: number }>(`/foco/${id}/encerrar`),
};

// ---------------------------------------------------------------------------
// Compromissos diários
// ---------------------------------------------------------------------------
export const apiCompromissos = {
  listar: (data: string) => get<Compromisso[]>(`/compromissos?data=${data}`),
  datas: () => get<string[]>('/compromissos/datas'),
  criar: (data: string, descricao: string) => post<Compromisso>('/compromissos', { data, descricao }),
  atualizar: (id: string, dados: { descricao?: string; concluido?: boolean }) =>
    patch<Compromisso>(`/compromissos/${id}`, dados),
  excluir: (id: string) => remover(`/compromissos/${id}`),
};

// ---------------------------------------------------------------------------
// Cronograma dinâmico
// O servidor devolve os dados crus; a prioridade é calculada em lib/cronograma.
// ---------------------------------------------------------------------------
import type { DadosCronograma } from './lib/cronograma';
import type { ItemExtraido } from './lib/importacao';

/** Proposta de entregável vinda do roteiro, antes da revisão. */
export interface EntregavelProposto {
  nome: string;
  descricao: string;
  tipo_tarefa: string | null;
  tempo_estimado_min: number | null;
  topicos_ids: string[];
  data_fixa: string | null;
  trecho_origem: string;
}

export const apiCronograma = {
  dados: () => get<DadosCronograma>('/cronograma'),
  config: () => get<Record<string, string>>('/config'),
  salvarConfig: (valores: Record<string, string | number>) =>
    patch<Record<string, string>>('/config', valores),
  /** Guarda a intenção do usuário; a fila é remontada com ela aplicada. */
  ajustar: (itemTipo: string, itemId: string, direcao: 'promover' | 'rebaixar', magnitude: number) =>
    put<{ id: string }>('/ajustes-prioridade', {
      item_tipo: itemTipo,
      item_id: itemId,
      direcao,
      magnitude,
    }),
  /** "Restaurar posição calculada". */
  removerAjuste: (itemTipo: string, itemId: string) =>
    remover(`/ajustes-prioridade/${itemTipo}/${itemId}`),
};

// ---------------------------------------------------------------------------
// Calendário: as cinco origens de item, mais os eventos criados à mão
// ---------------------------------------------------------------------------
import type { ItemCalendario } from './lib/calendario';

export const apiCalendario = {
  itens: () => get<{ hoje: string; itens: ItemCalendario[] }>('/calendario'),
  /**
   * Prova num bloco com wrapper acadêmico nasce como avaliação, e a resposta
   * diz qual dos dois foi criado — é o que impede a prova de existir duas vezes.
   */
  criar: (dados: Record<string, unknown>) =>
    post<{ criado: 'evento' | 'avaliacao'; evento?: Evento; avaliacao?: Avaliacao }>('/eventos', dados),
  atualizar: (id: string, dados: Record<string, unknown>) => patch<Evento>(`/eventos/${id}`, dados),
  /** Só eventos: itens derivados são excluídos na origem. */
  excluir: (id: string) => remover(`/eventos/${id}`),
};

// ---------------------------------------------------------------------------
// Desempenho
// Dados crus; a agregação mora em lib/desempenho.ts, para poder ser testada.
// ---------------------------------------------------------------------------
import type { DadosDesempenho } from './lib/desempenho';

export const apiDesempenho = {
  dados: () => get<DadosDesempenho>('/desempenho'),
};

// ---------------------------------------------------------------------------
// Visão de grafo
// ---------------------------------------------------------------------------
import type { ArestaDoGrafo, BlocoDoGrafo, Posicao } from './lib/layoutGrafo';

export const apiGrafo = {
  dados: () =>
    get<{ blocos: BlocoDoGrafo[]; relacoes: ArestaDoGrafo[]; config: Record<string, string> }>(
      '/grafo'
    ),
  /** Arrastar um nó só move o bloco. Nunca cria nem altera relação. */
  mover: (id: string, pos_x: number, pos_y: number) =>
    patch<{ ok: true }>(`/blocos/${id}/posicao`, { pos_x, pos_y }),
  /** Primeiro layout e "Reorganizar mapa". */
  salvarPosicoes: (posicoes: Posicao[]) =>
    put<{ ok: true }>('/grafo/posicoes', { posicoes }),
};

// ---------------------------------------------------------------------------
// Repositório de documentos
// Um documento existe uma única vez por bloco: o servidor decide pelo hash.
// ---------------------------------------------------------------------------
import type { CategoriaDocumento, Documento, TipoUso } from './lib/documentos';

/** Texto colado. Arquivos vão por multipart, em enviarArquivo. */
export interface EnvioDocumento {
  nome_arquivo: string;
  conteudo_texto: string;
  categoria?: CategoriaDocumento;
  /** Resposta ao conflito de nome, quando o servidor perguntou. */
  resolucao?: 'substituir' | 'manter';
}

/** Resumo do que um fluxo mandaria ao modelo. */
export interface MaterialDoFluxo {
  caracteres: number | null;
  teto: number | null;
  /** O fluxo precisou reduzir o conteúdo para caber no teto. */
  reduzido: boolean;
  /** A linha que explica a redução, quando houve. */
  aviso: string | null;
  /** Lista de questões: só os trechos do tópico, escolhidos na geração. */
  porTrechos: boolean;
  maxTrechos?: number;
}

/** O servidor devolve o documento, ou um pedido de decisão sobre o nome. */
export type ResultadoEnvio =
  | (Documento & { reaproveitado: boolean; conflito?: undefined })
  | {
      conflito: 'nome';
      nome_arquivo: string;
      existente: { id: string; nome_arquivo: string; criado_em: string };
    };

export const apiDocumentos = {
  listar: (blocoId: string) => get<Documento[]>(`/blocos/${blocoId}/documentos`),
  obter: (id: string) => get<Documento>(`/documentos/${id}`),
  /** Texto colado. */
  enviar: (blocoId: string, documentos: EnvioDocumento[]) =>
    post<{ documentos: ResultadoEnvio[] }>(`/blocos/${blocoId}/documentos`, { documentos }),
  /**
   * Arquivo, como multipart/form-data — nunca base64 em JSON. O servidor
   * responde assim que recebe; o texto é extraído depois, com status próprio.
   */
  enviarArquivo: async (
    blocoId: string,
    arquivo: File,
    categoria: CategoriaDocumento,
    resolucao?: 'substituir' | 'manter'
  ) => {
    const corpo = new FormData();
    // O nome vai também num campo à parte: no multipart ele chega mal codificado.
    corpo.append('nome_arquivo', arquivo.name);
    corpo.append('categoria', categoria);
    if (resolucao) corpo.append('resolucao', resolucao);
    corpo.append('arquivo', arquivo);
    const r = await chamarApi(`/blocos/${blocoId}/documentos`, { method: 'POST', body: corpo });
    return lerResposta<{ documentos: ResultadoEnvio[] }>(r);
  },
  /**
   * O que o fluxo enviaria ao modelo com esta seleção — o tamanho do conteúdo
   * enviado, nunca o do documento bruto. Só informa: nunca bloqueia.
   */
  material: (blocoId: string, fluxo: TipoUso, documentosIds: string[]) =>
    post<MaterialDoFluxo>('/documentos/material', { bloco_id: blocoId, fluxo, documentos_ids: documentosIds }),
  /** Processa o que ainda não tem trechos, o que falhou e o que ficou incompleto. */
  indexar: (blocoId: string) => post<{ ok: true; na_fila: number }>(`/blocos/${blocoId}/documentos/indexar`),
  atualizar: (id: string, dados: { nome_arquivo?: string; categoria?: CategoriaDocumento }) =>
    patch<Documento>(`/documentos/${id}`, dados),
  /** O que foi gerado a partir dele não é afetado. */
  excluir: (id: string) => remover(`/documentos/${id}`),
  urlDoArquivo: (id: string) => `/api/documentos/${id}/arquivo`,

  /** De quais documentos um item foi gerado. */
  registrarUso: (documentos_ids: string[], item_tipo: TipoUso, item_id: string) =>
    post<{ ok: true }>('/documento-usos', { documentos_ids, item_tipo, item_id }),
  usosDoItem: (item_tipo: TipoUso, item_id: string) =>
    get<{ documento_id: string; nome_arquivo: string | null; removido: boolean }[]>(
      `/documento-usos/${item_tipo}/${item_id}`
    ),
};

// ---------------------------------------------------------------------------
// Vínculos entre avaliação e atividades
// Uma avaliação vinculada é realizada PELAS atividades: o trabalho é
// representado por elas, e a avaliação sai da fila como item próprio.
// ---------------------------------------------------------------------------
export interface ItemVinculado {
  item_tipo: 'entregavel' | 'lista_questoes';
  item_id: string;
  titulo: string;
  data: string | null;
  concluido: number;
}

export const apiVinculos = {
  doBloco: (blocoId: string) =>
    get<{
      vinculos: { avaliacao_id: string; item_tipo: string; item_id: string }[];
      avaliacoes: { id: string; titulo: string }[];
      porAvaliacao: Record<string, ItemVinculado[]>;
    }>(`/blocos/${blocoId}/vinculos`),

  /** Define o conjunto inteiro de itens de uma avaliação. */
  definirItens: (avaliacaoId: string, itens: { item_tipo: string; item_id: string }[]) =>
    put<{ ok: true; itens: ItemVinculado[] }>(`/avaliacoes/${avaliacaoId}/itens`, { itens }),

  /** Define (ou tira) a avaliação de um item, pelo formulário do próprio item. */
  definirAvaliacao: (tipo: 'entregavel' | 'lista_questoes', id: string, avaliacaoId: string | null) =>
    put<{ ok: true; avaliacao_id: string | null }>(`/vinculos/${tipo}/${id}`, {
      avaliacao_id: avaliacaoId,
    }),
};

// ---------------------------------------------------------------------------
// Exclusão pelo calendário: é a mesma ação de excluir pela tela de origem.
// ---------------------------------------------------------------------------
export const apiExclusao = {
  consequencias: (tipo: string, id: string) =>
    get<{ linhas: string[]; vinculo: string | null }>(`/calendario/${tipo}/${id}/consequencias`),
  excluir: (tipo: string, id: string) => remover(`/calendario/${tipo}/${id}`),
};
