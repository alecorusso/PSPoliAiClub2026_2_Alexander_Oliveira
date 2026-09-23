import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Aceita o .env na raiz do monorepo ou dentro de /server.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const { default: express } = await import('express');
const { default: cors } = await import('cors');
const { db, migrar, agora, hojeISO, somarDias, novoId, calcularHash, PASTA_ARQUIVOS } =
  await import('./db.js');
// Importado depois do dotenv: gemini.js le process.env no carregamento do modulo.
const {
  conversarSondagem,
  conversarBloco,
  extrairTabelaConteudos,
  buscarRoteiroEstudos,
  gerarListaQuestoes,
  gerarGabarito,
  sugerirEntregaveis,
  estimarTempoTarefa,
  extrairEventos,
  decomporRoteiro,
  iaDisponivel,
  modeloEmUso,
  PROTOCOLOS,
  embeddingDaConsulta,
} = await import('./gemini.js');
const { enfileirar, reindexarBloco, retomarPendentes, precisaIndexar } = await import('./indexacao.js');
const { selecionarTrechos, textoDaConsulta, paginasDeOrigem } = await import(
  './recuperacao.js'
);
const { materialDoFluxo, materialParaTabela } = await import('./material.js');
const { default: multer } = await import('multer');

migrar();

const app = express();
app.use(cors());
app.use(codigoNasRespostasDeErro);
// Arquivos chegam por multipart (multer), nunca em JSON: este limite so cobre
// texto colado e os corpos comuns da API.
app.use(express.json({ limit: '25mb' }));

// A travessia do grafo mora em client/src/lib/grafo.js e é importada daqui:
// servidor e cliente compartilham a mesma regra de ciclo e a mesma definição de
// fusão, em vez de manter duas implementações que podem divergir.
import {
  criariaCiclo,
  fusoesPorResultado,
  MIN_ORIGENS_FUSAO,
} from '../client/src/lib/grafo.js';

const PORTA = Number(process.env.PORT) || 3333;

// Envolve um handler assincrono: qualquer erro segue para o middleware de erro,
// que sempre responde JSON.
const rota = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res)).catch(next);
};

// ===========================================================================
// ERROS SEMPRE EM JSON
//
// Nenhuma rota /api pode responder a pagina HTML padrao do Express: a
// interface le JSON, e um HTML vira "Unexpected token '<'" na tela.
// ===========================================================================

/** Codigo padrao para respostas de erro que as rotas montam a mao. */
const CODIGO_POR_STATUS = {
  400: 'requisicao_invalida',
  404: 'nao_encontrado',
  409: 'conflito',
  413: 'arquivo_grande_demais',
  500: 'erro_interno',
};

/**
 * As rotas respondem { erro } a mao em varios pontos. Aqui toda resposta de
 * erro ganha tambem o { codigo }, sem precisar tocar em cada uma.
 */
function codigoNasRespostasDeErro(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (corpo) => {
    if (res.statusCode >= 400 && corpo && typeof corpo === 'object' && corpo.erro && !corpo.codigo) {
      corpo = { ...corpo, codigo: CODIGO_POR_STATUS[res.statusCode] ?? `http_${res.statusCode}` };
    }
    return json(corpo);
  };
  next();
}

/** Erros de programacao ou do banco: a mensagem crua nao serve ao usuario. */
const ERROS_TECNICOS = new Set(['SqliteError', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError']);

/** Traduz qualquer erro para { status, erro, codigo }. */
function traduzirErro(err) {
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE' || err?.status === 413) {
    return { status: 413, erro: 'O arquivo é grande demais para o envio atual.', codigo: 'arquivo_grande_demais' };
  }
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, erro: 'O corpo da requisição não é um JSON válido.', codigo: 'json_invalido' };
  }
  if (err?.name === 'MulterError') {
    return { status: 400, erro: 'O envio do arquivo não pôde ser lido.', codigo: 'envio_invalido' };
  }
  if (err?.status >= 400 && err?.status < 500 && err?.expose) {
    return { status: err.status, erro: err.message, codigo: CODIGO_POR_STATUS[err.status] ?? `http_${err.status}` };
  }
  const tecnico = !err?.message || ERROS_TECNICOS.has(err?.name);
  return {
    status: 500,
    erro: tecnico
      ? 'Ocorreu um erro inesperado no servidor. Os detalhes ficaram registrados no console do servidor.'
      : err.message,
    codigo: 'erro_interno',
  };
}

const bool = (v) => (v ? 1 : 0);

// Os tres modos sao lentes sobre o mesmo bloco, nunca etapas sequenciais.
const MODOS = new Set(['prova', 'projeto', 'aprendizagem']);

// ===========================================================================
// Status
// ===========================================================================
app.get('/api/status', (_req, res) => {
  res.json({ ok: true, ia: iaDisponivel(), modelo: modeloEmUso(), protocolos: PROTOCOLOS });
});

// ===========================================================================
// PASTAS
// ===========================================================================
app.get(
  '/api/pastas',
  rota((_req, res) => {
    res.json(db.prepare('SELECT * FROM pastas ORDER BY nome COLLATE NOCASE').all());
  })
);

app.post(
  '/api/pastas',
  rota((req, res) => {
    const { nome, pasta_pai_id = null } = req.body ?? {};
    if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome da pasta.' });
    const id = novoId();
    db.prepare(
      'INSERT INTO pastas (id, nome, pasta_pai_id, favorito, oculto, criado_em) VALUES (?,?,?,0,0,?)'
    ).run(id, nome.trim(), pasta_pai_id || null, agora());
    res.status(201).json(db.prepare('SELECT * FROM pastas WHERE id = ?').get(id));
  })
);

app.patch(
  '/api/pastas/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM pastas WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Pasta não encontrada.' });

    const b = req.body ?? {};
    // Impede que uma pasta seja movida para dentro dela mesma ou de um descendente.
    let novoPai = b.pasta_pai_id === undefined ? atual.pasta_pai_id : b.pasta_pai_id || null;
    if (novoPai) {
      let cursor = novoPai;
      while (cursor) {
        if (cursor === atual.id) {
          return res.status(400).json({ erro: 'Não é possível mover a pasta para dentro dela mesma.' });
        }
        cursor = db.prepare('SELECT pasta_pai_id FROM pastas WHERE id = ?').get(cursor)?.pasta_pai_id ?? null;
      }
    }

    db.prepare(
      'UPDATE pastas SET nome = ?, pasta_pai_id = ?, favorito = ?, oculto = ? WHERE id = ?'
    ).run(
      b.nome?.trim() || atual.nome,
      novoPai,
      b.favorito === undefined ? atual.favorito : bool(b.favorito),
      b.oculto === undefined ? atual.oculto : bool(b.oculto),
      atual.id
    );
    res.json(db.prepare('SELECT * FROM pastas WHERE id = ?').get(atual.id));
  })
);

app.delete(
  '/api/pastas/:id',
  rota((req, res) => {
    // Os blocos contidos voltam para a raiz (pasta_id = NULL) por ON DELETE SET NULL.
    // Subpastas sao removidas em cascata.
    db.prepare('DELETE FROM pastas WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

// ===========================================================================
// BLOCOS
// ===========================================================================
app.get(
  '/api/blocos',
  rota((_req, res) => {
    res.json(db.prepare('SELECT * FROM blocos ORDER BY nome COLLATE NOCASE').all());
  })
);

app.get(
  '/api/blocos/:id',
  rota((req, res) => {
    const bloco = db.prepare('SELECT * FROM blocos WHERE id = ?').get(req.params.id);
    if (!bloco) return res.status(404).json({ erro: 'Bloco não encontrado.' });
    db.prepare('UPDATE blocos SET ultimo_acesso = ? WHERE id = ?').run(agora(), bloco.id);
    res.json({ ...bloco, ultimo_acesso: agora() });
  })
);

app.post(
  '/api/blocos',
  rota((req, res) => {
    const b = req.body ?? {};
    if (!b.nome?.trim()) return res.status(400).json({ erro: 'Informe o nome do bloco.' });
    const id = novoId();
    db.prepare(
      `INSERT INTO blocos
        (id, nome, descricao, pasta_id, favorito, oculto, wrapper_academico,
         limite_faltas, faltas_registradas, media_aprovacao,
         tabela_conteudos_construida, ultimo_acesso, criado_em)
       VALUES (?,?,?,?,0,0,?,?,0,?,0,?,?)`
    ).run(
      id,
      b.nome.trim(),
      b.descricao?.trim() || null,
      b.pasta_id || null,
      bool(b.wrapper_academico),
      b.limite_faltas === '' || b.limite_faltas == null ? null : Number(b.limite_faltas),
      b.media_aprovacao === '' || b.media_aprovacao == null ? null : Number(b.media_aprovacao),
      agora(),
      agora()
    );
    res.status(201).json(db.prepare('SELECT * FROM blocos WHERE id = ?').get(id));
  })
);

app.patch(
  '/api/blocos/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM blocos WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Bloco não encontrado.' });
    const b = req.body ?? {};
    const num = (chave) =>
      b[chave] === undefined ? atual[chave] : b[chave] === '' || b[chave] === null ? null : Number(b[chave]);

    db.prepare(
      `UPDATE blocos SET nome = ?, descricao = ?, pasta_id = ?, favorito = ?, oculto = ?,
        wrapper_academico = ?, limite_faltas = ?, faltas_registradas = ?, media_aprovacao = ?,
        tabela_conteudos_construida = ?, sugerir_testes_auto = ?, formula_media = ?,
        usar_formula = ? WHERE id = ?`
    ).run(
      b.nome?.trim() || atual.nome,
      b.descricao === undefined ? atual.descricao : b.descricao?.trim() || null,
      b.pasta_id === undefined ? atual.pasta_id : b.pasta_id || null,
      b.favorito === undefined ? atual.favorito : bool(b.favorito),
      b.oculto === undefined ? atual.oculto : bool(b.oculto),
      b.wrapper_academico === undefined ? atual.wrapper_academico : bool(b.wrapper_academico),
      num('limite_faltas'),
      Math.max(0, num('faltas_registradas') ?? 0),
      num('media_aprovacao'),
      b.tabela_conteudos_construida === undefined
        ? atual.tabela_conteudos_construida
        : bool(b.tabela_conteudos_construida),
      b.sugerir_testes_auto === undefined ? atual.sugerir_testes_auto : bool(b.sugerir_testes_auto),
      b.formula_media === undefined ? atual.formula_media : b.formula_media?.trim() || null,
      b.usar_formula === undefined ? atual.usar_formula : bool(b.usar_formula),
      atual.id
    );
    res.json(db.prepare('SELECT * FROM blocos WHERE id = ?').get(atual.id));
  })
);

app.delete(
  '/api/blocos/:id',
  rota((req, res) => {
    db.prepare('DELETE FROM blocos WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

// ===========================================================================
// RELACOES ENTRE BLOCOS
// ===========================================================================
app.get(
  '/api/blocos/:id/relacoes',
  rota((req, res) => {
    const id = req.params.id;
    const linhas = db
      .prepare(
        `SELECT r.*,
                bo.nome AS nome_origem,
                bd.nome AS nome_destino
           FROM bloco_relacoes r
           JOIN blocos bo ON bo.id = r.bloco_origem_id
           JOIN blocos bd ON bd.id = r.bloco_destino_id
          WHERE r.bloco_origem_id = ? OR r.bloco_destino_id = ?`
      )
      .all(id, id);
    // A aresta e armazenada uma unica vez; a perspectiva e calculada aqui.
    res.json(
      linhas.map((l) => ({
        ...l,
        perspectiva: l.bloco_origem_id === id ? 'origem' : 'destino',
        outro_id: l.bloco_origem_id === id ? l.bloco_destino_id : l.bloco_origem_id,
        outro_nome: l.bloco_origem_id === id ? l.nome_destino : l.nome_origem,
      }))
    );
  })
);

app.post(
  '/api/blocos/:id/relacoes',
  rota((req, res) => {
    const origem = req.params.id;
    const { bloco_destino_id, tipo } = req.body ?? {};
    if (!bloco_destino_id || !tipo) return res.status(400).json({ erro: 'Dados incompletos.' });
    if (bloco_destino_id === origem) {
      return res.status(400).json({ erro: 'Um bloco não pode se relacionar consigo mesmo.' });
    }
    if (!['pre_requisito', 'deriva_de', 'fusao_com'].includes(tipo)) {
      return res.status(400).json({ erro: 'Tipo de relação inválido.' });
    }
    // Fusao tem duas ou mais origens e direcao propria: criar uma aresta solta
    // aqui produziria uma "fusao" de um participante so.
    if (tipo === 'fusao_com') {
      return res.status(400).json({
        erro: 'Uma fusão é criada pela opção "É fusão de...", com duas ou mais origens.',
      });
    }

    // Duplicata e a MESMA aresta, na mesma direcao. A direcao inversa nao e
    // duplicata: "A e pre-requisito de B" e "B e pre-requisito de A" dizem
    // coisas diferentes — e a segunda e um ciclo, recusada logo abaixo com a
    // explicacao certa.
    const jaExiste = db
      .prepare(
        'SELECT id FROM bloco_relacoes WHERE tipo = ? AND bloco_origem_id = ? AND bloco_destino_id = ?'
      )
      .get(tipo, origem, bloco_destino_id);
    if (jaExiste) return res.status(409).json({ erro: 'Essa relação já existe.' });

    // Uma dependencia circular nao descreve nada que se possa estudar: o bloco
    // passaria a depender de si mesmo por algum caminho.
    const arestas = db.prepare('SELECT * FROM bloco_relacoes').all();
    const nova = { bloco_origem_id: origem, bloco_destino_id: bloco_destino_id, tipo };
    const ciclo = criariaCiclo(arestas, nova);
    if (ciclo.ciclo) {
      const nomeDe = (x) => db.prepare('SELECT nome FROM blocos WHERE id = ?').get(x)?.nome ?? 'o bloco';
      return res.status(409).json({
        erro: `Isso criaria um ciclo: ${nomeDe(ciclo.dependencia)} já depende de ${nomeDe(ciclo.dependente)} por outro caminho.`,
      });
    }

    const id = novoId();
    db.prepare(
      'INSERT INTO bloco_relacoes (id, bloco_origem_id, bloco_destino_id, tipo) VALUES (?,?,?,?)'
    ).run(id, origem, bloco_destino_id, tipo);
    res.status(201).json({ id });
  })
);

app.delete(
  '/api/relacoes/:id',
  rota((req, res) => {
    db.prepare('DELETE FROM bloco_relacoes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

// ===========================================================================
// TOPICOS (tabela de conteudos)
// ===========================================================================
app.get(
  '/api/blocos/:id/topicos',
  rota((req, res) => {
    res.json(
      db
        .prepare('SELECT * FROM topicos WHERE bloco_id = ? ORDER BY ordem, rowid')
        .all(req.params.id)
    );
  })
);

// Sincroniza a arvore inteira preservando ids existentes (e portanto revisoes,
// evidencias e checks ja registrados). Topicos ausentes do payload sao removidos.
app.put(
  '/api/blocos/:id/topicos',
  rota((req, res) => {
    const blocoId = req.params.id;
    const bloco = db.prepare('SELECT id FROM blocos WHERE id = ?').get(blocoId);
    if (!bloco) return res.status(404).json({ erro: 'Bloco não encontrado.' });

    const recebidos = Array.isArray(req.body?.topicos) ? req.body.topicos : [];
    const idsRecebidos = new Set(recebidos.map((t) => t.id));

    const sincronizar = db.transaction(() => {
      const existentes = db.prepare('SELECT id FROM topicos WHERE bloco_id = ?').all(blocoId);
      for (const { id } of existentes) {
        if (!idsRecebidos.has(id)) db.prepare('DELETE FROM topicos WHERE id = ?').run(id);
      }
      const upsert = db.prepare(
        `INSERT INTO topicos (id, bloco_id, topico_pai_id, titulo, ordem, natureza, peso, check_aprendizagem, data_check)
         VALUES (@id, @bloco_id, @topico_pai_id, @titulo, @ordem, @natureza, @peso, 0, NULL)
         ON CONFLICT(id) DO UPDATE SET
           topico_pai_id = excluded.topico_pai_id,
           titulo = excluded.titulo,
           ordem = excluded.ordem,
           natureza = excluded.natureza,
           peso = excluded.peso`
      );
      recebidos.forEach((t, i) => {
        upsert.run({
          id: t.id || novoId(),
          bloco_id: blocoId,
          topico_pai_id: idsRecebidos.has(t.topico_pai_id) ? t.topico_pai_id : null,
          titulo: String(t.titulo || 'Sem título').trim(),
          ordem: Number.isFinite(t.ordem) ? t.ordem : i,
          natureza: ['declarativo', 'procedimental', 'relacional'].includes(t.natureza)
            ? t.natureza
            : 'declarativo',
          peso: ['baixo', 'medio', 'alto'].includes(t.peso) ? t.peso : 'medio',
        });
      });
      if (req.body?.marcar_construida) {
        db.prepare('UPDATE blocos SET tabela_conteudos_construida = 1 WHERE id = ?').run(blocoId);
      }
    });
    sincronizar();

    res.json(db.prepare('SELECT * FROM topicos WHERE bloco_id = ? ORDER BY ordem, rowid').all(blocoId));
  })
);

// ---------------------------------------------------------------------------
// Check de aprendizagem + agendamento da revisao 1 (+3 dias)
// ---------------------------------------------------------------------------
function agendarPrimeiraRevisao(topicoId) {
  const existe = db
    .prepare("SELECT id FROM revisoes WHERE topico_id = ? AND numero = 1")
    .get(topicoId);
  if (existe) return;
  db.prepare(
    'INSERT INTO revisoes (id, topico_id, numero, data_prevista, status) VALUES (?,?,?,?,?)'
  ).run(novoId(), topicoId, 1, somarDias(hojeISO(), 3), 'pendente');
}

app.post(
  '/api/topicos/:id/check',
  rota((req, res) => {
    const topico = db.prepare('SELECT * FROM topicos WHERE id = ?').get(req.params.id);
    if (!topico) return res.status(404).json({ erro: 'Tópico não encontrado.' });

    const marcado = Boolean(req.body?.marcado);
    db.prepare('UPDATE topicos SET check_aprendizagem = ?, data_check = ? WHERE id = ?').run(
      bool(marcado),
      marcado ? agora() : null,
      topico.id
    );

    if (marcado) {
      agendarPrimeiraRevisao(topico.id);
      const ev = req.body?.evidencia;
      if (ev?.descricao) {
        db.prepare('INSERT INTO evidencias (id, topico_id, modo, descricao, data) VALUES (?,?,?,?,?)').run(
          novoId(),
          topico.id,
          ev.modo || 'aprendizagem',
          String(ev.descricao),
          agora()
        );
      }
    } else {
      // Desmarcar remove apenas revisoes ainda nao concluidas; o log de
      // evidencias e as revisoes ja concluidas sao historico e permanecem.
      db.prepare("DELETE FROM revisoes WHERE topico_id = ? AND status != 'concluida'").run(topico.id);
    }

    res.json(db.prepare('SELECT * FROM topicos WHERE id = ?').get(topico.id));
  })
);

// ===========================================================================
// EVIDENCIAS (log qualitativo — nunca somado, contado ou convertido em metrica)
// ===========================================================================
app.get(
  '/api/blocos/:id/evidencias',
  rota((req, res) => {
    res.json(
      db
        .prepare(
          `SELECT e.* FROM evidencias e
             JOIN topicos t ON t.id = e.topico_id
            WHERE t.bloco_id = ?
            ORDER BY e.data DESC`
        )
        .all(req.params.id)
    );
  })
);

app.post(
  '/api/topicos/:id/evidencias',
  rota((req, res) => {
    const id = novoId();
    db.prepare('INSERT INTO evidencias (id, topico_id, modo, descricao, data) VALUES (?,?,?,?,?)').run(
      id,
      req.params.id,
      req.body?.modo || 'aprendizagem',
      String(req.body?.descricao || ''),
      agora()
    );
    res.status(201).json(db.prepare('SELECT * FROM evidencias WHERE id = ?').get(id));
  })
);

// ===========================================================================
// REVISOES — repeticao espacada 3 / 7 / 14 dias, maximo 3 por topico
// ===========================================================================
const INTERVALO_APOS = { 1: 7, 2: 14 };

const SQL_REVISOES = `
  SELECT r.*, t.titulo AS topico_titulo, t.natureza, t.bloco_id, b.nome AS bloco_nome
    FROM revisoes r
    JOIN topicos t ON t.id = r.topico_id
    JOIN blocos b ON b.id = t.bloco_id
   WHERE r.status != 'concluida'`;

app.get(
  '/api/blocos/:id/revisoes',
  rota((req, res) => {
    res.json(
      db.prepare(`${SQL_REVISOES} AND t.bloco_id = ? ORDER BY r.data_prevista`).all(req.params.id)
    );
  })
);

app.post(
  '/api/revisoes/:id/concluir',
  rota((req, res) => {
    const rev = db.prepare('SELECT * FROM revisoes WHERE id = ?').get(req.params.id);
    if (!rev) return res.status(404).json({ erro: 'Revisão não encontrada.' });

    db.prepare("UPDATE revisoes SET status = 'concluida', data_conclusao = ? WHERE id = ?").run(
      hojeISO(),
      rev.id
    );

    // Encadeia a proxima revisao: 1 -> 2 (+7 dias), 2 -> 3 (+14 dias).
    // Apos a revisao 3 o topico sai da lista (nao ha revisao 4).
    const proximo = rev.numero + 1;
    const intervalo = INTERVALO_APOS[rev.numero];
    if (intervalo) {
      const jaTem = db
        .prepare('SELECT id FROM revisoes WHERE topico_id = ? AND numero = ?')
        .get(rev.topico_id, proximo);
      if (!jaTem) {
        db.prepare(
          'INSERT INTO revisoes (id, topico_id, numero, data_prevista, status) VALUES (?,?,?,?,?)'
        ).run(novoId(), rev.topico_id, proximo, somarDias(hojeISO(), intervalo), 'pendente');
      }
    }
    res.json({ ok: true });
  })
);

app.post(
  '/api/revisoes/:id/reagendar',
  rota((req, res) => {
    const data = String(req.body?.data_prevista || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return res.status(400).json({ erro: 'Informe uma data válida.' });
    }
    // Reagendar apenas move a data. Nao avanca o numero da revisao e nunca
    // e tratado como atraso, falha ou pendencia negativa.
    const r = db
      .prepare("UPDATE revisoes SET data_prevista = ?, status = 'reagendada' WHERE id = ?")
      .run(data, req.params.id);
    if (r.changes === 0) return res.status(404).json({ erro: 'Revisão não encontrada.' });
    res.json({ ok: true });
  })
);

// ===========================================================================
// IA — todas as chamadas passam pelo servidor
// ===========================================================================
app.post(
  '/api/ia/extrair-tabela',
  rota(async (req, res) => {
    // Texto avulso vai como veio; senao o material vem do repositorio do
    // bloco — os escolhidos, ou todos quando nada foi escolhido.
    if (req.body?.texto) return res.json(await extrairTabelaConteudos(req.body.texto));
    if (!req.body?.bloco_id) return res.json(await extrairTabelaConteudos(''));
    const material = materialParaTabela(req.body.bloco_id, req.body?.documentos_ids);
    res.json(await extrairTabelaConteudos(material.texto, { estruturado: material.estruturado }));
  })
);

app.post(
  '/api/ia/roteiro',
  rota(async (req, res) => {
    res.json(await buscarRoteiroEstudos(req.body?.tema));
  })
);

// ===========================================================================
// SONDAGEM — conversa persistida em mensagens_chat
// ===========================================================================
function historicoSondagem(blocoId, topicoId) {
  return db
    .prepare(
      'SELECT * FROM mensagens_chat WHERE bloco_id = ? AND topico_id IS ? ORDER BY criado_em, rowid'
    )
    .all(blocoId, topicoId ?? null);
}

function salvarMensagem(blocoId, topicoId, papel, conteudo, modo = 'aprendizagem') {
  const id = novoId();
  db.prepare(
    'INSERT INTO mensagens_chat (id, bloco_id, topico_id, papel, conteudo, modo_ativo, criado_em) VALUES (?,?,?,?,?,?,?)'
  ).run(id, blocoId, topicoId ?? null, papel, conteudo, MODOS.has(modo) ? modo : 'aprendizagem', agora());
  return db.prepare('SELECT * FROM mensagens_chat WHERE id = ?').get(id);
}

app.get(
  '/api/sondagem/:blocoId/:topicoId/mensagens',
  rota((req, res) => {
    res.json(historicoSondagem(req.params.blocoId, req.params.topicoId));
  })
);

// Aberturas em voo, para que duas chamadas simultaneas (StrictMode, duplo clique)
// nao gerem duas falas iniciais para a mesma conversa.
const aberturasEmVoo = new Map();

// Abertura da sondagem: so gera a fala inicial se a conversa ainda estiver vazia.
app.post(
  '/api/sondagem/iniciar',
  rota(async (req, res) => {
    const { bloco_id, topico_id } = req.body ?? {};
    const topico = db.prepare('SELECT * FROM topicos WHERE id = ?').get(topico_id);
    if (!topico) return res.status(404).json({ erro: 'Tópico não encontrado.' });

    const historico = historicoSondagem(bloco_id, topico_id);
    if (historico.length > 0) return res.json({ mensagens: historico, erro: null });

    const chave = `${bloco_id}|${topico_id}`;
    if (!aberturasEmVoo.has(chave)) {
      const promessa = conversarSondagem([], topico.titulo, topico.natureza)
        .then((texto) => {
          // Reconfere sob a mesma promessa: so insere se ainda estiver vazia.
          if (historicoSondagem(bloco_id, topico_id).length > 0) return null;
          return salvarMensagem(bloco_id, topico_id, 'assistente', texto);
        })
        .finally(() => aberturasEmVoo.delete(chave));
      aberturasEmVoo.set(chave, promessa);
    }

    try {
      await aberturasEmVoo.get(chave);
      return res.json({ mensagens: historicoSondagem(bloco_id, topico_id), erro: null });
    } catch (e) {
      // Falha da IA nunca bloqueia a tela: o protocolo e mostrado mesmo assim.
      return res.json({ mensagens: [], erro: `A IA não respondeu (${e.message}).` });
    }
  })
);

app.post(
  '/api/sondagem/mensagem',
  rota(async (req, res) => {
    const { bloco_id, topico_id, conteudo } = req.body ?? {};
    const topico = db.prepare('SELECT * FROM topicos WHERE id = ?').get(topico_id);
    if (!topico) return res.status(404).json({ erro: 'Tópico não encontrado.' });
    if (!String(conteudo || '').trim()) return res.status(400).json({ erro: 'Mensagem vazia.' });

    const minha = salvarMensagem(bloco_id, topico_id, 'usuario', String(conteudo).trim());
    const historico = historicoSondagem(bloco_id, topico_id);

    try {
      const texto = await conversarSondagem(historico, topico.titulo, topico.natureza);
      const dela = salvarMensagem(bloco_id, topico_id, 'assistente', texto);
      return res.json({ mensagens: [minha, dela], erro: null });
    } catch (e) {
      return res.json({ mensagens: [minha], erro: `A IA não respondeu (${e.message}).` });
    }
  })
);

// ===========================================================================
// INICIO
// ===========================================================================
app.get(
  '/api/inicio',
  rota((_req, res) => {
    const recentes = db
      .prepare(
        `SELECT b.*, p.nome AS pasta_nome FROM blocos b
           LEFT JOIN pastas p ON p.id = b.pasta_id
          WHERE b.ultimo_acesso IS NOT NULL AND b.oculto = 0
          ORDER BY b.ultimo_acesso DESC LIMIT 8`
      )
      .all();

    // Consulta direta: revisoes com data prevista ate hoje e ainda nao concluidas.
    const revisoes = db
      .prepare(`${SQL_REVISOES} AND r.data_prevista <= ? ORDER BY r.data_prevista`)
      .all(hojeISO());

    res.json({ blocos_recentes: recentes, revisoes_hoje: revisoes, hoje: hojeISO() });
  })
);

// ===========================================================================
// CHAT LATERAL DO BLOCO
// As mensagens do chat do bloco sao as que tem topico_id NULL; as da sondagem
// ficam sob o id do topico. Ambas moram em mensagens_chat.
// ===========================================================================
app.get(
  '/api/blocos/:id/chat',
  rota((req, res) => {
    res.json(historicoSondagem(req.params.id, null));
  })
);

app.post(
  '/api/blocos/:id/chat',
  rota(async (req, res) => {
    const blocoId = req.params.id;
    const modo = MODOS.has(req.body?.modo) ? req.body.modo : 'aprendizagem';
    const conteudo = String(req.body?.conteudo ?? '').trim();
    if (!conteudo) return res.status(400).json({ erro: 'Mensagem vazia.' });

    const minha = salvarMensagem(blocoId, null, 'usuario', conteudo, modo);
    try {
      const texto = await conversarBloco(historicoSondagem(blocoId, null), modo);
      return res.json({ mensagens: [minha, salvarMensagem(blocoId, null, 'assistente', texto, modo)], erro: null });
    } catch (e) {
      // A mensagem do usuario permanece salva; o erro nunca bloqueia a tela.
      return res.json({ mensagens: [minha], erro: `A IA não respondeu (${e.message}).` });
    }
  })
);

app.delete(
  '/api/blocos/:id/chat',
  rota((req, res) => {
    db.prepare('DELETE FROM mensagens_chat WHERE bloco_id = ? AND topico_id IS NULL').run(req.params.id);
    res.json({ ok: true });
  })
);

// ===========================================================================
// LISTAS DE QUESTOES
// ===========================================================================
// 'gerada_geral': conhecimento geral do modelo, so com confirmacao do usuario
// quando os documentos nao tratam do topico.
const ORIGENS = new Set(['enviada', 'gerada_fontes', 'gerada_internet', 'gerada_geral']);
const STATUS_LISTA = new Set(['nao_feita', 'incompleta', 'completa']);

const SQL_LISTAS = `
  SELECT l.*, t.titulo AS topico_titulo, t.peso AS topico_peso
    FROM listas_questoes l
    LEFT JOIN topicos t ON t.id = l.topico_id`;

app.get(
  '/api/blocos/:id/listas',
  rota((req, res) => {
    const contexto = req.query.contexto === 'projeto' ? 'projeto' : 'prova';
    res.json(
      db
        .prepare(`${SQL_LISTAS} WHERE l.bloco_id = ? AND l.contexto = ? ORDER BY l.criado_em DESC`)
        .all(req.params.id, contexto)
    );
  })
);

app.get(
  '/api/listas/:id',
  rota((req, res) => {
    const lista = db.prepare(`${SQL_LISTAS} WHERE l.id = ?`).get(req.params.id);
    if (!lista) return res.status(404).json({ erro: 'Lista não encontrada.' });
    res.json(lista);
  })
);

app.post(
  '/api/blocos/:id/listas',
  rota((req, res) => {
    const b = req.body ?? {};
    if (!ORIGENS.has(b.origem)) return res.status(400).json({ erro: 'Origem inválida.' });
    const id = novoId();
    db.prepare(
      `INSERT INTO listas_questoes
        (id, bloco_id, topico_id, titulo, enunciado, gabarito, origem, status, quantidade, contexto, criado_em,
         data_prevista, tempo_estimado_min, origem_estimativa, tipo_tarefa, origem_paginas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      req.params.id,
      b.topico_id || null,
      String(b.titulo || 'Lista sem título').trim(),
      // questoes e gabarito sao guardados como JSON quando estruturados,
      // ou como texto simples quando a lista foi colada/enviada pelo usuario.
      typeof b.questoes === 'string' ? b.questoes : JSON.stringify(b.questoes ?? []),
      b.gabarito == null ? null : typeof b.gabarito === 'string' ? b.gabarito : JSON.stringify(b.gabarito),
      b.origem,
      'nao_feita',
      b.quantidade == null ? null : Number(b.quantidade),
      b.contexto === 'projeto' ? 'projeto' : 'prova',
      agora(),
      b.data_prevista || null,
      b.tempo_estimado_min == null || b.tempo_estimado_min === '' ? null : Number(b.tempo_estimado_min),
      b.origem_estimativa || null,
      b.tipo_tarefa?.trim() || null,
      // Paginas de onde a lista gerada saiu, para exibir discretamente.
      Array.isArray(b.origem_paginas) && b.origem_paginas.length ? JSON.stringify(b.origem_paginas) : null
    );
    res.status(201).json(db.prepare(`${SQL_LISTAS} WHERE l.id = ?`).get(id));
  })
);

app.patch(
  '/api/listas/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM listas_questoes WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Lista não encontrada.' });

    const b = req.body ?? {};
    const status = STATUS_LISTA.has(b.status) ? b.status : atual.status;

    // "completa" e o momento da conclusao; voltar atras limpa a marca.
    const concluidoEm =
      status === 'completa' ? (atual.concluido_em ?? agora()) : null;

    db.prepare(
      `UPDATE listas_questoes SET titulo = ?, status = ?, gabarito = ?, concluido_em = ?,
        data_prevista = ?, tempo_estimado_min = ?, origem_estimativa = ?, tipo_tarefa = ?
        WHERE id = ?`
    ).run(
      b.titulo?.trim() || atual.titulo,
      status,
      b.gabarito === undefined
        ? atual.gabarito
        : b.gabarito == null
          ? null
          : typeof b.gabarito === 'string'
            ? b.gabarito
            : JSON.stringify(b.gabarito),
      concluidoEm,
      b.data_prevista === undefined ? atual.data_prevista : b.data_prevista || null,
      b.tempo_estimado_min === undefined
        ? atual.tempo_estimado_min
        : b.tempo_estimado_min === '' || b.tempo_estimado_min === null
          ? null
          : Number(b.tempo_estimado_min),
      b.origem_estimativa === undefined ? atual.origem_estimativa : b.origem_estimativa || null,
      b.tipo_tarefa === undefined ? atual.tipo_tarefa : b.tipo_tarefa?.trim() || null,
      atual.id
    );

    // Marcar como "completa" registra uma evidencia — log qualitativo, nunca somado.
    // So no momento da transicao, para nao duplicar.
    if (status === 'completa' && atual.status !== 'completa' && atual.topico_id) {
      db.prepare('INSERT INTO evidencias (id, topico_id, modo, descricao, data) VALUES (?,?,?,?,?)').run(
        novoId(),
        atual.topico_id,
        atual.contexto === 'projeto' ? 'projeto' : 'prova',
        `Lista ${b.titulo?.trim() || atual.titulo} concluída`,
        agora()
      );
    }

    res.json(db.prepare(`${SQL_LISTAS} WHERE l.id = ?`).get(atual.id));
  })
);

app.delete(
  '/api/listas/:id',
  rota((req, res) => {
    db.prepare('DELETE FROM listas_questoes WHERE id = ?').run(req.params.id);
    // Os usos descrevem a lista, nao o documento: some a lista, somem eles.
    // Excluir um DOCUMENTO e outra coisa — ali a referencia fica, marcada como
    // removida, para o item gerado continuar dizendo de onde veio.
    db.prepare("DELETE FROM documento_usos WHERE item_tipo = 'lista_questoes' AND item_id = ?").run(
      req.params.id
    );
    res.json({ ok: true });
  })
);

/**
 * "Corrigir com a IA": injeta o contexto da lista como uma mensagem visivel do
 * usuario no chat do bloco e pede a primeira resposta. A correcao e informativa
 * e NUNCA altera o status da lista.
 */
app.post(
  '/api/listas/:id/corrigir',
  rota(async (req, res) => {
    const lista = db.prepare('SELECT * FROM listas_questoes WHERE id = ?').get(req.params.id);
    if (!lista) return res.status(404).json({ erro: 'Lista não encontrada.' });

    const modo = lista.contexto === 'projeto' ? 'projeto' : 'prova';
    const questoes = textoDasQuestoes(lista.enunciado);
    const contexto = [
      `Quero corrigir minhas respostas da lista "${lista.titulo}".`,
      '',
      'Questões:',
      questoes,
      '',
      'Vou colar minhas respostas na próxima mensagem. Não atribua nota nem pontuação.',
    ].join('\n');

    const minha = salvarMensagem(lista.bloco_id, null, 'usuario', contexto, modo);
    try {
      const texto = await conversarBloco(historicoSondagem(lista.bloco_id, null), modo);
      return res.json({
        mensagens: [minha, salvarMensagem(lista.bloco_id, null, 'assistente', texto, modo)],
        erro: null,
      });
    } catch (e) {
      return res.json({ mensagens: [minha], erro: `A IA não respondeu (${e.message}).` });
    }
  })
);

/** Converte o campo enunciado (JSON estruturado ou texto puro) em texto legivel. */
function textoDasQuestoes(enunciado) {
  try {
    const dados = JSON.parse(enunciado);
    if (Array.isArray(dados)) {
      return dados.map((q) => `${q.numero}. ${q.enunciado}`).join('\n\n');
    }
  } catch {
    /* nao era JSON: e texto puro */
  }
  return String(enunciado ?? '');
}

// ===========================================================================
// IA — listas de questoes
// ===========================================================================

// ---------------------------------------------------------------------------
// Recuperacao por topico: a lista e gerada so a partir dos trechos que tratam
// do topico, nunca do documento inteiro.
// ---------------------------------------------------------------------------
const AVISO_SEM_RELEVANCIA = 'Os documentos selecionados não parecem tratar deste tópico.';

/** O topico como consulta: titulo, subtopicos diretos e topico pai. */
function consultaDoTopico(topico) {
  const subtopicos = db
    .prepare('SELECT titulo FROM topicos WHERE topico_pai_id = ? ORDER BY ordem')
    .all(topico.id)
    .map((t) => t.titulo);
  const pai = topico.topico_pai_id
    ? (db.prepare('SELECT titulo FROM topicos WHERE id = ?').get(topico.topico_pai_id)?.titulo ?? null)
    : null;
  return { titulo: topico.titulo, subtopicos, pai };
}

/**
 * Trechos dos documentos escolhidos (ou de todos os do bloco) que tratam do
 * topico. Com todos os trechos indexados e a IA disponivel, a busca e por
 * embeddings; senao, por palavras-chave (BM25).
 */
async function trechosDoTopico(blocoId, documentosIds, topico) {
  const docs = db
    .prepare('SELECT id, nome_arquivo, status, sumario FROM documentos_fonte WHERE bloco_id = ?')
    .all(blocoId)
    .filter((d) => !documentosIds?.length || documentosIds.includes(d.id));
  const prontos = docs.filter((d) => (d.status ?? 'pronto') === 'pronto');
  const base = {
    trechos: [],
    relevantes: false,
    metodo: 'nenhum',
    semDocumentos: docs.length === 0,
    processando: docs.filter((d) => d.status === 'processando').map((d) => d.nome_arquivo),
    nomes: new Map(prontos.map((d) => [d.id, d.nome_arquivo])),
  };
  if (prontos.length === 0) return base;

  const ids = prontos.map((d) => d.id);
  const marcas = ids.map(() => '?').join(',');
  const linhas = db
    .prepare(
      `SELECT id, documento_id, ordem, texto, pagina_inicio, pagina_fim, titulo_secao,
              embedding IS NOT NULL AS tem_vetor
         FROM documento_trechos WHERE documento_id IN (${marcas}) ORDER BY documento_id, ordem`
    )
    .all(...ids);
  if (linhas.length === 0) return base;

  const consulta = consultaDoTopico(topico);
  // A consulta so ganha embedding quando TODOS os trechos tem o seu: comparar
  // cosseno de uns com BM25 de outros nao faria sentido.
  let vetor = null;
  if (iaDisponivel() && linhas.every((l) => l.tem_vetor === 1)) {
    vetor = await embeddingDaConsulta(textoDaConsulta(consulta));
  }
  let vetores = new Map();
  if (vetor) {
    vetores = new Map(
      db
        .prepare(`SELECT id, embedding FROM documento_trechos WHERE documento_id IN (${marcas})`)
        .all(...ids)
        .map((l) => [l.id, JSON.parse(l.embedding)])
    );
  }

  const sumarios = new Map(prontos.filter((d) => d.sumario).map((d) => [d.id, JSON.parse(d.sumario)]));
  const r = selecionarTrechos({
    trechos: linhas.map((l) => ({ ...l, embedding: vetores.get(l.id) ?? null })),
    consulta,
    vetorConsulta: vetor,
    sumarios,
  });
  return {
    ...base,
    relevantes: r.relevantes,
    metodo: r.metodo,
    trechos: r.selecionados.map((t) => ({
      id: t.id,
      documento_id: t.documento_id,
      nome: base.nomes.get(t.documento_id),
      texto: t.texto,
      pagina_inicio: t.pagina_inicio,
      pagina_fim: t.pagina_fim,
      titulo_secao: t.titulo_secao,
    })),
  };
}

/**
 * Troca o rotulo "T3" de cada questao pelo apoio legivel (documento, paginas,
 * secao) e calcula as paginas de origem da lista a partir dos trechos usados.
 */
function aplicarApoio(resultado, trechos, nomes) {
  const usados = new Set();
  const questoes = resultado.questoes.map(({ trecho, ...q }) => {
    const i = /^T(\d+)$/.exec(String(trecho ?? ''))?.[1];
    const t = i ? trechos[Number(i) - 1] : null;
    if (!t) return q;
    usados.add(t);
    return {
      ...q,
      apoio: {
        documento_id: t.documento_id,
        nome: t.nome,
        pagina_inicio: t.pagina_inicio,
        pagina_fim: t.pagina_fim,
        titulo_secao: t.titulo_secao,
      },
    };
  });
  // Sem indicacao do modelo, a origem sao todos os trechos enviados.
  const base = usados.size ? [...usados] : trechos;
  return { ...resultado, questoes, origem_paginas: paginasDeOrigem(base, nomes) };
}

app.post(
  '/api/ia/lista-questoes',
  rota(async (req, res) => {
    const { bloco_id, topico_id, quantidade, fonte } = req.body ?? {};
    const topico = db.prepare('SELECT * FROM topicos WHERE id = ?').get(topico_id);
    if (!topico) return res.status(404).json({ erro: 'Tópico não encontrado.' });
    const consulta = consultaDoTopico(topico);

    // Internet, ou conhecimento geral (so depois da confirmacao do usuario).
    if (fonte?.tipo === 'internet' || fonte?.tipo === 'geral') {
      const r = await gerarListaQuestoes({ tipo: fonte.tipo }, consulta, quantidade);
      return res.json({ ...r, origem_paginas: null });
    }

    const rec = await trechosDoTopico(bloco_id, fonte?.documentos_ids, topico);
    if (rec.semDocumentos) {
      return res.json({ questoes: [], gabarito: [], erro: 'Este bloco ainda não tem documentos no repositório.' });
    }
    if (rec.trechos.length === 0 && rec.processando.length && rec.nomes.size === 0) {
      return res.json({
        questoes: [],
        gabarito: [],
        erro: 'Os documentos escolhidos ainda estão sendo processados. Assim que ficarem prontos, é só gerar de novo.',
      });
    }
    // Nenhum trecho com relevancia minima: NAO gera questoes fora do topico.
    if (!rec.relevantes) {
      return res.json({ questoes: [], gabarito: [], erro: null, sem_relevancia: true, aviso: AVISO_SEM_RELEVANCIA });
    }

    const r = await gerarListaQuestoes({ tipo: 'documentos', trechos: rec.trechos }, consulta, quantidade);
    if (r.erro || r.questoes.length === 0) return res.json({ ...r, origem_paginas: null });
    res.json({
      ...aplicarApoio(r, rec.trechos, rec.nomes),
      recuperacao: {
        metodo: rec.metodo,
        trechos: rec.trechos.map(({ texto: _t, ...t }) => t),
      },
    });
  })
);

app.post(
  '/api/ia/gabarito',
  rota(async (req, res) => {
    res.json(await gerarGabarito(req.body?.questoes));
  })
);

// ===========================================================================
// ENTREGAVEIS
// ===========================================================================
function topicosDoEntregavel(entregavelId) {
  return db
    .prepare(
      `SELECT t.id, t.titulo, t.peso, t.natureza
         FROM entregavel_topicos et
         JOIN topicos t ON t.id = et.topico_id
        WHERE et.entregavel_id = ?
        ORDER BY t.ordem`
    )
    .all(entregavelId);
}

const comTopicos = (e) => ({ ...e, topicos: topicosDoEntregavel(e.id) });

app.get(
  '/api/blocos/:id/entregaveis',
  rota((req, res) => {
    const lista = db
      .prepare('SELECT * FROM entregaveis WHERE bloco_id = ? ORDER BY (data_entrega IS NULL), data_entrega, criado_em')
      .all(req.params.id);
    res.json(lista.map(comTopicos));
  })
);

function gravarTopicos(entregavelId, topicoIds) {
  db.prepare('DELETE FROM entregavel_topicos WHERE entregavel_id = ?').run(entregavelId);
  const inserir = db.prepare('INSERT INTO entregavel_topicos (id, entregavel_id, topico_id) VALUES (?,?,?)');
  for (const topicoId of new Set(Array.isArray(topicoIds) ? topicoIds : [])) {
    if (db.prepare('SELECT id FROM topicos WHERE id = ?').get(topicoId)) {
      inserir.run(novoId(), entregavelId, topicoId);
    }
  }
}

app.post(
  '/api/blocos/:id/entregaveis',
  rota((req, res) => {
    const b = req.body ?? {};
    if (!b.titulo?.trim()) return res.status(400).json({ erro: 'Informe o nome do entregável.' });
    const id = novoId();
    db.prepare(
      `INSERT INTO entregaveis
        (id, bloco_id, titulo, descricao, data_entrega, ferramentas, tempo_estimado_horas, concluido, status, criado_em,
         origem_estimativa, tipo_tarefa)
       VALUES (?,?,?,?,?,?,?,0,NULL,?,?,?)`
    ).run(
      id,
      req.params.id,
      b.titulo.trim(),
      b.descricao?.trim() || null,
      b.data_entrega || null,
      b.ferramentas?.trim() || null,
      b.tempo_estimado_horas === '' || b.tempo_estimado_horas == null ? null : Number(b.tempo_estimado_horas),
      agora(),
      b.origem_estimativa || null,
      b.tipo_tarefa?.trim() || null
    );
    gravarTopicos(id, b.topico_ids);
    res.status(201).json(comTopicos(db.prepare('SELECT * FROM entregaveis WHERE id = ?').get(id)));
  })
);

app.patch(
  '/api/entregaveis/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM entregaveis WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Entregável não encontrado.' });
    const b = req.body ?? {};

    db.prepare(
      `UPDATE entregaveis SET titulo = ?, descricao = ?, data_entrega = ?, ferramentas = ?,
        tempo_estimado_horas = ?, origem_estimativa = ?, tipo_tarefa = ? WHERE id = ?`
    ).run(
      b.titulo?.trim() || atual.titulo,
      b.descricao === undefined ? atual.descricao : b.descricao?.trim() || null,
      b.data_entrega === undefined ? atual.data_entrega : b.data_entrega || null,
      b.ferramentas === undefined ? atual.ferramentas : b.ferramentas?.trim() || null,
      b.tempo_estimado_horas === undefined
        ? atual.tempo_estimado_horas
        : b.tempo_estimado_horas === '' || b.tempo_estimado_horas === null
          ? null
          : Number(b.tempo_estimado_horas),
      b.origem_estimativa === undefined ? atual.origem_estimativa : b.origem_estimativa || null,
      b.tipo_tarefa === undefined ? atual.tipo_tarefa : b.tipo_tarefa?.trim() || null,
      atual.id
    );
    if (b.topico_ids !== undefined) gravarTopicos(atual.id, b.topico_ids);
    res.json(comTopicos(db.prepare('SELECT * FROM entregaveis WHERE id = ?').get(atual.id)));
  })
);

/**
 * Reagendar apenas move a data de entrega. Nunca conta como atraso, falha ou
 * pendencia negativa.
 */
app.post(
  '/api/entregaveis/:id/reagendar',
  rota((req, res) => {
    const data = String(req.body?.data_entrega || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: 'Informe uma data válida.' });
    const r = db.prepare('UPDATE entregaveis SET data_entrega = ? WHERE id = ?').run(data, req.params.id);
    if (r.changes === 0) return res.status(404).json({ erro: 'Entregável não encontrado.' });
    res.json({ ok: true });
  })
);

const ORDEM_PESO = { alto: 0, medio: 1, baixo: 2 };
const LIMITE_TESTES_AUTOMATICOS = 3;

/**
 * Conclui (ou desmarca) um entregavel. Ao concluir, registra uma evidencia para
 * CADA topico associado e, se o bloco tiver a sugestao automatica ligada, gera
 * ate LIMITE_TESTES_AUTOMATICOS testes teoricos, priorizando os topicos de maior peso.
 */
app.post(
  '/api/entregaveis/:id/concluir',
  rota(async (req, res) => {
    const entregavel = db.prepare('SELECT * FROM entregaveis WHERE id = ?').get(req.params.id);
    if (!entregavel) return res.status(404).json({ erro: 'Entregável não encontrado.' });

    const concluido = req.body?.concluido === undefined ? true : Boolean(req.body.concluido);
    const jaEstava = entregavel.concluido === 1;

    db.prepare('UPDATE entregaveis SET concluido = ?, concluido_em = ? WHERE id = ?').run(
      concluido ? 1 : 0,
      concluido ? agora() : null,
      entregavel.id
    );

    if (!concluido || jaEstava) {
      return res.json({ ok: true, testes_gerados: [], erro: null });
    }

    const topicos = topicosDoEntregavel(entregavel.id);
    const inserirEvidencia = db.prepare(
      'INSERT INTO evidencias (id, topico_id, modo, descricao, data) VALUES (?,?,?,?,?)'
    );
    for (const t of topicos) {
      inserirEvidencia.run(novoId(), t.id, 'projeto', `Entregável ${entregavel.titulo} concluído`, agora());
    }

    const bloco = db.prepare('SELECT * FROM blocos WHERE id = ?').get(entregavel.bloco_id);
    if (bloco?.sugerir_testes_auto !== 1 || topicos.length === 0) {
      return res.json({ ok: true, testes_gerados: [], erro: null });
    }

    const temDocumentos = db
      .prepare(
        "SELECT 1 FROM documentos_fonte WHERE bloco_id = ? AND COALESCE(status, 'pronto') = 'pronto' LIMIT 1"
      )
      .get(entregavel.bloco_id);
    if (!temDocumentos) {
      return res.json({
        ok: true,
        testes_gerados: [],
        erro:
          'Entregável concluído. Os testes automáticos não foram gerados porque este bloco ainda não tem documentos-fonte — use "Pedir teste de um tópico" para escolher outra fonte.',
      });
    }

    // Limite rigido: no maximo 3 testes por vez, priorizando os de maior peso.
    const prioritarios = [...topicos]
      .sort((a, b) => (ORDEM_PESO[a.peso] ?? 1) - (ORDEM_PESO[b.peso] ?? 1))
      .slice(0, LIMITE_TESTES_AUTOMATICOS);

    const gerados = [];
    const problemas = [];
    for (const topico of prioritarios) {
      // Mesma regra das listas: so os trechos do topico vao para o modelo.
      const rec = await trechosDoTopico(entregavel.bloco_id, null, topico);
      if (!rec.relevantes) {
        problemas.push(`${topico.titulo}: ${AVISO_SEM_RELEVANCIA.toLowerCase().replace(/\.$/, '')}`);
        continue;
      }
      const bruto = await gerarListaQuestoes(
        { tipo: 'documentos', trechos: rec.trechos },
        consultaDoTopico(topico),
        5
      );
      if (bruto.erro || bruto.questoes.length === 0) {
        problemas.push(`${topico.titulo}: ${bruto.erro ?? 'sem questões'}`);
        continue;
      }
      const r = aplicarApoio(bruto, rec.trechos, rec.nomes);
      const id = novoId();
      db.prepare(
        `INSERT INTO listas_questoes
          (id, bloco_id, topico_id, titulo, enunciado, gabarito, origem, status, quantidade, contexto, criado_em,
           origem_paginas)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id,
        entregavel.bloco_id,
        topico.id,
        `Teste teórico — ${topico.titulo}`,
        JSON.stringify(r.questoes),
        JSON.stringify(r.gabarito),
        'gerada_fontes',
        'nao_feita',
        r.questoes.length,
        'projeto',
        agora(),
        JSON.stringify(r.origem_paginas)
      );
      // Procedencia: os documentos de onde o teste saiu.
      const inserirUso = db.prepare(
        "INSERT INTO documento_usos (id, documento_id, item_tipo, item_id, criado_em) VALUES (?,?,'lista_questoes',?,?)"
      );
      for (const o of r.origem_paginas) inserirUso.run(novoId(), o.documento_id, id, agora());
      gerados.push(db.prepare(`${SQL_LISTAS} WHERE l.id = ?`).get(id));
    }

    res.json({
      ok: true,
      testes_gerados: gerados,
      erro: problemas.length ? `Alguns testes não foram gerados — ${problemas.join('; ')}` : null,
    });
  })
);

app.delete(
  '/api/entregaveis/:id',
  rota((req, res) => {
    db.prepare('DELETE FROM entregaveis WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

app.post(
  '/api/ia/sugerir-entregaveis',
  rota(async (req, res) => {
    const { bloco_id, descricao } = req.body ?? {};
    const topicos = db.prepare('SELECT id, titulo FROM topicos WHERE bloco_id = ? ORDER BY ordem').all(bloco_id);
    const r = await sugerirEntregaveis(descricao, topicos);

    // Devolve os ids dos topicos para que o cartao de proposta ja venha ligado.
    const porTitulo = new Map(topicos.map((t) => [t.titulo.toLowerCase(), t.id]));
    res.json({
      ...r,
      entregaveis: r.entregaveis.map((e) => ({
        ...e,
        topico_ids: e.topicos.map((t) => porTitulo.get(t.toLowerCase())).filter(Boolean),
      })),
    });
  })
);

// ===========================================================================
// AVALIACOES (wrapper academico)
// A nota e um dado academico informado pelo usuario. A plataforma nunca
// atribui, infere ou gera nota — apenas guarda e faz a aritmetica pedida.
// ===========================================================================
app.get(
  '/api/blocos/:id/avaliacoes',
  rota((req, res) => {
    res.json(
      db
        .prepare('SELECT * FROM avaliacoes WHERE bloco_id = ? ORDER BY ordem, rowid')
        .all(req.params.id)
    );
  })
);

// Sincroniza a tabela inteira: a interface e uma grade editavel.
app.put(
  '/api/blocos/:id/avaliacoes',
  rota((req, res) => {
    const blocoId = req.params.id;
    if (!db.prepare('SELECT id FROM blocos WHERE id = ?').get(blocoId)) {
      return res.status(404).json({ erro: 'Bloco não encontrado.' });
    }

    const recebidas = Array.isArray(req.body?.avaliacoes) ? req.body.avaliacoes : [];
    const ids = new Set(recebidas.map((a) => a.id));

    const numero = (v) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const sincronizar = db.transaction(() => {
      for (const { id } of db.prepare('SELECT id FROM avaliacoes WHERE bloco_id = ?').all(blocoId)) {
        if (!ids.has(id)) db.prepare('DELETE FROM avaliacoes WHERE id = ?').run(id);
      }
      const anteriores = new Map(
        db.prepare('SELECT id, nota, concluido_em, feita, realizada FROM avaliacoes WHERE bloco_id = ?')
          .all(blocoId)
          .map((a) => [a.id, a])
      );
      const upsert = db.prepare(
        `INSERT INTO avaliacoes
           (id, bloco_id, titulo, peso, nota, ordem, data, observacao, criado_em,
            data_prevista, tempo_estimado_min, origem_estimativa, tipo_tarefa, concluido_em,
            feita, realizada)
         VALUES (@id, @bloco_id, @titulo, @peso, @nota, @ordem, NULL, NULL, @criado_em,
            @data_prevista, @tempo_estimado_min, @origem_estimativa, @tipo_tarefa, @concluido_em,
            @feita, @realizada)
         ON CONFLICT(id) DO UPDATE SET
           titulo = excluded.titulo,
           peso = excluded.peso,
           nota = excluded.nota,
           ordem = excluded.ordem,
           data_prevista = excluded.data_prevista,
           tempo_estimado_min = excluded.tempo_estimado_min,
           origem_estimativa = excluded.origem_estimativa,
           tipo_tarefa = excluded.tipo_tarefa,
           concluido_em = excluded.concluido_em,
           feita = excluded.feita,
           realizada = excluded.realizada`
      );
      recebidas.forEach((a, i) => {
        const nota = numero(a.nota);
        const antes = anteriores.get(a.id);
        // "Feita" e a nota sao coisas diferentes: quem prestou a prova ja a fez,
        // mesmo sem resultado. Qualquer uma das duas conclui a avaliacao, e a
        // data da primeira e o que permite medir o tempo real na calibracao.
        const feita = a.feita === undefined ? (antes?.feita ?? 0) : a.feita ? 1 : 0;
        // A nota ja e a confirmacao de que a avaliacao aconteceu: preenche-la
        // liga "realizada" sozinha. Apagar a nota nao desmarca.
        const realizada =
          nota !== null ? 1 : a.realizada === undefined ? (antes?.realizada ?? 0) : a.realizada ? 1 : 0;
        const concluida = nota !== null || feita === 1 || realizada === 1;
        const concluidoEm = concluida ? (antes?.concluido_em ?? agora()) : null;

        upsert.run({
          id: a.id || novoId(),
          bloco_id: blocoId,
          titulo: String(a.titulo || '').trim() || 'Avaliação',
          peso: numero(a.peso),
          nota,
          ordem: i,
          criado_em: agora(),
          data_prevista: a.data_prevista || null,
          tempo_estimado_min: numero(a.tempo_estimado_min),
          origem_estimativa: a.origem_estimativa || null,
          tipo_tarefa: a.tipo_tarefa?.trim() || null,
          concluido_em: concluidoEm,
          feita,
          realizada,
        });
      });
    });
    sincronizar();

    res.json(db.prepare('SELECT * FROM avaliacoes WHERE bloco_id = ? ORDER BY ordem, rowid').all(blocoId));
  })
);

// Reagendar e concluir uma avaliacao a partir do cronograma.
// Reagendar nunca conta como atraso. Concluir marca "feita" e nao inventa nota:
// a nota continua sendo dado academico informado no painel Academico.
app.patch(
  '/api/avaliacoes/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM avaliacoes WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    const b = req.body ?? {};

    const feita = b.feita === undefined ? atual.feita : b.feita ? 1 : 0;
    // "Realizada" diz que a prova foi feita e a nota ainda nao saiu. Com nota,
    // e sempre 1: a nota ja confirma que aconteceu.
    const realizada =
      atual.nota !== null ? 1 : b.realizada === undefined ? atual.realizada : b.realizada ? 1 : 0;
    const concluida = atual.nota !== null || feita === 1 || realizada === 1;
    const concluidoEm = concluida ? (atual.concluido_em ?? agora()) : null;

    db.prepare(
      'UPDATE avaliacoes SET data_prevista = ?, feita = ?, realizada = ?, concluido_em = ? WHERE id = ?'
    ).run(
      b.data_prevista === undefined ? atual.data_prevista : b.data_prevista || null,
      feita,
      realizada,
      concluidoEm,
      atual.id
    );
    res.json(db.prepare('SELECT * FROM avaliacoes WHERE id = ?').get(atual.id));
  })
);

// ===========================================================================
// SESSOES DE FOCO
// Registro voluntario de tempo. Nao ha bloqueio de sites, abas ou aplicativos,
// nem meta, streak ou comparacao entre dias.
// ===========================================================================
app.get(
  '/api/foco/ativa',
  rota((_req, res) => {
    const sessao = db
      .prepare(
        `SELECT s.*, b.nome AS bloco_nome FROM sessoes_foco s
           LEFT JOIN blocos b ON b.id = s.bloco_id
          WHERE s.fim IS NULL ORDER BY s.inicio DESC LIMIT 1`
      )
      .get();
    res.json(sessao ?? null);
  })
);

app.post(
  '/api/foco/iniciar',
  rota((req, res) => {
    // Uma sessao por vez: qualquer sessao aberta e encerrada antes de abrir outra.
    db.prepare('UPDATE sessoes_foco SET fim = ? WHERE fim IS NULL').run(agora());

    const id = novoId();
    const blocoId = req.body?.bloco_id || null;
    db.prepare('INSERT INTO sessoes_foco (id, bloco_id, inicio, fim) VALUES (?,?,?,NULL)').run(
      id,
      blocoId,
      agora()
    );
    res.status(201).json(
      db
        .prepare(
          `SELECT s.*, b.nome AS bloco_nome FROM sessoes_foco s
             LEFT JOIN blocos b ON b.id = s.bloco_id WHERE s.id = ?`
        )
        .get(id)
    );
  })
);

app.post(
  '/api/foco/:id/encerrar',
  rota((req, res) => {
    const sessao = db.prepare('SELECT * FROM sessoes_foco WHERE id = ?').get(req.params.id);
    if (!sessao) return res.status(404).json({ erro: 'Sessão não encontrada.' });

    const fim = sessao.fim ?? agora();
    db.prepare('UPDATE sessoes_foco SET fim = ? WHERE id = ?').run(fim, sessao.id);

    const decorridoMs = Math.max(0, new Date(fim).getTime() - new Date(sessao.inicio).getTime());
    res.json({ ...sessao, fim, decorrido_ms: decorridoMs });
  })
);

// ===========================================================================
// COMPROMISSOS DIARIOS
// Itens nao concluidos de dias anteriores nao sao movidos nem cobrados:
// cada dia guarda apenas os seus proprios registros.
// ===========================================================================
app.get(
  '/api/compromissos',
  rota((req, res) => {
    const data = String(req.query.data || hojeISO()).slice(0, 10);
    res.json(
      db.prepare('SELECT * FROM compromissos_diarios WHERE data = ? ORDER BY rowid').all(data)
    );
  })
);

/** Datas que ja tem algum compromisso, para a consulta a dias anteriores. */
app.get(
  '/api/compromissos/datas',
  rota((_req, res) => {
    res.json(
      db
        .prepare('SELECT DISTINCT data FROM compromissos_diarios ORDER BY data DESC LIMIT 60')
        .all()
        .map((l) => l.data)
    );
  })
);

app.post(
  '/api/compromissos',
  rota((req, res) => {
    const descricao = String(req.body?.descricao ?? '').trim();
    if (!descricao) return res.status(400).json({ erro: 'Escreva o compromisso.' });
    const data = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.data ?? '') ? req.body.data : hojeISO();

    const id = novoId();
    db.prepare(
      'INSERT INTO compromissos_diarios (id, data, descricao, concluido) VALUES (?,?,?,0)'
    ).run(id, data, descricao);
    res.status(201).json(db.prepare('SELECT * FROM compromissos_diarios WHERE id = ?').get(id));
  })
);

app.patch(
  '/api/compromissos/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM compromissos_diarios WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Compromisso não encontrado.' });
    const b = req.body ?? {};

    db.prepare('UPDATE compromissos_diarios SET descricao = ?, concluido = ? WHERE id = ?').run(
      b.descricao === undefined ? atual.descricao : String(b.descricao).trim() || atual.descricao,
      b.concluido === undefined ? atual.concluido : bool(b.concluido),
      atual.id
    );
    res.json(db.prepare('SELECT * FROM compromissos_diarios WHERE id = ?').get(atual.id));
  })
);

app.delete(
  '/api/compromissos/:id',
  rota((req, res) => {
    db.prepare('DELETE FROM compromissos_diarios WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

// ===========================================================================
// CONFIG — preferencias simples da plataforma
// ===========================================================================
const CONFIG_PADRAO = { orcamento_diario_min: '240' };

function lerConfig() {
  const linhas = db.prepare('SELECT chave, valor FROM config').all();
  return { ...CONFIG_PADRAO, ...Object.fromEntries(linhas.map((l) => [l.chave, l.valor])) };
}

app.get(
  '/api/config',
  rota((_req, res) => res.json(lerConfig()))
);

app.patch(
  '/api/config',
  rota((req, res) => {
    const gravar = db.prepare(
      'INSERT INTO config (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
    );
    const tx = db.transaction(() => {
      for (const [chave, valor] of Object.entries(req.body ?? {})) {
        if (typeof chave === 'string' && chave) gravar.run(chave, String(valor));
      }
    });
    tx();
    res.json(lerConfig());
  })
);

// ===========================================================================
// TIPOS DE TAREFA — autocomplete a partir do que o usuario ja usou
// Evita que cada item vire um tipo novo por variacao de escrita.
// ===========================================================================
app.get(
  '/api/tipos-tarefa',
  rota((_req, res) => {
    const linhas = db
      .prepare(
        `SELECT tipo_tarefa AS tipo, COUNT(*) AS usos FROM (
           SELECT tipo_tarefa FROM entregaveis WHERE tipo_tarefa IS NOT NULL AND TRIM(tipo_tarefa) <> ''
           UNION ALL
           SELECT tipo_tarefa FROM listas_questoes WHERE tipo_tarefa IS NOT NULL AND TRIM(tipo_tarefa) <> ''
           UNION ALL
           SELECT tipo_tarefa FROM avaliacoes WHERE tipo_tarefa IS NOT NULL AND TRIM(tipo_tarefa) <> ''
         ) GROUP BY tipo_tarefa ORDER BY usos DESC, tipo_tarefa`
      )
      .all();
    res.json(linhas.map((l) => l.tipo));
  })
);

// ===========================================================================
// IA — estimativa de tempo
// ===========================================================================
app.post(
  '/api/ia/estimar-tempo',
  rota(async (req, res) => {
    const { descricao, tipo, contexto } = req.body ?? {};
    res.json(await estimarTempoTarefa(descricao, tipo, contexto));
  })
);

// ===========================================================================
// AJUSTES MANUAIS DE PRIORIDADE
// Guardam a intencao do usuario; a fila e remontada com eles aplicados.
// ===========================================================================
const DIRECOES = new Set(['promover', 'rebaixar']);

app.put(
  '/api/ajustes-prioridade',
  rota((req, res) => {
    const { item_tipo, item_id, direcao, magnitude } = req.body ?? {};
    if (!item_tipo || !item_id) return res.status(400).json({ erro: 'Item inválido.' });
    if (!DIRECOES.has(direcao)) return res.status(400).json({ erro: 'Direção inválida.' });

    db.prepare('DELETE FROM ajustes_prioridade WHERE item_tipo = ? AND item_id = ?').run(item_tipo, item_id);
    const id = novoId();
    db.prepare(
      'INSERT INTO ajustes_prioridade (id, item_tipo, item_id, direcao, magnitude, criado_em) VALUES (?,?,?,?,?,?)'
    ).run(id, item_tipo, item_id, direcao, Math.max(0, Number(magnitude) || 0), agora());
    res.json(db.prepare('SELECT * FROM ajustes_prioridade WHERE id = ?').get(id));
  })
);

app.delete(
  '/api/ajustes-prioridade/:tipo/:id',
  rota((req, res) => {
    db.prepare('DELETE FROM ajustes_prioridade WHERE item_tipo = ? AND item_id = ?').run(
      req.params.tipo,
      req.params.id
    );
    res.json({ ok: true });
  })
);

// ===========================================================================
// CRONOGRAMA — dados crus para a pipeline do cliente
// O calculo de prioridade mora em client/src/lib/cronograma.ts; aqui so se
// reune o que ele precisa, numa unica ida ao servidor.
// ===========================================================================
app.get(
  '/api/cronograma',
  rota((_req, res) => {
    const entregaveis = db
      .prepare(
        `SELECT e.id, e.bloco_id, b.nome AS bloco_nome, e.titulo, e.data_entrega,
                e.tempo_estimado_horas, e.concluido, e.tipo_tarefa, e.origem_estimativa, e.criado_em
           FROM entregaveis e JOIN blocos b ON b.id = e.bloco_id`
      )
      .all();

    const listas = db
      .prepare(
        `SELECT l.id, l.bloco_id, b.nome AS bloco_nome, l.titulo, l.data_prevista,
                l.tempo_estimado_min, l.status, l.contexto, l.tipo_tarefa, l.origem_estimativa, l.criado_em
           FROM listas_questoes l JOIN blocos b ON b.id = l.bloco_id`
      )
      .all();

    const avaliacoes = db
      .prepare(
        `SELECT a.id, a.bloco_id, b.nome AS bloco_nome, a.titulo, a.data_prevista,
                a.tempo_estimado_min, a.nota, a.feita, a.realizada, a.tipo_tarefa,
                a.origem_estimativa, a.criado_em
           FROM avaliacoes a JOIN blocos b ON b.id = a.bloco_id`
      )
      .all();

    const revisoes = db
      .prepare(
        `SELECT r.id, r.numero, r.data_prevista, r.status, r.topico_id,
                t.titulo AS topico_titulo, t.peso AS topico_peso,
                t.bloco_id, b.nome AS bloco_nome
           FROM revisoes r
           JOIN topicos t ON t.id = r.topico_id
           JOIN blocos b ON b.id = t.bloco_id
          WHERE r.status != 'concluida'`
      )
      .all();

    // Historico da calibracao: so itens concluidos cuja estimativa veio do
    // proprio usuario ('faixa' ou 'exata'). Estimativa da IA nao entra, porque
    // mediria o erro do modelo e nao o de quem estuda.
    const historico = db
      .prepare(
        `SELECT tipo_tarefa, tempo_estimado_min, criado_em, concluido_em FROM (
           SELECT tipo_tarefa, CAST(tempo_estimado_horas * 60 AS INTEGER) AS tempo_estimado_min,
                  criado_em, concluido_em, origem_estimativa
             FROM entregaveis
            WHERE concluido = 1 AND concluido_em IS NOT NULL AND tempo_estimado_horas IS NOT NULL
           UNION ALL
           SELECT tipo_tarefa, tempo_estimado_min, criado_em, concluido_em, origem_estimativa
             FROM listas_questoes
            WHERE status = 'completa' AND concluido_em IS NOT NULL AND tempo_estimado_min IS NOT NULL
           UNION ALL
           SELECT tipo_tarefa, tempo_estimado_min, criado_em, concluido_em, origem_estimativa
             FROM avaliacoes
            WHERE concluido_em IS NOT NULL AND tempo_estimado_min IS NOT NULL
         ) WHERE origem_estimativa IN ('faixa','exata')`
      )
      .all();

    res.json({
      hoje: hojeISO(),
      config: lerConfig(),
      entregaveis,
      listas,
      avaliacoes,
      revisoes,
      historico,
      ajustes: db.prepare('SELECT * FROM ajustes_prioridade').all(),
      // Quais atividades realizam cada avaliacao: e o que evita contar o mesmo
      // trabalho duas vezes na fila.
      vinculos: db.prepare('SELECT * FROM avaliacao_itens').all(),
    });
  })
);

// ===========================================================================
// CALENDARIO
// Cinco origens num payload so. O calendario e uma leitura do que ja existe:
// nada aqui cria um segundo registro para o mesmo objetivo de estudo.
// ===========================================================================
const TIPOS_EVENTO = new Set(['prova', 'aula', 'entrega', 'outro']);

/** A que avaliacao um item pertence, para o calendario mostrar o vinculo. */
function avaliacaoDoItem(tipo, id) {
  return (
    db
      .prepare(
        `SELECT a.id, a.titulo FROM avaliacao_itens v
           JOIN avaliacoes a ON a.id = v.avaliacao_id
          WHERE v.item_tipo = ? AND v.item_id = ?`
      )
      .get(tipo, id) ?? null
  );
}

/** Uma prova de disciplina e a avaliacao do bloco, nunca um evento a parte. */
function ehProvaDeDisciplina(tipo, blocoId) {
  if (tipo !== 'prova' || !blocoId) return false;
  const b = db.prepare('SELECT wrapper_academico FROM blocos WHERE id = ?').get(blocoId);
  return Boolean(b && b.wrapper_academico === 1);
}

app.get(
  '/api/calendario',
  rota((req, res) => {
    // Sem intervalo, devolve tudo: o volume de um usuario unico e pequeno e a
    // navegacao entre meses fica instantanea.
    const de = String(req.query.de || '0000-01-01');
    const ate = String(req.query.ate || '9999-12-31');
    const faixa = [de, ate];

    const itens = [];

    for (const e of db
      .prepare(
        `SELECT e.*, b.nome AS bloco_nome FROM eventos e
           LEFT JOIN blocos b ON b.id = e.bloco_id
          WHERE e.data_inicio IS NOT NULL AND e.data_inicio BETWEEN ? AND ?`
      )
      .all(...faixa)) {
      itens.push({
        tipo: 'evento',
        id: e.id,
        titulo: e.titulo,
        data: e.data_inicio,
        bloco_id: e.bloco_id,
        bloco_nome: e.bloco_nome,
        concluido: 0,
        detalhe: { tipo_evento: e.tipo, data_fim: e.data_fim, observacao: e.observacao },
      });
    }

    for (const a of db
      .prepare(
        `SELECT a.*, b.nome AS bloco_nome FROM avaliacoes a
           JOIN blocos b ON b.id = a.bloco_id
          WHERE a.data_prevista IS NOT NULL AND a.data_prevista BETWEEN ? AND ?`
      )
      .all(...faixa)) {
      itens.push({
        tipo: 'avaliacao',
        id: a.id,
        titulo: a.titulo,
        data: a.data_prevista,
        bloco_id: a.bloco_id,
        bloco_nome: a.bloco_nome,
        concluido: a.nota !== null || a.feita === 1 || a.realizada === 1 ? 1 : 0,
        detalhe: {
          nota: a.nota,
          feita: a.feita,
          realizada: a.realizada,
          // Itens que realizam esta avaliação, para o destaque no calendário.
          itens_vinculados: db
            .prepare('SELECT item_tipo, item_id FROM avaliacao_itens WHERE avaliacao_id = ?')
            .all(a.id),
          peso: a.peso,
          tempo_estimado_min: a.tempo_estimado_min,
          origem_estimativa: a.origem_estimativa,
          tipo_tarefa: a.tipo_tarefa,
        },
      });
    }

    for (const e of db
      .prepare(
        `SELECT e.*, b.nome AS bloco_nome FROM entregaveis e
           JOIN blocos b ON b.id = e.bloco_id
          WHERE e.data_entrega IS NOT NULL AND e.data_entrega BETWEEN ? AND ?`
      )
      .all(...faixa)) {
      itens.push({
        tipo: 'entregavel',
        id: e.id,
        titulo: e.titulo,
        data: e.data_entrega,
        bloco_id: e.bloco_id,
        bloco_nome: e.bloco_nome,
        concluido: e.concluido === 1 ? 1 : 0,
        detalhe: {
          descricao: e.descricao,
          tempo_estimado_horas: e.tempo_estimado_horas,
          avaliacao: avaliacaoDoItem('entregavel', e.id),
        },
      });
    }

    for (const l of db
      .prepare(
        `SELECT l.*, b.nome AS bloco_nome FROM listas_questoes l
           JOIN blocos b ON b.id = l.bloco_id
          WHERE l.data_prevista IS NOT NULL AND l.data_prevista BETWEEN ? AND ?`
      )
      .all(...faixa)) {
      itens.push({
        tipo: 'lista',
        id: l.id,
        titulo: l.titulo,
        data: l.data_prevista,
        bloco_id: l.bloco_id,
        bloco_nome: l.bloco_nome,
        concluido: l.status === 'completa' ? 1 : 0,
        detalhe: {
          status: l.status,
          contexto: l.contexto,
          tempo_estimado_min: l.tempo_estimado_min,
          avaliacao: avaliacaoDoItem('lista_questoes', l.id),
        },
      });
    }

    for (const r of db
      .prepare(
        `SELECT r.*, t.titulo AS topico_titulo, t.bloco_id, b.nome AS bloco_nome
           FROM revisoes r
           JOIN topicos t ON t.id = r.topico_id
           JOIN blocos b ON b.id = t.bloco_id
          WHERE r.data_prevista IS NOT NULL AND r.data_prevista BETWEEN ? AND ?`
      )
      .all(...faixa)) {
      itens.push({
        tipo: 'revisao',
        id: r.id,
        titulo: r.topico_titulo,
        data: r.data_prevista,
        bloco_id: r.bloco_id,
        bloco_nome: r.bloco_nome,
        concluido: r.status === 'concluida' ? 1 : 0,
        detalhe: { numero: r.numero, status: r.status, topico_id: r.topico_id },
      });
    }

    itens.sort((a, b) => a.data.localeCompare(b.data) || a.titulo.localeCompare(b.titulo, 'pt-BR'));
    res.json({ hoje: hojeISO(), itens });
  })
);

// ===========================================================================
// EVENTOS
// ===========================================================================
app.post(
  '/api/eventos',
  rota((req, res) => {
    const b = req.body ?? {};
    const titulo = String(b.titulo || '').trim();
    if (!titulo) return res.status(400).json({ erro: 'Informe o nome.' });
    const tipo = TIPOS_EVENTO.has(b.tipo) ? b.tipo : 'outro';
    const blocoId = b.bloco_id || null;

    // Prova de disciplina nasce como avaliacao do bloco: um registro so, que
    // aparece no wrapper, no calendario e no cronograma.
    if (ehProvaDeDisciplina(tipo, blocoId)) {
      const id = novoId();
      const ordem = db
        .prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM avaliacoes WHERE bloco_id = ?')
        .get(blocoId).proxima;
      const numero = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      db.prepare(
        `INSERT INTO avaliacoes
           (id, bloco_id, titulo, peso, nota, ordem, data, observacao, criado_em,
            data_prevista, tempo_estimado_min, origem_estimativa, tipo_tarefa, concluido_em, feita)
         VALUES (?,?,?,?,NULL,?,NULL,?,?,?,?,?,?,NULL,0)`
      ).run(
        id,
        blocoId,
        titulo,
        numero(b.peso),
        ordem,
        b.observacao?.trim() || null,
        agora(),
        b.data_inicio || null,
        numero(b.tempo_estimado_min),
        b.origem_estimativa || null,
        b.tipo_tarefa?.trim() || 'prova'
      );
      return res.status(201).json({
        criado: 'avaliacao',
        avaliacao: db.prepare('SELECT * FROM avaliacoes WHERE id = ?').get(id),
      });
    }

    const id = novoId();
    db.prepare(
      'INSERT INTO eventos (id, bloco_id, titulo, tipo, data_inicio, data_fim, observacao, criado_em) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      id,
      blocoId,
      titulo,
      tipo,
      b.data_inicio || null,
      b.data_fim || null,
      b.observacao?.trim() || null,
      agora()
    );
    res.status(201).json({
      criado: 'evento',
      evento: db.prepare('SELECT * FROM eventos WHERE id = ?').get(id),
    });
  })
);

app.patch(
  '/api/eventos/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM eventos WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Evento não encontrado.' });
    const b = req.body ?? {};
    // Reagendar e so mover a data. Nunca conta como atraso.
    db.prepare(
      'UPDATE eventos SET titulo = ?, tipo = ?, data_inicio = ?, data_fim = ?, observacao = ? WHERE id = ?'
    ).run(
      b.titulo === undefined ? atual.titulo : String(b.titulo).trim() || atual.titulo,
      b.tipo !== undefined && TIPOS_EVENTO.has(b.tipo) ? b.tipo : atual.tipo,
      b.data_inicio === undefined ? atual.data_inicio : b.data_inicio || null,
      b.data_fim === undefined ? atual.data_fim : b.data_fim || null,
      b.observacao === undefined ? atual.observacao : b.observacao?.trim() || null,
      atual.id
    );
    res.json(db.prepare('SELECT * FROM eventos WHERE id = ?').get(atual.id));
  })
);

app.delete(
  '/api/eventos/:id',
  rota((req, res) => {
    db.prepare('DELETE FROM eventos WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  })
);

// ===========================================================================
// DESEMPENHO
// Dados crus para a pagina de desempenho. A agregacao mora em
// client/src/lib/desempenho.ts; aqui so se reune o que ela precisa.
//
// Evidencias de aprendizagem NAO entram: sao log qualitativo e nunca viram
// metrica. Revisoes entram apenas como contagem de organizacao, nunca no
// grafico de cumprimento do plano.
// ===========================================================================
app.get(
  '/api/desempenho',
  rota((_req, res) => {
    const blocos = db
      .prepare(
        `SELECT id, nome, wrapper_academico, limite_faltas, faltas_registradas,
                media_aprovacao, formula_media, usar_formula
           FROM blocos ORDER BY nome`
      )
      .all();

    // Itens concluidos que tinham data. "data_vigente" e a data ATUAL do item,
    // ja com qualquer reagendamento aplicado: e por isso que reagendar nunca
    // aparece como atraso.
    const metas = db
      .prepare(
        `SELECT 'avaliacao' AS tipo, id, bloco_id, titulo, data_prevista AS data_vigente, concluido_em
           FROM avaliacoes
          WHERE concluido_em IS NOT NULL AND data_prevista IS NOT NULL
         UNION ALL
         SELECT 'entregavel' AS tipo, id, bloco_id, titulo, data_entrega AS data_vigente, concluido_em
           FROM entregaveis
          WHERE concluido = 1 AND concluido_em IS NOT NULL AND data_entrega IS NOT NULL
         UNION ALL
         SELECT 'lista' AS tipo, id, bloco_id, titulo, data_prevista AS data_vigente, concluido_em
           FROM listas_questoes
          WHERE status = 'completa' AND concluido_em IS NOT NULL AND data_prevista IS NOT NULL`
      )
      .all();

    // Notas sao dado academico informado pelo usuario: a plataforma exibe, nunca gera.
    const avaliacoes = db
      .prepare('SELECT id, bloco_id, titulo, peso, nota FROM avaliacoes ORDER BY bloco_id, ordem, rowid')
      .all();

    // Mesmo filtro da calibracao: so estimativa do proprio usuario.
    const calibracao = db
      .prepare(
        `SELECT bloco_id, tipo_tarefa, tempo_estimado_min, criado_em, concluido_em FROM (
           SELECT bloco_id, tipo_tarefa, CAST(tempo_estimado_horas * 60 AS INTEGER) AS tempo_estimado_min,
                  criado_em, concluido_em, origem_estimativa
             FROM entregaveis
            WHERE concluido = 1 AND concluido_em IS NOT NULL AND tempo_estimado_horas IS NOT NULL
           UNION ALL
           SELECT bloco_id, tipo_tarefa, tempo_estimado_min, criado_em, concluido_em, origem_estimativa
             FROM listas_questoes
            WHERE status = 'completa' AND concluido_em IS NOT NULL AND tempo_estimado_min IS NOT NULL
           UNION ALL
           SELECT bloco_id, tipo_tarefa, tempo_estimado_min, criado_em, concluido_em, origem_estimativa
             FROM avaliacoes
            WHERE concluido_em IS NOT NULL AND tempo_estimado_min IS NOT NULL
         ) WHERE origem_estimativa IN ('faixa','exata')`
      )
      .all();

    // So o acumulado. Nenhuma serie temporal, nenhuma comparacao entre periodos.
    const foco = db
      .prepare('SELECT bloco_id, inicio, fim FROM sessoes_foco WHERE fim IS NOT NULL')
      .all();

    const revisoes = db
      .prepare(
        `SELECT r.id, r.status, r.data_prevista, t.bloco_id
           FROM revisoes r JOIN topicos t ON t.id = r.topico_id`
      )
      .all();

    res.json({ hoje: hojeISO(), blocos, metas, avaliacoes, calibracao, foco, revisoes });
  })
);

// ===========================================================================
// FUSAO
// Um bloco RESULTADO e a fusao de DUAS OU MAIS ORIGENS. As arestas 'fusao_com'
// vao sempre da origem para o resultado, e o conjunto de arestas que aponta
// para o mesmo resultado E a fusao — por isso um bloco e resultado de no
// maximo uma fusao, por construcao.
// ===========================================================================
const todasAsArestas = () => db.prepare('SELECT * FROM bloco_relacoes').all();

const nomeDoBloco = (id) => db.prepare('SELECT nome FROM blocos WHERE id = ?').get(id)?.nome ?? '';

app.get(
  '/api/blocos/:id/fusao',
  rota((req, res) => {
    const id = req.params.id;
    const fusoes = fusoesPorResultado(todasAsArestas());
    const comNome = (blocoId) => ({ id: blocoId, nome: nomeDoBloco(blocoId) });

    // Este bloco e resultado de uma fusao?
    const origens = fusoes.get(id) ?? null;

    // Este bloco e origem de quais fusoes?
    const comoOrigem = [];
    for (const [resultado, lista] of fusoes) {
      if (resultado === id || !lista.includes(id)) continue;
      comoOrigem.push({
        resultado: comNome(resultado),
        outras: lista.filter((o) => o !== id).map(comNome),
      });
    }

    res.json({
      resultado: origens ? { origens: origens.map(comNome) } : null,
      comoOrigem,
    });
  })
);

app.put(
  '/api/blocos/:id/fusao',
  rota((req, res) => {
    const resultado = req.params.id;
    if (!db.prepare('SELECT id FROM blocos WHERE id = ?').get(resultado)) {
      return res.status(404).json({ erro: 'Bloco não encontrado.' });
    }

    const pedidas = Array.isArray(req.body?.origens) ? req.body.origens : [];
    const origens = [...new Set(pedidas.filter((o) => typeof o === 'string' && o))];

    // Um bloco nao pode ser origem da fusao que resulta nele mesmo.
    if (origens.includes(resultado)) {
      return res
        .status(400)
        .json({ erro: 'Um bloco não pode ser origem da fusão que resulta nele mesmo.' });
    }
    if (origens.length < MIN_ORIGENS_FUSAO) {
      return res
        .status(400)
        .json({ erro: `Uma fusão precisa de pelo menos ${MIN_ORIGENS_FUSAO} blocos de origem.` });
    }
    const existentes = db
      .prepare(`SELECT id FROM blocos WHERE id IN (${origens.map(() => '?').join(',')})`)
      .all(...origens);
    if (existentes.length !== origens.length) {
      return res.status(400).json({ erro: 'Algum bloco de origem não existe mais.' });
    }

    // Substitui a fusao inteira: o conjunto de origens e o que define a fusao.
    const apagar = db.prepare(
      "DELETE FROM bloco_relacoes WHERE tipo = 'fusao_com' AND bloco_destino_id = ?"
    );
    const inserir = db.prepare(
      "INSERT INTO bloco_relacoes (id, bloco_origem_id, bloco_destino_id, tipo, migrada) VALUES (?,?,?,'fusao_com',1)"
    );
    db.transaction(() => {
      apagar.run(resultado);
      for (const o of origens) inserir.run(novoId(), o, resultado);
    })();

    res.json({ ok: true, origens: origens.length });
  })
);

app.delete(
  '/api/blocos/:id/fusao',
  rota((req, res) => {
    db.prepare("DELETE FROM bloco_relacoes WHERE tipo = 'fusao_com' AND bloco_destino_id = ?").run(
      req.params.id
    );
    res.json({ ok: true });
  })
);

// ===========================================================================
// GRAFO DOS BLOCOS
// ===========================================================================
app.get(
  '/api/grafo',
  rota((_req, res) => {
    const blocos = db
      .prepare(
        `SELECT id, nome, pasta_id, favorito, oculto, wrapper_academico, pos_x, pos_y, ultimo_acesso
           FROM blocos ORDER BY nome`
      )
      .all();
    res.json({ blocos, relacoes: todasAsArestas(), config: lerConfig() });
  })
);

/** Arrastar um no so move o bloco. Nunca cria nem altera relacao. */
app.patch(
  '/api/blocos/:id/posicao',
  rota((req, res) => {
    const { pos_x, pos_y } = req.body ?? {};
    const numero = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    db.prepare('UPDATE blocos SET pos_x = ?, pos_y = ? WHERE id = ?').run(
      numero(pos_x),
      numero(pos_y),
      req.params.id
    );
    res.json({ ok: true });
  })
);

/** Grava varias posicoes de uma vez: primeiro layout e "Reorganizar mapa". */
app.put(
  '/api/grafo/posicoes',
  rota((req, res) => {
    const posicoes = Array.isArray(req.body?.posicoes) ? req.body.posicoes : [];
    const gravar = db.prepare('UPDATE blocos SET pos_x = ?, pos_y = ? WHERE id = ?');
    db.transaction(() => {
      for (const p of posicoes) {
        if (!p?.id) continue;
        gravar.run(Number(p.pos_x) || 0, Number(p.pos_y) || 0, p.id);
      }
    })();
    res.json({ ok: true, gravadas: posicoes.length });
  })
);


// IA — extracao de eventos de um documento. A IA propoe; nada e gravado aqui:
// o cliente leva a lista para a tela de revisao, e so o que o usuario confirmar
// vira registro.
app.post(
  '/api/ia/extrair-eventos',
  rota(async (req, res) => {
    const { texto, inicio_periodo, bloco_id, incluir_aulas, documentos_ids } = req.body ?? {};
    const bloco = bloco_id ? db.prepare('SELECT nome FROM blocos WHERE id = ?').get(bloco_id) : null;
    // O texto pode vir colado ou dos documentos escolhidos no repositório.
    const conteudo =
      texto ||
      (bloco_id && documentos_ids?.length
        ? materialDoFluxo('importacao_calendario', bloco_id, documentos_ids).texto
        : texto);
    res.json(
      await extrairEventos(conteudo, {
        hoje: hojeISO(),
        inicio_periodo: inicio_periodo || null,
        bloco_nome: bloco?.nome ?? null,
        incluir_aulas: Boolean(incluir_aulas),
      })
    );
  })
);


// IA — decomposicao de um roteiro de projeto em entregaveis. Nada e gravado
// aqui: a proposta vai para a tela de revisao, e as datas sao calculadas pelo
// cliente, nunca pelo modelo.
app.post(
  '/api/ia/decompor-roteiro',
  rota(async (req, res) => {
    const { texto, bloco_id, inicio, fim, documentos_ids } = req.body ?? {};
    const conteudo =
      texto ||
      (bloco_id && documentos_ids?.length ? materialDoFluxo('roteiro_projeto', bloco_id, documentos_ids).texto : texto);
    const topicos = bloco_id
      ? db
          .prepare('SELECT id, titulo, natureza FROM topicos WHERE bloco_id = ? ORDER BY ordem, rowid')
          .all(bloco_id)
      : [];
    const tipos = db
      .prepare(
        `SELECT DISTINCT tipo_tarefa FROM (
           SELECT tipo_tarefa FROM entregaveis WHERE tipo_tarefa IS NOT NULL AND TRIM(tipo_tarefa) <> ''
           UNION ALL
           SELECT tipo_tarefa FROM listas_questoes WHERE tipo_tarefa IS NOT NULL AND TRIM(tipo_tarefa) <> ''
           UNION ALL
           SELECT tipo_tarefa FROM avaliacoes WHERE tipo_tarefa IS NOT NULL AND TRIM(tipo_tarefa) <> ''
         )`
      )
      .all()
      .map((l) => l.tipo_tarefa);

    res.json(
      await decomporRoteiro(conteudo, topicos, {
        hoje: hojeISO(),
        inicio: inicio || null,
        fim: fim || null,
        tipos_tarefa: tipos,
      })
    );
  })
);

// ===========================================================================
// REPOSITORIO DE DOCUMENTOS DO BLOCO
//
// Um documento existe uma unica vez por bloco: o hash decide. Excluir um
// documento nunca apaga o que foi gerado a partir dele — o conteudo gerado ja
// esta salvo no item, e so a referencia fica orfa.
// ===========================================================================
const CATEGORIAS = new Set([
  'ementa',
  'livro_apostila',
  'lista_exercicios',
  'prova_antiga',
  'roteiro_projeto',
  'calendario',
  'outro',
]);
const TIPOS_USO = new Set([
  'tabela_conteudos',
  'lista_questoes',
  'roteiro_projeto',
  'importacao_calendario',
]);

const categoriaValida = (c) => (CATEGORIAS.has(c) ? c : 'outro');

/** Nome de arquivo seguro: nunca sai da pasta do bloco. */
const nomeSeguro = (nome) =>
  String(nome || 'arquivo')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-80);

/** Acrescenta um sufixo de versao quando o usuario opta por manter os dois. */
function nomeComVersao(blocoId, nome) {
  const existentes = db
    .prepare('SELECT nome_arquivo FROM documentos_fonte WHERE bloco_id = ?')
    .all(blocoId)
    .map((d) => d.nome_arquivo);
  if (!existentes.includes(nome)) return nome;

  const ponto = nome.lastIndexOf('.');
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const ext = ponto > 0 ? nome.slice(ponto) : '';
  let n = 2;
  while (existentes.includes(`${base} (${n})${ext}`)) n += 1;
  return `${base} (${n})${ext}`;
}

// ---------------------------------------------------------------------------
// Envio de arquivos: multipart (multer), nunca base64 dentro de JSON.
// ---------------------------------------------------------------------------
/** Limite por arquivo. Livros inteiros cabem; ajuste aqui se precisar. */
const LIMITE_ARQUIVO_MB = 100;
const PASTA_ENVIOS = path.join(PASTA_ARQUIVOS, '_envios');
fs.mkdirSync(PASTA_ENVIOS, { recursive: true });

const envio = multer({
  storage: multer.diskStorage({
    destination: PASTA_ENVIOS,
    filename: (_req, _arquivo, cb) => cb(null, novoId()),
  }),
  limits: { fileSize: LIMITE_ARQUIVO_MB * 1024 * 1024, files: 1 },
});

/** Multer so entra quando o corpo e multipart; texto colado segue em JSON. */
const recebeArquivo = (req, res, next) =>
  req.is('multipart/form-data') ? envio.single('arquivo')(req, res, next) : next();

/** SHA-256 do arquivo, lido em partes: um livro de 100 MB nao vai inteiro para a memoria. */
function hashDoArquivo(caminho) {
  return new Promise((resolver, rejeitar) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(caminho)
      .on('data', (parte) => h.update(parte))
      .on('end', () => resolver(h.digest('hex')))
      .on('error', rejeitar);
  });
}

const apagarSeExistir = (caminho) => {
  try {
    if (caminho) fs.unlinkSync(caminho);
  } catch {
    /* ja nao estava la */
  }
};

/**
 * Colunas do documento que a interface usa. conteudo_texto fica de fora: um
 * livro inteiro nao precisa viajar a cada atualizacao de status.
 */
const COLUNAS_DOCUMENTO = `d.id, d.bloco_id, d.nome_arquivo, d.categoria, d.criado_em, d.hash,
  d.tamanho_bytes, d.tipo_mime, d.caminho_arquivo, LENGTH(d.conteudo_texto) AS caracteres,
  d.status, d.etapa, d.progresso_feito, d.progresso_total, d.motivo, d.indice, d.paginas,
  d.sumario IS NOT NULL AS tem_sumario,
  (SELECT COUNT(*) FROM documento_trechos t WHERE t.documento_id = d.id) AS trechos`;

const documentoParaCliente = (id) => {
  const d = db.prepare(`SELECT ${COLUNAS_DOCUMENTO} FROM documentos_fonte d WHERE d.id = ?`).get(id);
  return d
    ? { ...d, categoria: d.categoria ?? 'outro', status: d.status ?? 'pronto', tem_sumario: d.tem_sumario === 1, usos: [] }
    : null;
};

app.get(
  '/api/blocos/:id/documentos',
  rota((req, res) => {
    const docs = db
      .prepare(
        `SELECT ${COLUNAS_DOCUMENTO}
           FROM documentos_fonte d
          WHERE d.bloco_id = ? ORDER BY d.criado_em DESC, d.rowid DESC`
      )
      .all(req.params.id);

    const usos = db
      .prepare(
        `SELECT documento_id, item_tipo, COUNT(*) AS quantos
           FROM documento_usos GROUP BY documento_id, item_tipo`
      )
      .all();

    res.json(
      docs.map((d) => ({
        ...d,
        categoria: d.categoria ?? 'outro',
        status: d.status ?? 'pronto',
        tem_sumario: d.tem_sumario === 1,
        precisa_indexar: precisaIndexar(d),
        usos: usos
          .filter((u) => u.documento_id === d.id)
          .map((u) => ({ item_tipo: u.item_tipo, quantos: u.quantos })),
      }))
    );
  })
);

/**
 * Registra um documento no repositorio do bloco, com deduplicacao.
 *
 * O arquivo (quando ha) ja esta em disco, na pasta de envios. Aqui ele e
 * reaproveitado, recusado por conflito de nome ou movido para o lugar final.
 * O texto e extraido depois, pela fila de processamento: a resposta sai logo.
 */
async function registrarDocumento(blocoId, d) {
  const nome = String(d.nome ?? 'documento').trim() || 'documento';
  const hash = d.arquivo ? await hashDoArquivo(d.arquivo) : calcularHash(String(d.texto ?? ''));

  // 1. Mesmo conteudo ja no bloco: reaproveita, nao grava de novo.
  const igual = db.prepare('SELECT id FROM documentos_fonte WHERE bloco_id = ? AND hash = ?').get(blocoId, hash);
  if (igual) {
    apagarSeExistir(d.arquivo);
    return { ...documentoParaCliente(igual.id), reaproveitado: true };
  }

  // 2. Mesmo nome com conteudo diferente: quem decide e o usuario.
  const mesmoNome = db
    .prepare('SELECT * FROM documentos_fonte WHERE bloco_id = ? AND nome_arquivo = ?')
    .get(blocoId, nome);
  if (mesmoNome && d.resolucao !== 'substituir' && d.resolucao !== 'manter') {
    apagarSeExistir(d.arquivo);
    return {
      conflito: 'nome',
      nome_arquivo: nome,
      existente: { id: mesmoNome.id, nome_arquivo: mesmoNome.nome_arquivo, criado_em: mesmoNome.criado_em },
    };
  }

  let nomeFinal = nome;
  if (mesmoNome && d.resolucao === 'manter') nomeFinal = nomeComVersao(blocoId, nome);

  let caminho = null;
  if (d.arquivo) {
    const pasta = path.join(PASTA_ARQUIVOS, blocoId);
    fs.mkdirSync(pasta, { recursive: true });
    // O hash no nome evita colisao entre arquivos de nome igual.
    caminho = path.join(blocoId, `${hash.slice(0, 16)}-${nomeSeguro(nomeFinal)}`);
    fs.renameSync(d.arquivo, path.join(PASTA_ARQUIVOS, caminho));
  }

  const id = novoId();
  db.transaction(() => {
    if (mesmoNome && d.resolucao === 'substituir') {
      // O arquivo do anterior sai; seus trechos saem junto (ON DELETE CASCADE).
      if (mesmoNome.caminho_arquivo && mesmoNome.caminho_arquivo !== caminho) {
        apagarSeExistir(path.join(PASTA_ARQUIVOS, mesmoNome.caminho_arquivo));
      }
      db.prepare('DELETE FROM documentos_fonte WHERE id = ?').run(mesmoNome.id);
    }
    db.prepare(
      `INSERT INTO documentos_fonte
         (id, bloco_id, nome_arquivo, conteudo_texto, criado_em, hash, categoria,
          caminho_arquivo, tamanho_bytes, tipo_mime, status, extraido)
       VALUES (?,?,?,?,?,?,?,?,?,?,'processando',0)`
    ).run(
      id,
      blocoId,
      nomeFinal,
      d.arquivo ? '' : String(d.texto ?? ''),
      agora(),
      hash,
      categoriaValida(d.categoria),
      caminho,
      d.tamanho ?? String(d.texto ?? '').length,
      d.tipo_mime ?? null
    );
    // As referencias do anterior passam para o novo: o uso nao se perde.
    if (mesmoNome && d.resolucao === 'substituir') {
      db.prepare('UPDATE documento_usos SET documento_id = ? WHERE documento_id = ?').run(id, mesmoNome.id);
    }
  })();

  enfileirar(id);
  return { ...documentoParaCliente(id), reaproveitado: false };
}

/**
 * Envio para o repositorio.
 * - multipart/form-data: campo "arquivo", mais nome_arquivo, categoria e resolucao;
 * - JSON { documentos: [{ nome_arquivo, conteudo_texto, categoria, resolucao }] }
 *   para texto colado.
 * Responde assim que o arquivo e recebido; a extracao segue em segundo plano.
 */
app.post(
  '/api/blocos/:id/documentos',
  recebeArquivo,
  rota(async (req, res) => {
    const blocoId = req.params.id;
    if (!db.prepare('SELECT id FROM blocos WHERE id = ?').get(blocoId)) {
      apagarSeExistir(req.file?.path);
      return res.status(404).json({ erro: 'Bloco não encontrado.' });
    }

    if (req.file) {
      // O nome vem num campo proprio, em UTF-8; o do multipart chega em latin1.
      const nome =
        String(req.body?.nome_arquivo ?? '').trim() ||
        Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const resultado = await registrarDocumento(blocoId, {
        nome,
        arquivo: req.file.path,
        tamanho: req.file.size,
        tipo_mime: req.file.mimetype || null,
        categoria: req.body?.categoria,
        resolucao: req.body?.resolucao,
      });
      return res.status(201).json({ documentos: [resultado] });
    }

    const entrada = Array.isArray(req.body?.documentos) ? req.body.documentos : [];
    if (entrada.some((d) => d?.arquivo_base64)) {
      return res.status(400).json({
        erro: 'Arquivos são enviados como multipart/form-data, não em base64.',
        codigo: 'envio_base64',
      });
    }
    const resultados = [];
    for (const d of entrada) {
      resultados.push(
        await registrarDocumento(blocoId, {
          nome: d?.nome_arquivo,
          texto: d?.conteudo_texto,
          categoria: d?.categoria,
          resolucao: d?.resolucao,
          tipo_mime: d?.tipo_mime,
        })
      );
    }
    res.status(201).json({ documentos: resultados });
  })
);

/**
 * O que um fluxo enviaria ao modelo com esta selecao: tamanho real (nunca o
 * do documento bruto), teto e, se precisou reduzir, a linha que explica.
 * So informa — o tamanho nunca bloqueia nada.
 */
app.post(
  '/api/documentos/material',
  rota((req, res) => {
    const { bloco_id, fluxo, documentos_ids } = req.body ?? {};
    // Sem escolha, nada vai (na geracao, "sem escolha" significa "todos").
    if (!Array.isArray(documentos_ids) || documentos_ids.length === 0) {
      return res.json({ caracteres: 0, teto: null, reduzido: false, aviso: null, porTrechos: fluxo === 'lista_questoes' });
    }
    const { texto: _texto, ...resumo } = materialDoFluxo(fluxo, bloco_id, documentos_ids);
    res.json(resumo);
  })
);

/** Situacao de um documento, para acompanhar o processamento. */
app.get(
  '/api/documentos/:id',
  rota((req, res) => {
    const d = documentoParaCliente(req.params.id);
    if (!d) return res.status(404).json({ erro: 'Documento não encontrado.' });
    res.json(d);
  })
);

/**
 * "Indexar documentos": processa o que ainda nao tem trechos, o que falhou e,
 * com chave, o que ficou com embeddings incompletos — sem perder o que ja foi feito.
 */
app.post(
  '/api/blocos/:id/documentos/indexar',
  rota((req, res) => {
    res.json({ ok: true, na_fila: reindexarBloco(req.params.id) });
  })
);

app.patch(
  '/api/documentos/:id',
  rota((req, res) => {
    const atual = db.prepare('SELECT * FROM documentos_fonte WHERE id = ?').get(req.params.id);
    if (!atual) return res.status(404).json({ erro: 'Documento não encontrado.' });
    const b = req.body ?? {};
    db.prepare('UPDATE documentos_fonte SET nome_arquivo = ?, categoria = ? WHERE id = ?').run(
      b.nome_arquivo === undefined ? atual.nome_arquivo : String(b.nome_arquivo).trim() || atual.nome_arquivo,
      b.categoria === undefined ? atual.categoria : categoriaValida(b.categoria),
      atual.id
    );
    res.json(db.prepare('SELECT * FROM documentos_fonte WHERE id = ?').get(atual.id));
  })
);

app.delete(
  '/api/documentos/:id',
  rota((req, res) => {
    const doc = db.prepare('SELECT * FROM documentos_fonte WHERE id = ?').get(req.params.id);
    if (!doc) return res.json({ ok: true });

    if (doc.caminho_arquivo) {
      try {
        fs.unlinkSync(path.join(PASTA_ARQUIVOS, doc.caminho_arquivo));
      } catch {
        /* arquivo ja nao estava la */
      }
    }
    // As linhas de documento_usos ficam: o item gerado continua existindo, e a
    // referencia passa a aparecer como "documento removido".
    db.prepare('DELETE FROM documentos_fonte WHERE id = ?').run(doc.id);
    res.json({ ok: true });
  })
);

/** Baixa o arquivo original, quando existe. */
app.get(
  '/api/documentos/:id/arquivo',
  rota((req, res) => {
    const doc = db.prepare('SELECT * FROM documentos_fonte WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ erro: 'Documento não encontrado.' });

    if (!doc.caminho_arquivo) {
      // Texto colado nao tem arquivo: devolve o texto extraido.
      res.type('text/plain; charset=utf-8');
      return res.send(doc.conteudo_texto ?? '');
    }
    const completo = path.join(PASTA_ARQUIVOS, doc.caminho_arquivo);
    if (!fs.existsSync(completo)) {
      return res.status(404).json({ erro: 'O arquivo original não está mais disponível.' });
    }
    res.download(completo, doc.nome_arquivo);
  })
);

/**
 * Quais documentos originaram um item gerado.
 *
 * "item_id" e obrigatorio: a tabela de conteudos nao tem id proprio, entao usa
 * o id do bloco — sem isso, os usos de blocos diferentes se misturariam.
 */
app.post(
  '/api/documento-usos',
  rota((req, res) => {
    const { documentos_ids, item_tipo, item_id } = req.body ?? {};
    if (!TIPOS_USO.has(item_tipo)) return res.status(400).json({ erro: 'Tipo de uso inválido.' });
    if (!item_id) return res.status(400).json({ erro: 'Informe a que item o uso se refere.' });

    const ids = Array.isArray(documentos_ids) ? documentos_ids.filter(Boolean) : [];
    const inserir = db.prepare(
      'INSERT INTO documento_usos (id, documento_id, item_tipo, item_id, criado_em) VALUES (?,?,?,?,?)'
    );
    db.transaction(() => {
      for (const d of ids) inserir.run(novoId(), d, item_tipo, item_id ?? null, agora());
    })();
    res.status(201).json({ ok: true, registrados: ids.length });
  })
);

/**
 * De quais documentos um item foi gerado. O documento pode ja ter sido
 * excluido: aparece como removido, e o item segue intacto.
 */
app.get(
  '/api/documento-usos/:tipo/:id',
  rota((req, res) => {
    res.json(
      db
        .prepare(
          `SELECT u.documento_id, d.nome_arquivo, d.bloco_id
             FROM documento_usos u
             LEFT JOIN documentos_fonte d ON d.id = u.documento_id
            WHERE u.item_tipo = ? AND u.item_id = ?`
        )
        .all(req.params.tipo, req.params.id)
        .map((u) => ({
          documento_id: u.documento_id,
          nome_arquivo: u.nome_arquivo,
          removido: u.nome_arquivo === null,
        }))
    );
  })
);

// ===========================================================================
// VINCULOS ENTRE AVALIACAO E ATIVIDADES
//
// Uma avaliacao vinculada e REALIZADA PELAS atividades vinculadas: o trabalho
// passa a ser representado por elas, e a avaliacao sai da fila como item
// proprio. Assim o mesmo trabalho nunca e contado duas vezes.
// ===========================================================================
const TIPOS_ITEM = new Set(['entregavel', 'lista_questoes']);

/** Em que bloco um item vive. Null quando ele nao existe mais. */
function blocoDoItem(tipo, id) {
  const tabela = tipo === 'entregavel' ? 'entregaveis' : 'listas_questoes';
  return db.prepare(`SELECT bloco_id FROM ${tabela} WHERE id = ?`).get(id)?.bloco_id ?? null;
}

/** Itens vinculados a uma avaliacao, com nome e data. */
function itensDaAvaliacao(avaliacaoId) {
  return db
    .prepare(
      `SELECT v.item_tipo, v.item_id,
              COALESCE(e.titulo, l.titulo) AS titulo,
              COALESCE(e.data_entrega, l.data_prevista) AS data,
              CASE WHEN e.id IS NOT NULL THEN e.concluido
                   WHEN l.status = 'completa' THEN 1 ELSE 0 END AS concluido
         FROM avaliacao_itens v
         LEFT JOIN entregaveis e ON e.id = v.item_id AND v.item_tipo = 'entregavel'
         LEFT JOIN listas_questoes l ON l.id = v.item_id AND v.item_tipo = 'lista_questoes'
        WHERE v.avaliacao_id = ?`
    )
    .all(avaliacaoId)
    // Item ja excluido na origem some do vinculo.
    .filter((i) => i.titulo !== null);
}

app.get(
  '/api/blocos/:id/vinculos',
  rota((req, res) => {
    const linhas = db
      .prepare(
        `SELECT v.* FROM avaliacao_itens v
           JOIN avaliacoes a ON a.id = v.avaliacao_id
          WHERE a.bloco_id = ?`
      )
      .all(req.params.id);

    const avaliacoes = db
      .prepare('SELECT id, titulo FROM avaliacoes WHERE bloco_id = ? ORDER BY ordem, rowid')
      .all(req.params.id);

    res.json({
      vinculos: linhas,
      avaliacoes,
      porAvaliacao: Object.fromEntries(avaliacoes.map((a) => [a.id, itensDaAvaliacao(a.id)])),
    });
  })
);

/** Define o conjunto inteiro de itens de uma avaliacao. */
app.put(
  '/api/avaliacoes/:id/itens',
  rota((req, res) => {
    const avaliacao = db.prepare('SELECT * FROM avaliacoes WHERE id = ?').get(req.params.id);
    if (!avaliacao) return res.status(404).json({ erro: 'Avaliação não encontrada.' });

    const pedidos = Array.isArray(req.body?.itens) ? req.body.itens : [];
    const itens = [];
    for (const i of pedidos) {
      if (!TIPOS_ITEM.has(i?.item_tipo) || !i?.item_id) {
        return res.status(400).json({ erro: 'Item inválido.' });
      }
      const bloco = blocoDoItem(i.item_tipo, i.item_id);
      if (bloco === null) return res.status(400).json({ erro: 'Esse item não existe mais.' });
      // Vincular so faz sentido dentro do mesmo bloco: sao a mesma disciplina.
      if (bloco !== avaliacao.bloco_id) {
        return res.status(400).json({ erro: 'Só é possível vincular itens do mesmo bloco.' });
      }
      // Um item pertence a no maximo uma avaliacao.
      const dono = db
        .prepare('SELECT avaliacao_id FROM avaliacao_itens WHERE item_tipo = ? AND item_id = ?')
        .get(i.item_tipo, i.item_id);
      if (dono && dono.avaliacao_id !== avaliacao.id) {
        const nome = db.prepare('SELECT titulo FROM avaliacoes WHERE id = ?').get(dono.avaliacao_id);
        return res
          .status(409)
          .json({ erro: `Esse item já está vinculado a ${nome?.titulo ?? 'outra avaliação'}.` });
      }
      itens.push(i);
    }

    const apagar = db.prepare('DELETE FROM avaliacao_itens WHERE avaliacao_id = ?');
    const inserir = db.prepare(
      'INSERT INTO avaliacao_itens (id, avaliacao_id, item_tipo, item_id, criado_em) VALUES (?,?,?,?,?)'
    );
    db.transaction(() => {
      apagar.run(avaliacao.id);
      for (const i of itens) inserir.run(novoId(), avaliacao.id, i.item_tipo, i.item_id, agora());
    })();

    res.json({ ok: true, itens: itensDaAvaliacao(avaliacao.id) });
  })
);

/** Define (ou tira) a avaliacao de UM item — usado nos formularios do item. */
app.put(
  '/api/vinculos/:tipo/:id',
  rota((req, res) => {
    const { tipo, id } = req.params;
    if (!TIPOS_ITEM.has(tipo)) return res.status(400).json({ erro: 'Tipo de item inválido.' });

    const bloco = blocoDoItem(tipo, id);
    if (bloco === null) return res.status(404).json({ erro: 'Item não encontrado.' });

    const avaliacaoId = req.body?.avaliacao_id ?? null;
    db.prepare('DELETE FROM avaliacao_itens WHERE item_tipo = ? AND item_id = ?').run(tipo, id);
    if (!avaliacaoId) return res.json({ ok: true, avaliacao_id: null });

    const avaliacao = db.prepare('SELECT * FROM avaliacoes WHERE id = ?').get(avaliacaoId);
    if (!avaliacao) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    if (avaliacao.bloco_id !== bloco) {
      return res.status(400).json({ erro: 'Só é possível vincular itens do mesmo bloco.' });
    }

    db.prepare(
      'INSERT INTO avaliacao_itens (id, avaliacao_id, item_tipo, item_id, criado_em) VALUES (?,?,?,?,?)'
    ).run(novoId(), avaliacaoId, tipo, id, agora());
    res.json({ ok: true, avaliacao_id: avaliacaoId });
  })
);

// ===========================================================================
// EXCLUSAO PELO CALENDARIO
//
// Excluir pelo calendario e a MESMA acao de excluir pela tela de origem. As
// evidencias ja registradas ficam: sao historico do que aconteceu.
// ===========================================================================
const TIPOS_CALENDARIO = new Set(['evento', 'avaliacao', 'entregavel', 'lista', 'revisao']);

/** O que o usuario precisa saber antes de confirmar. */
app.get(
  '/api/calendario/:tipo/:id/consequencias',
  rota((req, res) => {
    const { tipo, id } = req.params;
    if (!TIPOS_CALENDARIO.has(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });

    const linhas = [];
    let vinculo = null;

    if (tipo === 'evento') {
      linhas.push('O evento será excluído.');
    } else if (tipo === 'avaliacao') {
      linhas.push('A avaliação será excluída e deixará de contar no cálculo de média do bloco.');
      if (itensDaAvaliacao(id).length > 0) {
        linhas.push('As atividades vinculadas serão mantidas, sem vínculo.');
      }
    } else if (tipo === 'entregavel' || tipo === 'lista') {
      const itemTipo = tipo === 'entregavel' ? 'entregavel' : 'lista_questoes';
      linhas.push(
        tipo === 'entregavel'
          ? 'O entregável será excluído do Modo Projeto, com seus tópicos associados.'
          : 'A lista e seu gabarito serão excluídos do Modo Prova.'
      );
      const dono = db
        .prepare(
          `SELECT a.titulo FROM avaliacao_itens v
             JOIN avaliacoes a ON a.id = v.avaliacao_id
            WHERE v.item_tipo = ? AND v.item_id = ?`
        )
        .get(itemTipo, id);
      if (dono) {
        vinculo = dono.titulo;
        linhas.push(`Ele deixará de fazer parte da avaliação ${dono.titulo}.`);
      }
    } else {
      linhas.push(
        'Esta revisão será excluída e o ciclo de revisões deste tópico será encerrado.'
      );
    }

    linhas.push('As evidências já registradas são mantidas.');
    res.json({ linhas, vinculo });
  })
);

app.delete(
  '/api/calendario/:tipo/:id',
  rota((req, res) => {
    const { tipo, id } = req.params;
    if (!TIPOS_CALENDARIO.has(tipo)) return res.status(400).json({ erro: 'Tipo inválido.' });

    const itemTipo = tipo === 'entregavel' ? 'entregavel' : tipo === 'lista' ? 'lista_questoes' : null;

    db.transaction(() => {
      // Os vinculos apontam para o item: somem com ele. As evidencias ficam.
      if (itemTipo) {
        db.prepare('DELETE FROM avaliacao_itens WHERE item_tipo = ? AND item_id = ?').run(itemTipo, id);
      }
      if (tipo === 'avaliacao') {
        db.prepare('DELETE FROM avaliacao_itens WHERE avaliacao_id = ?').run(id);
      }
      db.prepare('DELETE FROM documento_usos WHERE item_id = ?').run(id);

      if (tipo === 'evento') db.prepare('DELETE FROM eventos WHERE id = ?').run(id);
      else if (tipo === 'avaliacao') db.prepare('DELETE FROM avaliacoes WHERE id = ?').run(id);
      else if (tipo === 'entregavel') db.prepare('DELETE FROM entregaveis WHERE id = ?').run(id);
      else if (tipo === 'lista') db.prepare('DELETE FROM listas_questoes WHERE id = ?').run(id);
      else db.prepare('DELETE FROM revisoes WHERE id = ?').run(id);

      db.prepare('DELETE FROM ajustes_prioridade WHERE item_id = ?').run(id);
    })();

    res.json({ ok: true });
  })
);

// Rota /api inexistente: JSON, nunca a pagina "Cannot GET".
app.use('/api', (_req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.', codigo: 'rota_inexistente' });
});

// Ultimo middleware: todo erro vira JSON legivel, e o completo vai para o console.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const { status, erro, codigo } = traduzirErro(err);
  console.error(`[erro] ${req.method} ${req.originalUrl} -> ${status} ${codigo}`);
  console.error(err);
  if (res.headersSent) return;
  res.status(status).json({ erro, codigo });
});

app.listen(PORTA, () => {
  console.log(`[servidor] http://localhost:${PORTA}`);
  // Documentos que ainda nao tem trechos (os de antes da busca por trechos) e
  // os que estavam em processamento quando o servidor parou.
  const pendentes = retomarPendentes();
  if (pendentes) console.log(`[servidor] ${pendentes} documento(s) na fila de processamento`);
  console.log(
    `[servidor] IA: ${iaDisponivel() ? `Gemini ativo (modelo ${modeloEmUso()})` : 'modo simulado (sem GEMINI_API_KEY)'}`
  );
});
