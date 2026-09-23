import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PLATAFORMA_BANCO permite subir uma instancia com outro banco (testes).
const caminhoBanco = process.env.PLATAFORMA_BANCO?.trim() || path.join(__dirname, 'dados.db');

export const db = new Database(caminhoBanco);

// Arquivos originais dos documentos, fora do banco: SQLite guarda o texto
// extraido, e o arquivo continua disponivel para baixar.
export const PASTA_ARQUIVOS = path.join(path.dirname(caminhoBanco), 'arquivos');
fs.mkdirSync(PASTA_ARQUIVOS, { recursive: true });
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

-- Quais atividades REALIZAM uma avaliacao. O trabalho passa a ser representado
-- por elas, e a avaliacao sai da fila do cronograma como item proprio — o mesmo
-- trabalho nunca e contado duas vezes.
CREATE TABLE IF NOT EXISTS avaliacao_itens (
  id TEXT PRIMARY KEY,
  avaliacao_id TEXT NOT NULL,
  item_tipo TEXT NOT NULL CHECK(item_tipo IN ('entregavel','lista_questoes')),
  item_id TEXT NOT NULL,
  criado_em TEXT,
  UNIQUE(avaliacao_id, item_tipo, item_id)
);

-- Trechos de cada documento: a unidade de busca. Divididos UMA vez, quando o
-- documento entra no repositorio; o embedding (JSON do vetor) tambem e gerado
-- uma vez so, nunca a cada lista.
CREATE TABLE IF NOT EXISTS documento_trechos (
  id TEXT PRIMARY KEY,
  documento_id TEXT NOT NULL REFERENCES documentos_fonte(id) ON DELETE CASCADE,
  ordem INTEGER,
  texto TEXT,
  pagina_inicio INTEGER NULL,
  pagina_fim INTEGER NULL,
  titulo_secao TEXT NULL,
  embedding TEXT NULL
);

-- Quais documentos originaram cada item gerado. Excluir o documento NAO apaga
-- o item: o conteudo gerado ja esta salvo nele, e so a referencia fica orfa.
CREATE TABLE IF NOT EXISTS documento_usos (
  id TEXT PRIMARY KEY,
  documento_id TEXT NOT NULL,
  item_tipo TEXT NOT NULL CHECK(item_tipo IN
    ('tabela_conteudos','lista_questoes','roteiro_projeto','importacao_calendario')),
  item_id TEXT NULL,
  criado_em TEXT
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

-- Ajuste manual de prioridade: o usuario arrasta o item, e a fila e remontada
-- com o ajuste aplicado (a ordem nunca e forcada visualmente).
CREATE TABLE IF NOT EXISTS ajustes_prioridade (
  id TEXT PRIMARY KEY,
  item_tipo TEXT,
  item_id TEXT,
  direcao TEXT CHECK(direcao IN ('promover','rebaixar')),
  magnitude REAL,
  criado_em TEXT
);

-- Preferencias simples da plataforma (ex.: orcamento diario de estudo).
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS sessoes_foco (
  id TEXT PRIMARY KEY,
  bloco_id TEXT NULL REFERENCES blocos(id) ON DELETE SET NULL,
  inicio TEXT,
  fim TEXT NULL
);

CREATE TABLE IF NOT EXISTS compromissos_diarios (
  id TEXT PRIMARY KEY,
  data TEXT,
  descricao TEXT,
  concluido INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_blocos_pasta ON blocos(pasta_id);
CREATE INDEX IF NOT EXISTS idx_pastas_pai ON pastas(pasta_pai_id);
CREATE INDEX IF NOT EXISTS idx_topicos_bloco ON topicos(bloco_id);
CREATE INDEX IF NOT EXISTS idx_revisoes_topico ON revisoes(topico_id);
CREATE INDEX IF NOT EXISTS idx_evidencias_topico ON evidencias(topico_id);
CREATE INDEX IF NOT EXISTS idx_mensagens_bloco ON mensagens_chat(bloco_id, topico_id);
`;

// Colunas acrescentadas depois da primeira versao do schema. Como
// CREATE TABLE IF NOT EXISTS nao altera tabelas ja existentes, cada coluna e
// adicionada aqui de forma idempotente.
const COLUNAS_NOVAS = [
  // Modo Prova
  ['listas_questoes', 'gabarito', 'TEXT NULL'],
  ['listas_questoes', 'quantidade', 'INTEGER NULL'],
  // 'prova' para listas do Modo Prova, 'projeto' para os testes teoricos
  ['listas_questoes', 'contexto', "TEXT DEFAULT 'prova'"],
  // Modo Projeto
  ['entregaveis', 'ferramentas', 'TEXT NULL'],
  ['entregaveis', 'tempo_estimado_horas', 'REAL NULL'],
  ['entregaveis', 'concluido', 'INTEGER DEFAULT 0'],
  ['entregaveis', 'concluido_em', 'TEXT NULL'],
  // Preferencia por bloco: gerar testes teoricos ao concluir um entregavel
  ['blocos', 'sugerir_testes_auto', 'INTEGER DEFAULT 0'],
  // Wrapper academico: a nota e um dado informado pelo usuario, nunca calculado
  // ou atribuido pela plataforma.
  ['avaliacoes', 'nota', 'REAL NULL'],
  ['avaliacoes', 'ordem', 'INTEGER DEFAULT 0'],
  // Formula da media escrita pelo usuario, com as avaliacoes como variaveis.
  ['blocos', 'formula_media', 'TEXT NULL'],
  // Quando 1, a media vem da formula; quando 0, da ponderacao por peso.
  ['blocos', 'usar_formula', 'INTEGER DEFAULT 0'],

  // --- Cronograma dinamico --------------------------------------------------
  // Todo item agendavel guarda prazo, tempo estimado, de onde veio a estimativa
  // e o tipo de tarefa (usado para calibrar pelo historico).
  ['avaliacoes', 'data_prevista', 'TEXT NULL'],
  ['avaliacoes', 'tempo_estimado_min', 'INTEGER NULL'],
  ['avaliacoes', 'origem_estimativa', 'TEXT NULL'],
  ['avaliacoes', 'tipo_tarefa', 'TEXT NULL'],
  // Quando a nota foi preenchida: e o que permite medir o tempo real gasto.
  ['avaliacoes', 'concluido_em', 'TEXT NULL'],
  // Marcar a avaliacao como feita nao exige nota: quem prestou a prova ja a
  // tirou do cronograma, mesmo que o resultado ainda nao tenha saido.
  ['avaliacoes', 'feita', 'INTEGER NOT NULL DEFAULT 0'],
  // A prova foi feita e a nota ainda nao saiu. Preencher a nota liga isto
  // sozinho: a nota ja e a confirmacao de que a avaliacao aconteceu.
  ['avaliacoes', 'realizada', 'INTEGER DEFAULT 0'],

  // --- Repositorio de documentos --------------------------------------------
  // hash identifica o documento dentro do bloco: e o que permite nunca guardar
  // o mesmo material duas vezes.
  ['documentos_fonte', 'hash', 'TEXT NULL'],
  ['documentos_fonte', 'categoria', 'TEXT NULL'],
  ['documentos_fonte', 'caminho_arquivo', 'TEXT NULL'],
  ['documentos_fonte', 'tamanho_bytes', 'INTEGER NULL'],
  ['documentos_fonte', 'tipo_mime', 'TEXT NULL'],
  // Processamento no servidor: 'processando' -> 'pronto' (ou 'falhou', com o
  // motivo). So documentos 'pronto' podem ser escolhidos nos fluxos.
  ['documentos_fonte', 'status', "TEXT DEFAULT 'pronto'"],
  // Onde o processamento esta: 'extraindo', 'dividindo' ou 'indexando'.
  ['documentos_fonte', 'etapa', 'TEXT NULL'],
  ['documentos_fonte', 'progresso_feito', 'INTEGER NULL'],
  ['documentos_fonte', 'progresso_total', 'INTEGER NULL'],
  // Motivo da falha, ou observacao sobre uma indexacao incompleta.
  ['documentos_fonte', 'motivo', 'TEXT NULL'],
  // 'semantico' (todos os trechos com embedding) ou 'palavras' (busca BM25).
  // NULL = ainda nao foi indexado: e o que faz os documentos antigos serem
  // processados na subida do servidor.
  ['documentos_fonte', 'indice', 'TEXT NULL'],
  // 1 quando o texto foi extraido no servidor, com paginas e sumario.
  ['documentos_fonte', 'extraido', 'INTEGER DEFAULT 0'],
  ['documentos_fonte', 'paginas', 'INTEGER NULL'],
  // Sumario do PDF (marcadores), JSON [{ titulo, pagina, nivel }]. Sem IA.
  ['documentos_fonte', 'sumario', 'TEXT NULL'],
  // Paginas de onde a lista gerada saiu, JSON [{ documento_id, nome, faixas }].
  ['listas_questoes', 'origem_paginas', 'TEXT NULL'],

  // --- Visao de grafo -------------------------------------------------------
  // Posicao no mapa. Null = ainda sem lugar; o cliente calcula e grava.
  ['blocos', 'pos_x', 'REAL NULL'],
  ['blocos', 'pos_y', 'REAL NULL'],
  // 1 nas arestas de fusao criadas pelo modelo direcional; as antigas ficam
  // NULL e sao removidas pela migracao.
  ['bloco_relacoes', 'migrada', 'INTEGER NULL'],

  ['listas_questoes', 'data_prevista', 'TEXT NULL'],
  ['listas_questoes', 'tempo_estimado_min', 'INTEGER NULL'],
  ['listas_questoes', 'origem_estimativa', 'TEXT NULL'],
  ['listas_questoes', 'tipo_tarefa', 'TEXT NULL'],
  ['listas_questoes', 'concluido_em', 'TEXT NULL'],

  // entregaveis ja tem tempo_estimado_horas, data_entrega, concluido_em e criado_em.
  ['entregaveis', 'origem_estimativa', 'TEXT NULL'],
  ['entregaveis', 'tipo_tarefa', 'TEXT NULL'],
];

function garantirColuna(tabela, coluna, definicao) {
  const existentes = db.prepare(`PRAGMA table_info(${tabela})`).all();
  if (existentes.some((c) => c.name === coluna)) return;
  db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

export function migrar() {
  db.exec(SCHEMA);
  for (const [tabela, coluna, definicao] of COLUNAS_NOVAS) {
    garantirColuna(tabela, coluna, definicao);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_listas_bloco ON listas_questoes(bloco_id, contexto);
    CREATE INDEX IF NOT EXISTS idx_entregaveis_bloco ON entregaveis(bloco_id);
    CREATE INDEX IF NOT EXISTS idx_entregavel_topicos ON entregavel_topicos(entregavel_id);
    CREATE INDEX IF NOT EXISTS idx_avaliacoes_bloco ON avaliacoes(bloco_id);
    CREATE INDEX IF NOT EXISTS idx_compromissos_data ON compromissos_diarios(data);
    CREATE INDEX IF NOT EXISTS idx_sessoes_foco_inicio ON sessoes_foco(inicio);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ajuste_item ON ajustes_prioridade(item_tipo, item_id);
    CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos(data_inicio);
    CREATE INDEX IF NOT EXISTS idx_documentos_bloco ON documentos_fonte(bloco_id);
    CREATE INDEX IF NOT EXISTS idx_usos_documento ON documento_usos(documento_id);
    CREATE INDEX IF NOT EXISTS idx_trechos_documento ON documento_trechos(documento_id, ordem);
    CREATE INDEX IF NOT EXISTS idx_avaliacao_itens ON avaliacao_itens(avaliacao_id);
    -- Um item pertence a no maximo UMA avaliacao.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_item_avaliacao ON avaliacao_itens(item_tipo, item_id);
  `);
  // O indice cai antes da limpeza e volta depois: preencher o hash de um
  // duplicado legado violaria a restricao no meio do caminho, e a migracao
  // precisa poder rodar com o indice ja existindo.
  db.exec('DROP INDEX IF EXISTS idx_documento_hash');
  deduplicarDocumentos();
  db.exec('CREATE UNIQUE INDEX idx_documento_hash ON documentos_fonte(bloco_id, hash)');
  unificarProvasDuplicadas();
  limparFusoesSemDirecao();
}

/** SHA-256 de um texto ou de um buffer. */
export function calcularHash(conteudo) {
  return crypto.createHash('sha256').update(conteudo).digest('hex');
}

/**
 * Um documento existe uma unica vez por bloco.
 *
 * Preenche o hash do que ja estava gravado (a partir do arquivo original, se
 * houver; senao do texto extraido), agrupa por (bloco_id, hash), mantem o
 * registro mais antigo de cada grupo, aponta para ele as referencias dos demais
 * e remove os duplicados. Idempotente: na segunda vez nao ha o que agrupar.
 */
function deduplicarDocumentos() {
  const semHash = db
    .prepare('SELECT id, conteudo_texto, caminho_arquivo FROM documentos_fonte WHERE hash IS NULL')
    .all();
  if (semHash.length > 0) {
    const gravar = db.prepare('UPDATE documentos_fonte SET hash = ? WHERE id = ?');
    db.transaction(() => {
      for (const d of semHash) {
        let base = d.conteudo_texto ?? '';
        if (d.caminho_arquivo) {
          try {
            base = fs.readFileSync(path.join(PASTA_ARQUIVOS, d.caminho_arquivo));
          } catch {
            /* arquivo sumiu: o texto extraido ainda identifica o documento */
          }
        }
        gravar.run(calcularHash(base), d.id);
      }
    })();
  }

  const grupos = db
    .prepare(
      `SELECT bloco_id, hash, COUNT(*) AS quantos
         FROM documentos_fonte
        WHERE hash IS NOT NULL
        GROUP BY bloco_id, hash
       HAVING quantos > 1`
    )
    .all();
  if (grupos.length === 0) return;

  const doGrupo = db.prepare(
    'SELECT id FROM documentos_fonte WHERE bloco_id = ? AND hash = ? ORDER BY criado_em, rowid'
  );
  const reapontar = db.prepare('UPDATE documento_usos SET documento_id = ? WHERE documento_id = ?');
  const apagar = db.prepare('DELETE FROM documentos_fonte WHERE id = ?');
  const nomeDoBloco = db.prepare('SELECT nome FROM blocos WHERE id = ?');

  const porBloco = new Map();
  db.transaction(() => {
    for (const g of grupos) {
      const [manter, ...duplicados] = doGrupo.all(g.bloco_id, g.hash);
      for (const d of duplicados) {
        reapontar.run(manter.id, d.id);
        apagar.run(d.id);
      }
      porBloco.set(g.bloco_id, (porBloco.get(g.bloco_id) ?? 0) + duplicados.length);
    }
  })();

  for (const [blocoId, quantos] of porBloco) {
    const nome = nomeDoBloco.get(blocoId)?.nome ?? blocoId;
    console.log(`[db] ${quantos} documento(s) duplicado(s) removido(s) do bloco "${nome}".`);
  }
}

/**
 * A fusao era uma relacao simetrica entre dois blocos, gravada sem direcao
 * confiavel. Agora ela e direcional e de duas ou mais origens: as arestas
 * 'fusao_com' apontam das origens para o bloco resultado.
 *
 * As arestas antigas nao tem como ser interpretadas — nao da para saber qual
 * lado era o resultado —, entao sao listadas e removidas, para serem recriadas
 * pela nova interface. Idempotente: roda uma vez e nao acha mais nada.
 */
function limparFusoesSemDirecao() {
  const antigas = db
    .prepare(
      `SELECT r.id, bo.nome AS origem, bd.nome AS destino
         FROM bloco_relacoes r
         JOIN blocos bo ON bo.id = r.bloco_origem_id
         JOIN blocos bd ON bd.id = r.bloco_destino_id
        WHERE r.tipo = 'fusao_com' AND r.migrada IS NULL`
    )
    .all();
  if (antigas.length === 0) return;

  console.log(`[db] ${antigas.length} relação(ões) de fusão sem direção confiável foram removidas.`);
  console.log('[db] Recrie-as pela opção "É fusão de..." no modal de relações do bloco resultado:');
  for (const a of antigas) console.log(`[db]   - ${a.origem} ↔ ${a.destino}`);

  const apagar = db.prepare('DELETE FROM bloco_relacoes WHERE id = ?');
  db.transaction(() => {
    for (const a of antigas) apagar.run(a.id);
  })();
}

/**
 * Uma prova de disciplina e UM registro so: a avaliacao do bloco.
 *
 * Eventos do tipo "prova" ligados a um bloco com wrapper academico viravam uma
 * segunda entrada para o mesmo objetivo de estudo — uma no calendario, outra no
 * cronograma. Aqui eles sao convertidos em avaliacao e o evento original some.
 * Idempotente: depois da conversao nao sobra nada para converter.
 */
function unificarProvasDuplicadas() {
  const duplicadas = db
    .prepare(
      `SELECT e.* FROM eventos e
         JOIN blocos b ON b.id = e.bloco_id
        WHERE e.tipo = 'prova' AND b.wrapper_academico = 1`
    )
    .all();
  if (duplicadas.length === 0) return;

  const inserir = db.prepare(
    `INSERT INTO avaliacoes
       (id, bloco_id, titulo, peso, nota, ordem, data, observacao, criado_em,
        data_prevista, tempo_estimado_min, origem_estimativa, tipo_tarefa, concluido_em, feita)
     VALUES (?,?,?,NULL,NULL,?,NULL,?,?,?,NULL,NULL,'prova',NULL,0)`
  );
  const proximaOrdem = db.prepare(
    'SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM avaliacoes WHERE bloco_id = ?'
  );
  const apagar = db.prepare('DELETE FROM eventos WHERE id = ?');

  const converter = db.transaction(() => {
    for (const e of duplicadas) {
      inserir.run(
        e.id, // o mesmo id: quem guardou a referencia continua encontrando
        e.bloco_id,
        String(e.titulo || 'Prova').trim(),
        proximaOrdem.get(e.bloco_id).proxima,
        e.observacao ?? null,
        e.criado_em ?? new Date().toISOString(),
        e.data_inicio ?? null
      );
      apagar.run(e.id);
    }
  });
  converter();
  console.log(`[db] ${duplicadas.length} prova(s) do calendário unificadas com o wrapper acadêmico.`);
}

export const agora = () => new Date().toISOString();
export const hojeISO = () => new Date().toISOString().slice(0, 10);

export function somarDias(dataISO, dias) {
  const d = new Date(dataISO + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const novoId = () => crypto.randomUUID();
