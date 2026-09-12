import type {
  Bloco,
  DocumentoFonte,
  Evidencia,
  Mensagem,
  Pasta,
  Relacao,
  RespostaArvore,
  Revisao,
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
