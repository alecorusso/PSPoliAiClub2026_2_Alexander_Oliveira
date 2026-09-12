import type {
  Avaliacao,
  Bloco,
  Compromisso,
  ContextoLista,
  DocumentoFonte,
  Entregavel,
  Evidencia,
  ListaQuestoes,
  Mensagem,
  Modo,
  OrigemLista,
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

async function pedir<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const r = await fetch('/api' + caminho, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
  });
  const texto = await r.text();
  const dados = texto ? JSON.parse(texto) : null;
  if (!r.ok) throw new Error(dados?.erro || `Falha na requisição (${r.status}).`);
  return dados as T;
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
  listarDocumentos: (blocoId: string) => get<DocumentoFonte[]>(`/blocos/${blocoId}/documentos`),
  enviarDocumentos: (blocoId: string, documentos: { nome_arquivo: string; conteudo_texto: string }[]) =>
    post<{ ok: true }>(`/blocos/${blocoId}/documentos`, { documentos }),

  // IA (sempre via servidor — a chave nunca chega ao cliente)
  extrairTabela: (blocoId: string) => post<RespostaArvore>('/ia/extrair-tabela', { bloco_id: blocoId }),
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
    }
  ) => post<ListaQuestoes>(`/blocos/${blocoId}/listas`, dados),
  atualizar: (id: string, dados: { status?: StatusLista; titulo?: string; gabarito?: RespostaGabarito[] | string | null }) =>
    patch<ListaQuestoes>(`/listas/${id}`, dados),
  excluir: (id: string) => remover(`/listas/${id}`),
  /** Injeta o contexto da lista no chat do bloco. Nunca altera o status. */
  corrigir: (id: string) => post<{ mensagens: Mensagem[]; erro: string | null }>(`/listas/${id}/corrigir`),

  gerar: (dados: {
    bloco_id: string;
    topico_id: string;
    quantidade: number;
    fonte: { tipo: 'documentos' | 'internet'; documentos_ids?: string[] };
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
// Avaliações (wrapper acadêmico)
// ---------------------------------------------------------------------------
export const apiAvaliacoes = {
  listar: (blocoId: string) => get<Avaliacao[]>(`/blocos/${blocoId}/avaliacoes`),
  salvar: (blocoId: string, avaliacoes: { id: string; titulo: string; peso: string; nota: string }[]) =>
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
