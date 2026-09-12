import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Aceita o .env na raiz do monorepo ou dentro de /server.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const { default: express } = await import('express');
const { default: cors } = await import('cors');
const { db, migrar, agora, hojeISO, somarDias, novoId } = await import('./db.js');
// Importado depois do dotenv: gemini.js le process.env no carregamento do modulo.
const {
  conversarSondagem,
  conversarBloco,
  extrairTabelaConteudos,
  buscarRoteiroEstudos,
  gerarListaQuestoes,
  gerarGabarito,
  sugerirEntregaveis,
  iaDisponivel,
  PROTOCOLOS,
} = await import('./gemini.js');

migrar();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const PORTA = Number(process.env.PORT) || 3333;

// Envolve um handler assincrono para que erros virem resposta 500 legivel.
const rota = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error('[erro]', e);
    if (!res.headersSent) res.status(500).json({ erro: e.message });
  });
};

const bool = (v) => (v ? 1 : 0);

// Os tres modos sao lentes sobre o mesmo bloco, nunca etapas sequenciais.
const MODOS = new Set(['prova', 'projeto', 'aprendizagem']);

// ===========================================================================
// Status
// ===========================================================================
app.get('/api/status', (_req, res) => {
  res.json({ ok: true, ia: iaDisponivel(), protocolos: PROTOCOLOS });
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
        tabela_conteudos_construida = ?, sugerir_testes_auto = ? WHERE id = ?`
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

    // Nunca duplicar a relacao inversa: a aresta existe uma unica vez, em qualquer direcao.
    const jaExiste = db
      .prepare(
        `SELECT id FROM bloco_relacoes
          WHERE tipo = ?
            AND ((bloco_origem_id = ? AND bloco_destino_id = ?)
              OR (bloco_origem_id = ? AND bloco_destino_id = ?))`
      )
      .get(tipo, origem, bloco_destino_id, bloco_destino_id, origem);
    if (jaExiste) return res.status(409).json({ erro: 'Essa relação já existe.' });

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
// DOCUMENTOS FONTE
// ===========================================================================
app.get(
  '/api/blocos/:id/documentos',
  rota((req, res) => {
    res.json(
      db
        .prepare('SELECT id, bloco_id, nome_arquivo, criado_em FROM documentos_fonte WHERE bloco_id = ? ORDER BY criado_em')
        .all(req.params.id)
    );
  })
);

app.post(
  '/api/blocos/:id/documentos',
  rota((req, res) => {
    const docs = Array.isArray(req.body?.documentos) ? req.body.documentos : [];
    const inserir = db.prepare(
      'INSERT INTO documentos_fonte (id, bloco_id, nome_arquivo, conteudo_texto, criado_em) VALUES (?,?,?,?,?)'
    );
    const tx = db.transaction(() => {
      for (const d of docs) {
        inserir.run(novoId(), req.params.id, d.nome_arquivo || 'documento', d.conteudo_texto || '', agora());
      }
    });
    tx();
    res.status(201).json({ ok: true, quantidade: docs.length });
  })
);

// ===========================================================================
// IA — todas as chamadas passam pelo servidor
// ===========================================================================
app.post(
  '/api/ia/extrair-tabela',
  rota(async (req, res) => {
    let texto = req.body?.texto;
    if (!texto && req.body?.bloco_id) {
      texto = db
        .prepare('SELECT conteudo_texto FROM documentos_fonte WHERE bloco_id = ? ORDER BY criado_em')
        .all(req.body.bloco_id)
        .map((d) => d.conteudo_texto)
        .join('\n\n---\n\n');
    }
    res.json(await extrairTabelaConteudos(texto));
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
const ORIGENS = new Set(['enviada', 'gerada_fontes', 'gerada_internet']);
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
        (id, bloco_id, topico_id, titulo, enunciado, gabarito, origem, status, quantidade, contexto, criado_em)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
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
      agora()
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

    db.prepare('UPDATE listas_questoes SET titulo = ?, status = ?, gabarito = ? WHERE id = ?').run(
      b.titulo?.trim() || atual.titulo,
      status,
      b.gabarito === undefined
        ? atual.gabarito
        : b.gabarito == null
          ? null
          : typeof b.gabarito === 'string'
            ? b.gabarito
            : JSON.stringify(b.gabarito),
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
function textoDosDocumentos(blocoId, ids) {
  const todos = db
    .prepare('SELECT id, conteudo_texto FROM documentos_fonte WHERE bloco_id = ? ORDER BY criado_em')
    .all(blocoId);
  const escolhidos = Array.isArray(ids) && ids.length ? todos.filter((d) => ids.includes(d.id)) : todos;
  return escolhidos.map((d) => d.conteudo_texto).join('\n\n---\n\n');
}

app.post(
  '/api/ia/lista-questoes',
  rota(async (req, res) => {
    const { bloco_id, topico_id, quantidade, fonte } = req.body ?? {};
    const topico = db.prepare('SELECT * FROM topicos WHERE id = ?').get(topico_id);
    if (!topico) return res.status(404).json({ erro: 'Tópico não encontrado.' });

    const daInternet = fonte?.tipo === 'internet';
    const entrada = daInternet
      ? { tipo: 'internet' }
      : { tipo: 'documentos', texto: textoDosDocumentos(bloco_id, fonte?.documentos_ids) };

    res.json(await gerarListaQuestoes(entrada, topico.titulo, quantidade));
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
        (id, bloco_id, titulo, descricao, data_entrega, ferramentas, tempo_estimado_horas, concluido, status, criado_em)
       VALUES (?,?,?,?,?,?,?,0,NULL,?)`
    ).run(
      id,
      req.params.id,
      b.titulo.trim(),
      b.descricao?.trim() || null,
      b.data_entrega || null,
      b.ferramentas?.trim() || null,
      b.tempo_estimado_horas === '' || b.tempo_estimado_horas == null ? null : Number(b.tempo_estimado_horas),
      agora()
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
        tempo_estimado_horas = ? WHERE id = ?`
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

    const material = textoDosDocumentos(entregavel.bloco_id, null);
    if (!material.trim()) {
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
      const r = await gerarListaQuestoes({ tipo: 'documentos', texto: material }, topico.titulo, 5);
      if (r.erro || r.questoes.length === 0) {
        problemas.push(`${topico.titulo}: ${r.erro ?? 'sem questões'}`);
        continue;
      }
      const id = novoId();
      db.prepare(
        `INSERT INTO listas_questoes
          (id, bloco_id, topico_id, titulo, enunciado, gabarito, origem, status, quantidade, contexto, criado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
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
        agora()
      );
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
      const upsert = db.prepare(
        `INSERT INTO avaliacoes (id, bloco_id, titulo, peso, nota, ordem, data, observacao, criado_em)
         VALUES (@id, @bloco_id, @titulo, @peso, @nota, @ordem, NULL, NULL, @criado_em)
         ON CONFLICT(id) DO UPDATE SET
           titulo = excluded.titulo,
           peso = excluded.peso,
           nota = excluded.nota,
           ordem = excluded.ordem`
      );
      recebidas.forEach((a, i) => {
        upsert.run({
          id: a.id || novoId(),
          bloco_id: blocoId,
          titulo: String(a.titulo || '').trim() || 'Avaliação',
          peso: numero(a.peso),
          nota: numero(a.nota),
          ordem: i,
          criado_em: agora(),
        });
      });
    });
    sincronizar();

    res.json(db.prepare('SELECT * FROM avaliacoes WHERE bloco_id = ? ORDER BY ordem, rowid').all(blocoId));
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

app.listen(PORTA, () => {
  console.log(`[servidor] http://localhost:${PORTA}`);
  console.log(`[servidor] IA: ${iaDisponivel() ? 'Gemini ativo' : 'modo simulado (sem GEMINI_API_KEY)'}`);
});
