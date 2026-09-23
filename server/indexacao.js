// Processamento dos documentos do repositorio, em segundo plano.
//
// O envio responde assim que o arquivo chega; daqui em diante o documento
// passa por:  extraindo -> dividindo -> indexando  (ou 'falhou', com o motivo).
// Um documento de cada vez, numa fila simples.
//
// Ele fica 'pronto' — pode ser escolhido nos fluxos — assim que tem texto e
// trechos. A indexacao por embeddings segue depois, com o progresso visivel,
// sem bloquear nada: ate terminar, a busca usa palavras-chave.
//
// A indexacao por embeddings grava lote a lote: se a API parar no meio (limite
// de uso, queda), o que ja foi feito fica, e o documento continua utilizavel
// pela busca por palavras-chave ate ser reindexado.

import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db, novoId, PASTA_ARQUIVOS } from './db.js';
import { dividirEmTrechos } from './trechos.js';
import { gerarEmbeddings, iaDisponivel, LOTE_EMBEDDING } from './gemini.js';

/** Tempo maximo para extrair um arquivo antes de desistir. */
const TEMPO_MAXIMO_EXTRACAO_MS = 10 * 60 * 1000;

const fila = [];
let rodando = false;

const atualizar = (id, campos) => {
  const chaves = Object.keys(campos);
  db.prepare(`UPDATE documentos_fonte SET ${chaves.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({
    ...campos,
    id,
  });
};

const EXTRATOR = fileURLToPath(new URL('./extrator.js', import.meta.url));

/**
 * Le o arquivo num processo filho: o servidor segue respondendo, e um crash
 * na leitura derruba so o filho, nunca o servidor.
 */
function extrairEmProcesso(caminho, nome, aoProgredir) {
  return new Promise((resolver, rejeitar) => {
    const filho = fork(EXTRATOR, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let terminou = false;
    const fim = (fn, valor) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(relogio);
      fn(valor);
    };
    const relogio = setTimeout(() => {
      filho.kill();
      fim(rejeitar, new Error('A leitura do arquivo demorou demais.'));
    }, TEMPO_MAXIMO_EXTRACAO_MS);
    filho.on('message', (m) => {
      if (m.progresso) aoProgredir?.(m.progresso);
      else if (m.resultado) fim(resolver, m.resultado);
      else if (m.erro) fim(rejeitar, new Error(m.erro));
    });
    filho.on('error', (e) => fim(rejeitar, e));
    filho.on('exit', (codigo, sinal) =>
      fim(rejeitar, new Error(`a leitura do arquivo parou inesperadamente (${sinal ?? `código ${codigo}`})`))
    );
    filho.send({ caminho, nome });
  });
}

/** Mensagem legivel para um arquivo que nao se deixa ler. */
function motivoDaFalhaDeLeitura(e) {
  const m = String(e?.message ?? e);
  if (/password|encrypt/i.test(m)) return 'O PDF está protegido por senha.';
  if (/Invalid PDF|FormatError|bad XRef/i.test(m)) return 'O arquivo não parece ser um PDF válido.';
  return `Não foi possível ler o arquivo (${m.slice(0, 120)}).`;
}

async function processar(id) {
  const doc = db.prepare('SELECT * FROM documentos_fonte WHERE id = ?').get(id);
  if (!doc) return; // excluido enquanto esperava na fila

  // --- 1. extracao ---------------------------------------------------------
  let paginas;
  let sumario = doc.sumario ? JSON.parse(doc.sumario) : [];
  const caminho = doc.caminho_arquivo ? path.join(PASTA_ARQUIVOS, doc.caminho_arquivo) : null;
  const precisaExtrair = caminho && fs.existsSync(caminho) && (doc.extraido !== 1 || !doc.conteudo_texto);

  if (precisaExtrair) {
    atualizar(id, { status: 'processando', etapa: 'extraindo', progresso_feito: null, progresso_total: null, motivo: null });
    let r;
    try {
      r = await extrairEmProcesso(caminho, doc.nome_arquivo, ({ feito, total }) =>
        atualizar(id, { progresso_feito: feito, progresso_total: total })
      );
    } catch (e) {
      atualizar(id, { status: 'falhou', etapa: null, progresso_feito: null, progresso_total: null, motivo: motivoDaFalhaDeLeitura(e) });
      return;
    }
    const texto = r.paginas.map((p) => p.texto).filter(Boolean).join('\n\n');
    if (!texto.trim()) {
      atualizar(id, {
        status: 'falhou',
        etapa: null,
        motivo: /\.pdf$/i.test(doc.nome_arquivo)
          ? 'O PDF não tem texto selecionável — parece ser digitalizado (só imagem). Envie uma versão com texto.'
          : 'O documento não contém texto legível.',
      });
      return;
    }
    paginas = r.paginas;
    sumario = r.sumario ?? [];
    atualizar(id, {
      conteudo_texto: texto,
      extraido: 1,
      paginas: r.total_paginas ?? null,
      sumario: sumario.length ? JSON.stringify(sumario) : null,
    });
    // Reextraido: os trechos antigos nao correspondem mais ao texto.
    db.prepare('DELETE FROM documento_trechos WHERE documento_id = ?').run(id);
  } else {
    if (!String(doc.conteudo_texto ?? '').trim()) {
      atualizar(id, { status: 'falhou', etapa: null, progresso_feito: null, progresso_total: null, motivo: 'O documento não contém texto legível.' });
      return;
    }
    paginas = [{ numero: null, texto: doc.conteudo_texto }];
  }

  // --- 2. divisao em trechos ------------------------------------------------
  const existentes = db.prepare('SELECT COUNT(*) AS n FROM documento_trechos WHERE documento_id = ?').get(id).n;
  if (existentes === 0) {
    atualizar(id, { status: 'processando', etapa: 'dividindo', progresso_feito: null, progresso_total: null });
    const trechos = dividirEmTrechos({ paginas, sumario });
    const inserir = db.prepare(
      `INSERT INTO documento_trechos (id, documento_id, ordem, texto, pagina_inicio, pagina_fim, titulo_secao)
       VALUES (?,?,?,?,?,?,?)`
    );
    db.transaction(() => {
      for (const t of trechos) {
        inserir.run(novoId(), id, t.ordem, t.texto, t.pagina_inicio, t.pagina_fim, t.titulo_secao);
      }
    })();
  }

  // --- 3. embeddings ---------------------------------------------------------
  if (!iaDisponivel()) {
    atualizar(id, { status: 'pronto', etapa: null, indice: 'palavras', motivo: null, progresso_feito: null, progresso_total: null });
    return;
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM documento_trechos WHERE documento_id = ?').get(id).n;
  const pendentes = db
    .prepare('SELECT id, texto, titulo_secao FROM documento_trechos WHERE documento_id = ? AND embedding IS NULL ORDER BY ordem')
    .all(id);
  let feitos = total - pendentes.length;
  // Ja tem texto e trechos: pode ser usado enquanto indexa.
  atualizar(id, { status: 'pronto', etapa: 'indexando', progresso_feito: feitos, progresso_total: total, motivo: null });

  const gravar = db.prepare('UPDATE documento_trechos SET embedding = ? WHERE id = ?');
  for (let i = 0; i < pendentes.length; i += LOTE_EMBEDDING) {
    // Excluido no meio da indexacao: para aqui.
    if (!db.prepare('SELECT 1 FROM documentos_fonte WHERE id = ?').get(id)) return;
    const lote = pendentes.slice(i, i + LOTE_EMBEDDING);
    let vetores;
    try {
      vetores = await gerarEmbeddings(
        lote.map((t) => (t.titulo_secao ? `${t.titulo_secao}\n\n${t.texto}` : t.texto)),
        {
          aoEsperar: (ms) =>
            atualizar(id, { motivo: `aguardando o limite da API (${Math.round(ms / 1000)} s)` }),
        }
      );
    } catch (e) {
      // O que ja foi feito fica; a busca usa palavras-chave ate reindexar.
      atualizar(id, {
        status: 'pronto',
        etapa: null,
        indice: 'palavras',
        motivo: `A indexação parou em ${feitos} de ${total} trechos (${e.message}). Enquanto isso, a busca usa palavras-chave; use "Indexar documentos" para continuar.`,
        progresso_feito: null,
        progresso_total: null,
      });
      return;
    }
    // Vetor arredondado: 5 casas bastam para o cosseno e o banco fica menor.
    db.transaction(() => {
      lote.forEach((t, k) =>
        gravar.run(JSON.stringify(vetores[k].map((x) => Math.round(x * 1e5) / 1e5)), t.id)
      );
    })();
    feitos += lote.length;
    atualizar(id, { progresso_feito: feitos, motivo: null });

    // Revezamento: um livro longo nao segura a fila. Se outro documento esta
    // esperando, este volta para o fim — o que ja foi indexado fica gravado.
    if (fila.length > 0 && feitos < total) {
      fila.push(id);
      return;
    }
  }

  atualizar(id, { status: 'pronto', etapa: null, indice: 'semantico', motivo: null, progresso_feito: null, progresso_total: null });
}

async function rodar() {
  if (rodando) return;
  rodando = true;
  try {
    while (fila.length) {
      const id = fila.shift();
      try {
        await processar(id);
      } catch (e) {
        console.error('[indexacao] falha inesperada em', id, e);
        try {
          atualizar(id, { status: 'falhou', etapa: null, progresso_feito: null, progresso_total: null, motivo: `Falha inesperada no processamento (${e.message}).` });
        } catch {
          /* documento ja nao existe */
        }
      }
    }
  } finally {
    rodando = false;
  }
}

/** Coloca o documento na fila. Ja marca 'processando', para a tela mostrar. */
export function enfileirar(id) {
  if (!fila.includes(id)) {
    fila.push(id);
    // Quem ja tem trechos (so falta indexar) continua utilizavel na fila.
    const doc = db.prepare('SELECT status FROM documentos_fonte WHERE id = ?').get(id);
    const temTrechos = db.prepare('SELECT 1 FROM documento_trechos WHERE documento_id = ? LIMIT 1').get(id);
    atualizar(
      id,
      temTrechos && doc?.status === 'pronto'
        ? { etapa: 'indexando', motivo: null }
        : { status: 'processando', etapa: null, motivo: null }
    );
  }
  void rodar();
}

/**
 * Documentos que precisam de (re)processamento: nunca indexados, que falharam,
 * ou — com chave disponivel — com embeddings incompletos.
 */
export function precisaIndexar(d) {
  if (d.etapa === 'indexando') return false; // ja esta indexando
  if (d.status === 'processando') return true;
  if (d.status === 'falhou') return true;
  if (d.indice == null) return true;
  return iaDisponivel() && d.indice !== 'semantico';
}

/** Reindexa os documentos de um bloco que precisam. Devolve quantos entraram na fila. */
export function reindexarBloco(blocoId) {
  const docs = db.prepare('SELECT id, status, indice FROM documentos_fonte WHERE bloco_id = ?').all(blocoId);
  let n = 0;
  for (const d of docs.filter(precisaIndexar)) {
    // Falhou: recomeca da leitura, que pode ter sido o problema.
    if (d.status === 'falhou') atualizar(d.id, { extraido: 0 });
    enfileirar(d.id);
    n += 1;
  }
  return n;
}

/**
 * Na subida do servidor: retoma o que estava em processamento e processa os
 * documentos que ainda nao tem trechos (os que ja existiam antes da busca por
 * trechos). Falhas e indexacoes incompletas esperam o botao "Indexar documentos".
 */
export function retomarPendentes() {
  const docs = db
    .prepare(
      `SELECT id FROM documentos_fonte
        WHERE status = 'processando' OR (indice IS NULL AND status <> 'falhou')
        ORDER BY criado_em`
    )
    .all();
  for (const d of docs) enfileirar(d.id);
  return docs.length;
}

export const filaDeIndexacao = () => ({ rodando, pendentes: [...fila] });
