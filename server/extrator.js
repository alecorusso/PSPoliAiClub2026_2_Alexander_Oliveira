// Extracao de texto de documentos, rodando num PROCESSO FILHO.
//
// Um livro de centenas de paginas leva tempo para ler. Aqui o trabalho pesado
// fica fora do servidor: ele continua respondendo enquanto o PDF e lido, e a
// interface acompanha pelo status do documento.
//
// Processo, e nao worker thread: o pdfjs carrega no Node um modulo nativo
// (@napi-rs/canvas), e um crash nativo numa worker thread derruba o servidor
// inteiro (visto em teste: saida 139). Num processo filho, so ele cai — o
// documento fica 'falhou' e o servidor segue.
//
// Recebe { caminho, nome } e devolve:
//   { paginas: [{ numero, texto }], sumario: [{ titulo, pagina, nivel }], total_paginas }
// Para .docx/.txt/.md nao ha paginas: vem uma unica "pagina" com numero null.
// Durante a leitura de PDF, envia { progresso: { feito, total } }.

import fs from 'node:fs';

/**
 * Reconstroi as linhas e os paragrafos de uma pagina a partir dos itens do
 * pdfjs. O pdfjs so da pedacos de texto com posicao: a quebra de linha vem de
 * hasEOL, e o paragrafo de um salto vertical maior que o normal.
 */
function textoDaPagina(itens) {
  let saida = '';
  let yAnterior = null;
  let alturaAnterior = 0;

  for (const item of itens) {
    if (!('str' in item)) continue;
    const y = item.transform?.[5] ?? null;
    const altura = Math.abs(item.transform?.[3] ?? item.height ?? 0) || alturaAnterior || 10;

    if (yAnterior !== null && y !== null && saida && !saida.endsWith('\n')) {
      // Mudou de linha sem hasEOL (comum em PDFs gerados por LaTeX).
      if (Math.abs(yAnterior - y) > altura * 0.6) saida += '\n';
    }
    if (yAnterior !== null && y !== null && saida.endsWith('\n') && !saida.endsWith('\n\n')) {
      // Salto vertical grande: fim de paragrafo.
      if (yAnterior - y > Math.max(altura, alturaAnterior) * 1.8) saida += '\n';
    }

    saida += item.str;
    if (item.hasEOL) saida += '\n';
    if (item.str.trim()) {
      yAnterior = y;
      alturaAnterior = altura;
    }
  }
  return saida
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    // Palavra partida na quebra de linha ("da-\ndos"): volta a ser uma so.
    .replace(/([a-zà-ú])-\n([a-zà-ú])/g, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Resolve o destino de um marcador para o numero da pagina (1-based). */
async function paginaDoDestino(doc, destino) {
  try {
    const d = typeof destino === 'string' ? await doc.getDestination(destino) : destino;
    if (!Array.isArray(d) || !d[0]) return null;
    if (typeof d[0] === 'number') return d[0] + 1;
    return (await doc.getPageIndex(d[0])) + 1;
  } catch {
    return null;
  }
}

/** Sumario a partir dos marcadores (outline) do PDF. Sem IA. */
async function sumarioDoPdf(doc) {
  let outline = null;
  try {
    outline = await doc.getOutline();
  } catch {
    return [];
  }
  if (!Array.isArray(outline)) return [];

  const saida = [];
  const percorrer = async (itens, nivel) => {
    for (const item of itens) {
      const titulo = String(item.title ?? '').replace(/\s+/g, ' ').trim();
      const pagina = await paginaDoDestino(doc, item.dest);
      if (titulo) saida.push({ titulo, pagina, nivel });
      if (Array.isArray(item.items) && item.items.length && nivel < 4) {
        await percorrer(item.items, nivel + 1);
      }
    }
  };
  await percorrer(outline, 0);
  return saida;
}

async function extrairPdf(caminho) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dados = new Uint8Array(fs.readFileSync(caminho));
  const doc = await pdfjs.getDocument({
    data: dados,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const paginas = [];
  const total = doc.numPages;
  for (let n = 1; n <= total; n++) {
    const pagina = await doc.getPage(n);
    const conteudo = await pagina.getTextContent();
    paginas.push({ numero: n, texto: textoDaPagina(conteudo.items) });
    pagina.cleanup();
    if (n % 10 === 0 || n === total) process.send?.({ progresso: { feito: n, total } });
  }
  const sumario = await sumarioDoPdf(doc);
  await doc.destroy();
  return { paginas, sumario, total_paginas: total };
}

async function extrairDocx(caminho) {
  const { default: mammoth } = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: fs.readFileSync(caminho) });
  return { paginas: [{ numero: null, texto: value.trim() }], sumario: [], total_paginas: null };
}

function extrairTextoSimples(caminho) {
  const texto = fs.readFileSync(caminho, 'utf8');
  return { paginas: [{ numero: null, texto }], sumario: [], total_paginas: null };
}

export async function extrair({ caminho, nome }) {
  const n = String(nome ?? caminho).toLowerCase();
  const inicio = fs.readFileSync(caminho).subarray(0, 5).toString('latin1');
  if (n.endsWith('.pdf') || inicio === '%PDF-') return extrairPdf(caminho);
  if (n.endsWith('.docx')) return extrairDocx(caminho);
  return extrairTextoSimples(caminho);
}

// Rodando como processo filho: recebe { caminho, nome }, devolve o resultado e sai.
if (process.send) {
  process.once('message', (dados) => {
    extrair(dados)
      .then((resultado) => process.send({ resultado }, () => process.exit(0)))
      .catch((e) => process.send({ erro: e?.message ?? String(e) }, () => process.exit(0)));
  });
}
