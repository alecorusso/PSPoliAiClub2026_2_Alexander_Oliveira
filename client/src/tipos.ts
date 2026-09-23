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
  /** Fórmula da média escrita pelo usuário; null usa só a média ponderada. */
  formula_media: string | null;
  /** 1 = a média vem da fórmula; 0 = vem da ponderação por peso. */
  usar_formula: number;
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

/** Uma fusão vista de um lado ou do outro. */
export interface BlocoResumido {
  id: string;
  nome: string;
}

export interface Fusao {
  /** Este bloco É fusão destas origens, quando é resultado de uma. */
  resultado: { origens: BlocoResumido[] } | null;
  /** Fusões das quais este bloco é uma das origens. */
  comoOrigem: { resultado: BlocoResumido; outras: BlocoResumido[] }[];
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
/** 'gerada_geral': conhecimento geral, só com confirmação quando os documentos não tratam do tópico. */
export type OrigemLista = 'enviada' | 'gerada_fontes' | 'gerada_internet' | 'gerada_geral';

/** De qual trecho de documento uma questão gerada saiu. */
export interface ApoioQuestao {
  documento_id: string;
  nome: string | null;
  pagina_inicio: number | null;
  pagina_fim: number | null;
  titulo_secao: string | null;
}

/** Páginas de origem de uma lista, por documento. */
export interface OrigemPaginas {
  documento_id: string;
  nome: string | null;
  faixas: { de: number; ate: number }[];
}
export type StatusLista = 'nao_feita' | 'incompleta' | 'completa';
/** 'prova' = listas do Modo Prova; 'projeto' = testes teóricos do Modo Projeto. */
export type ContextoLista = 'prova' | 'projeto';

export interface Questao {
  numero: number;
  enunciado: string;
  /** Trecho em que a questão se apoia, quando veio de documentos. */
  apoio?: ApoioQuestao;
}

export interface RespostaGabarito {
  numero: number;
  resposta: string;
}

/**
 * De onde veio a estimativa de tempo. Só 'faixa' e 'exata' alimentam a
 * calibração: a estimativa da IA mediria o erro do modelo, não o do usuário.
 */
export type OrigemEstimativa = 'llm' | 'faixa' | 'exata';

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
  data_prevista: string | null;
  tempo_estimado_min: number | null;
  origem_estimativa: OrigemEstimativa | null;
  tipo_tarefa: string | null;
  concluido_em: string | null;
  criado_em: string;
  /** JSON de OrigemPaginas[]: de que páginas a lista gerada saiu. */
  origem_paginas: string | null;
  topico_titulo: string | null;
  topico_peso: Peso | null;
}

export interface RespostaLista {
  questoes: Questao[];
  gabarito: RespostaGabarito[];
  erro: string | null;
  /** Nenhum trecho dos documentos trata do tópico: nada foi gerado. */
  sem_relevancia?: boolean;
  aviso?: string;
  origem_paginas?: OrigemPaginas[] | null;
  recuperacao?: { metodo: 'embeddings' | 'palavras'; trechos: ApoioQuestao[] };
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
  origem_estimativa: OrigemEstimativa | null;
  tipo_tarefa: string | null;
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
// Painel Acadêmico
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
  data_prevista: string | null;
  tempo_estimado_min: number | null;
  origem_estimativa: OrigemEstimativa | null;
  tipo_tarefa: string | null;
  /** Marcada como feita pelo usuário. Independe de ter nota. */
  feita: number;
  /** A prova aconteceu; a nota pode não ter saído. A nota liga isto sozinha. */
  realizada: number;
  concluido_em: string | null;
  criado_em: string;
}

/** Linha da grade editável de avaliações (peso e nota podem ficar vazios). */
export interface LinhaAvaliacao {
  id: string;
  titulo: string;
  peso: string;
  nota: string;
  feita: boolean;
  /** A prova foi feita e a nota ainda não saiu. */
  realizada: boolean;
  /** Opcionais: uma avaliação registrada só para a média funciona sem eles. */
  data_prevista: string;
  tempo_estimado_min: string;
  origem_estimativa: OrigemEstimativa | null;
  tipo_tarefa: string;
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

// ---------------------------------------------------------------------------
// Calendário
// Uma prova de disciplina é a avaliação do bloco, nunca um evento à parte:
// o mesmo objetivo de estudo jamais aparece duplicado.
// ---------------------------------------------------------------------------
export type TipoEvento = 'prova' | 'aula' | 'entrega' | 'outro';

export interface Evento {
  id: string;
  bloco_id: string | null;
  titulo: string;
  tipo: TipoEvento | null;
  data_inicio: string | null;
  data_fim: string | null;
  observacao: string | null;
  criado_em: string;
}
