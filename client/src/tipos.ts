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
