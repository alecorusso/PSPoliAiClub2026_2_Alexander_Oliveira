import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const caminhoBanco = path.join(__dirname, 'dados.db');

export const db = new Database(caminhoBanco);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migration unica executada na inicializacao. Tudo com CREATE TABLE IF NOT EXISTS,
// portanto e seguro rodar a cada boot do servidor.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS pastas (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  pasta_pai_id TEXT NULL REFERENCES pastas(id) ON DELETE CASCADE,
  favorito INTEGER DEFAULT 0,
  oculto INTEGER DEFAULT 0,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS blocos (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NULL,
  pasta_id TEXT NULL REFERENCES pastas(id) ON DELETE SET NULL,
  favorito INTEGER DEFAULT 0,
  oculto INTEGER DEFAULT 0,
  wrapper_academico INTEGER DEFAULT 0,
  limite_faltas INTEGER NULL,
  faltas_registradas INTEGER DEFAULT 0,
  media_aprovacao REAL NULL,
  tabela_conteudos_construida INTEGER DEFAULT 0,
  ultimo_acesso TEXT,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS bloco_relacoes (
  id TEXT PRIMARY KEY,
  bloco_origem_id TEXT NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  bloco_destino_id TEXT NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('pre_requisito','deriva_de','fusao_com'))
);

CREATE TABLE IF NOT EXISTS topicos (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  topico_pai_id TEXT NULL,
  titulo TEXT NOT NULL,
  ordem INTEGER DEFAULT 0,
  natureza TEXT CHECK(natureza IN ('declarativo','procedimental','relacional')),
  peso TEXT CHECK(peso IN ('baixo','medio','alto')) DEFAULT 'medio',
  check_aprendizagem INTEGER DEFAULT 0,
  data_check TEXT NULL
);

CREATE TABLE IF NOT EXISTS revisoes (
  id TEXT PRIMARY KEY,
  topico_id TEXT NOT NULL REFERENCES topicos(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  data_prevista TEXT NOT NULL,
  status TEXT CHECK(status IN ('pendente','concluida','reagendada')) DEFAULT 'pendente',
  data_conclusao TEXT NULL
);

CREATE TABLE IF NOT EXISTS evidencias (
  id TEXT PRIMARY KEY,
  topico_id TEXT NOT NULL REFERENCES topicos(id) ON DELETE CASCADE,
  modo TEXT,
  descricao TEXT,
  data TEXT
);

CREATE TABLE IF NOT EXISTS mensagens_chat (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  topico_id TEXT NULL,
  papel TEXT,
  conteudo TEXT,
  modo_ativo TEXT,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS documentos_fonte (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  nome_arquivo TEXT,
  conteudo_texto TEXT,
  criado_em TEXT
);

-- Tabelas criadas antecipadamente (sem telas nesta etapa) para evitar migration futura.
CREATE TABLE IF NOT EXISTS listas_questoes (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  topico_id TEXT NULL,
  titulo TEXT,
  enunciado TEXT NULL,
  origem TEXT NULL,
  status TEXT NULL,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS entregaveis (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  titulo TEXT,
  descricao TEXT NULL,
  data_entrega TEXT NULL,
  status TEXT NULL,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS entregavel_topicos (
  id TEXT PRIMARY KEY,
  entregavel_id TEXT NOT NULL REFERENCES entregaveis(id) ON DELETE CASCADE,
  topico_id TEXT NOT NULL REFERENCES topicos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS eventos (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  titulo TEXT,
  tipo TEXT NULL,
  data_inicio TEXT NULL,
  data_fim TEXT NULL,
  observacao TEXT NULL,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  titulo TEXT,
  data TEXT NULL,
  peso REAL NULL,
  observacao TEXT NULL,
  criado_em TEXT
);

CREATE INDEX IF NOT EXISTS idx_blocos_pasta ON blocos(pasta_id);
CREATE INDEX IF NOT EXISTS idx_pastas_pai ON pastas(pasta_pai_id);
CREATE INDEX IF NOT EXISTS idx_topicos_bloco ON topicos(bloco_id);
CREATE INDEX IF NOT EXISTS idx_revisoes_topico ON revisoes(topico_id);
CREATE INDEX IF NOT EXISTS idx_evidencias_topico ON evidencias(topico_id);
CREATE INDEX IF NOT EXISTS idx_mensagens_bloco ON mensagens_chat(bloco_id, topico_id);
`;

export function migrar() {
  db.exec(SCHEMA);
}

export const agora = () => new Date().toISOString();
export const hojeISO = () => new Date().toISOString().slice(0, 10);

export function somarDias(dataISO, dias) {
  const d = new Date(dataISO + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const novoId = () => crypto.randomUUID();
