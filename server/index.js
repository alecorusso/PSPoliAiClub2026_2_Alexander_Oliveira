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
  extrairTabelaConteudos,
  buscarRoteiroEstudos,
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
        tabela_conteudos_construida = ? WHERE id = ?`
    ).run(
      b.nome?.trim() || atual.nome,
      b.descricao === undefined ? atual.descricao : b.descricao?.trim() || null,
      b.pasta_id === undefined ? atual.pasta_id : b.pasta_id || null,
      b.favorito === undefined ? atual.favorito : bool(b.favorito),
      b.oculto === undefined ? atual.oculto : bool(b.oculto),
      b.wrapper_academico === undefined ? atual.wrapper_academico : bool(b.wrapper_academico),
      num('limite_faltas'),
      num('faltas_registradas') ?? 0,
      num('media_aprovacao'),
      b.tabela_conteudos_construida === undefined
        ? atual.tabela_conteudos_construida
        : bool(b.tabela_conteudos_construida),
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

function salvarMensagem(blocoId, topicoId, papel, conteudo) {
  const id = novoId();
  db.prepare(
    'INSERT INTO mensagens_chat (id, bloco_id, topico_id, papel, conteudo, modo_ativo, criado_em) VALUES (?,?,?,?,?,?,?)'
  ).run(id, blocoId, topicoId ?? null, papel, conteudo, 'aprendizagem', agora());
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

app.listen(PORTA, () => {
  console.log(`[servidor] http://localhost:${PORTA}`);
  console.log(`[servidor] IA: ${iaDisponivel() ? 'Gemini ativo' : 'modo simulado (sem GEMINI_API_KEY)'}`);
});
