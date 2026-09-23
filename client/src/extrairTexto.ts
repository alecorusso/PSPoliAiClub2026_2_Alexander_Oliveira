import * as pdfjs from 'pdfjs-dist';
import urlWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = urlWorker;

export const EXTENSOES_ACEITAS = '.txt,.md,.pdf,.docx';

/** Extrai o texto de .txt, .md, .pdf e .docx. Tudo é lido no navegador; o
 *  servidor recebe apenas o texto já extraído. */
export async function extrairTexto(arquivo: File): Promise<string> {
  const nome = arquivo.name.toLowerCase();

  if (nome.endsWith('.docx')) {
    // mammoth só é carregado quando aparece um .docx: é pesado e raro. O campo
    // "browser" do pacote troca os módulos de Node pelos do navegador.
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await arquivo.arrayBuffer() });
    return value.trim();
  }

  if (nome.endsWith('.pdf')) {
    const buffer = await arquivo.arrayBuffer();
    const documento = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const paginas: string[] = [];
    for (let n = 1; n <= documento.numPages; n++) {
      const pagina = await documento.getPage(n);
      const conteudo = await pagina.getTextContent();
      paginas.push(
        conteudo.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
    await documento.destroy();
    return paginas.filter(Boolean).join('\n\n');
  }

  // .txt, .md e qualquer outro texto simples
  return arquivo.text();
}
