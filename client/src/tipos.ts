export type Natureza = 'declarativo' | 'procedimental' | 'relacional';
export type Peso = 'baixo' | 'medio' | 'alto';
export type TipoRelacao = 'pre_requisito' | 'deriva_de' | 'fusao_com';
export type StatusRevisao = 'pendente' | 'concluida' | 'reagendada';
export type Modo = 'prova' | 'projeto' | 'aprendizagem';

export interface Pasta {
  id: string;
  nome: string;
  pasta_pai_id: string | null;
  favorito: number;
  oculto: number;
  criado_em: string;
}

export interface Bloco {
  id: string;
  nome: string;
  descricao: string | null;
  pasta_id: string | null;
  favorito: number;
  oculto: number;
  wrapper_academico: number;
  limite_faltas: number | null;
  faltas_registradas: number;
  media_aprovacao: number | null;
  tabela_conteudos_construida: number;
  sugerir_testes_auto: number;
  ultimo_acesso: string | null;
  criado_em: string;
}

export interface Topico {
  id: string;
  bloco_id: string;
  topico_pai_id: string | null;
  titulo: string;
  ordem: number;
  natureza: Natureza;
  peso: Peso;
  check_aprendizagem: number;
  data_check: string | null;
}

export interface Revisao {
  id: string;
  topico_id: string;
  numero: number;
  data_prevista: string;
  status: StatusRevisao;
  data_conclusao: string | null;
  topico_titulo: string;
  natureza: Natureza;
  bloco_id: string;
  bloco_nome: string;
}

export interface Evidencia {
  id: string;
  topico_id: string;
  modo: string;
  descricao: string;
  data: string;
}

export interface Mensagem {
  id: string;
  bloco_id: string;
  topico_id: string | null;
  papel: 'usuario' | 'assistente';
  conteudo: string;
  modo_ativo: string;
  criado_em: string;
}

export interface Relacao {
  id: string;
  bloco_origem_id: string;
  bloco_destino_id: string;
  tipo: TipoRelacao;
  perspectiva: 'origem' | 'destino';
  outro_id: string;
  outro_nome: string;
}

export interface DocumentoFonte {
  id: string;
  bloco_id: string;
  nome_arquivo: string;
  criado_em: string;
}

/** Tópico proposto pela IA, antes de virar linha no banco. */
export interface TopicoSugerido {
  titulo: string;
  natureza: Natureza;
  peso: Peso;
  topico_pai: string | null;
}

export interface RespostaArvore {
  topicos: TopicoSugerido[];
  erro: string | null;
}

/** Linha do editor: a árvore é mantida em ordem de exibição, com nível explícito. */
export interface LinhaEditor {
  id: string;
  titulo: string;
  natureza: Natureza;
  peso: Peso;
  nivel: number;
}

// ---------------------------------------------------------------------------
// Modo Prova — listas de questões
// ---------------------------------------------------------------------------
export type OrigemLista = 'enviada' | 'gerada_fontes' | 'gerada_internet';
export type StatusLista = 'nao_feita' | 'incompleta' | 'completa';
/** 'prova' = listas do Modo Prova; 'projeto' = testes teóricos do Modo Projeto. */
export type ContextoLista = 'prova' | 'projeto';

export interface Questao {
  numero: number;
  enunciado: string;
}

export interface RespostaGabarito {
  numero: number;
  resposta: string;
}

export interface ListaQuestoes {
  id: string;
  bloco_id: string;
  topico_id: string | null;
  titulo: string;
  /** JSON de Questao[] quando gerada, ou texto puro quando enviada. */
  enunciado: string;
  gabarito: string | null;
  origem: OrigemLista;
  status: StatusLista;
  quantidade: number | null;
  contexto: ContextoLista;
  criado_em: string;
  topico_titulo: string | null;
  topico_peso: Peso | null;
}

export interface RespostaLista {
  questoes: Questao[];
  gabarito: RespostaGabarito[];
  erro: string | null;
}

// ---------------------------------------------------------------------------
// Modo Projeto — entregáveis
// ---------------------------------------------------------------------------
export interface TopicoDoEntregavel {
  id: string;
  titulo: string;
  peso: Peso;
  natureza: Natureza;
}

export interface Entregavel {
  id: string;
  bloco_id: string;
  titulo: string;
  descricao: string | null;
  data_entrega: string | null;
  ferramentas: string | null;
  tempo_estimado_horas: number | null;
  concluido: number;
  concluido_em: string | null;
  criado_em: string;
  topicos: TopicoDoEntregavel[];
}

/** Proposta da IA: ainda não existe no banco até o usuário clicar em "Adicionar". */
export interface SugestaoEntregavel {
  titulo: string;
  descricao: string;
  ferramentas: string;
  tempo_estimado_horas: number | null;
  topicos: string[];
  topico_ids: string[];
}

// ---------------------------------------------------------------------------
// Wrapper acadêmico
// A nota é um dado acadêmico informado pelo usuário — a plataforma nunca gera,
// infere ou atribui nota.
// ---------------------------------------------------------------------------
export interface Avaliacao {
  id: string;
  bloco_id: string;
  titulo: string;
  peso: number | null;
  nota: number | null;
  ordem: number;
  data: string | null;
  observacao: string | null;
  criado_em: string;
}

/** Linha da grade editável de avaliações (peso e nota podem ficar vazios). */
export interface LinhaAvaliacao {
  id: string;
  titulo: string;
  peso: string;
  nota: string;
}

// ---------------------------------------------------------------------------
// Sessão de foco — registro voluntário de tempo, sem bloqueio de nada
// ---------------------------------------------------------------------------
export interface SessaoFoco {
  id: string;
  bloco_id: string | null;
  inicio: string;
  fim: string | null;
  bloco_nome?: string | null;
}

// ---------------------------------------------------------------------------
// Compromissos diários
// ---------------------------------------------------------------------------
export interface Compromisso {
  id: string;
  data: string;
  descricao: string;
  concluido: number;
}
