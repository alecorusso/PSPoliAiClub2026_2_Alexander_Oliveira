import { useEffect, useMemo, useRef, useState } from 'react';
import { apiDocumentos, type MaterialDoFluxo, type ResultadoEnvio } from '../api';
import {
  CATEGORIAS,
  LIMITE_ARQUIVO_MB,
  motivoIndisponivel,
  rotuloCategoria,
  situacaoDoDocumento,
  SUGESTOES_POR_FLUXO,
  type CategoriaDocumento,
  type Documento,
  type TipoUso,
} from '../lib/documentos';
import { EXTENSOES_ACEITAS } from '../extrairTexto';
import { usarDocumentos } from '../estado/usarDocumentos';
import { cn, formatarData } from '../util';
import { Aviso, Carregando, Etiqueta, IconeBusca, IconeUpload, Modal } from './ui';

/**
 * Seletor de documentos, o mesmo nos quatro fluxos que usam material do bloco.
 *
 * Tudo vem do repositório: enviar por aqui grava lá, com deduplicação, em vez
 * de criar mais uma cópia solta.
 */

/** "~29 mil caracteres" — o tamanho do que vai para a IA, não do arquivo. */
const formatarCaracteres = (n: number) =>
  n < 1000 ? `${n} caracteres` : `~${Math.round(n / 1000).toLocaleString('pt-BR')} mil caracteres`;

export interface ProgressoEnvio {
  nome: string;
  /**
   * 'recebido': o arquivo chegou ao servidor e segue sendo processado lá — o
   * status do documento no repositório mostra o resto.
   */
  estado: 'enviando' | 'recebido' | 'reaproveitado' | 'erro';
  detalhe?: string;
}

/**
 * Envia arquivos para o repositório do bloco, com deduplicação.
 *
 * Usado pelo seletor e pela área Materiais: o caminho de gravação é um só.
 */
export async function enviarParaRepositorio(
  blocoId: string,
  arquivos: File[],
  categoria: CategoriaDocumento,
  aoProgredir: (p: ProgressoEnvio[]) => void,
  perguntarConflito: (nome: string, existenteEm: string) => Promise<'substituir' | 'manter' | null>
): Promise<Documento[]> {
  const progresso: ProgressoEnvio[] = arquivos.map((a) => ({ nome: a.name, estado: 'enviando' }));
  aoProgredir([...progresso]);

  const salvos: Documento[] = [];

  for (let i = 0; i < arquivos.length; i++) {
    const arquivo = arquivos[i];
    try {
      // Grande demais: avisa antes de mandar, sem gastar o envio.
      if (arquivo.size > LIMITE_ARQUIVO_MB * 1024 * 1024) {
        progresso[i] = {
          nome: arquivo.name,
          estado: 'erro',
          detalhe: `O arquivo é grande demais para o envio atual (limite de ${LIMITE_ARQUIVO_MB} MB).`,
        };
        aoProgredir([...progresso]);
        continue;
      }
      progresso[i] = { nome: arquivo.name, estado: 'enviando' };
      aoProgredir([...progresso]);

      // O arquivo vai inteiro, por multipart. O texto é extraído no servidor.
      const enviar = async (resolucao?: 'substituir' | 'manter') =>
        (await apiDocumentos.enviarArquivo(blocoId, arquivo, categoria, resolucao)).documentos[0];

      let resultado: ResultadoEnvio = await enviar();

      if ('conflito' in resultado && resultado.conflito === 'nome') {
        const escolha = await perguntarConflito(
          resultado.nome_arquivo,
          formatarData(resultado.existente.criado_em)
        );
        if (!escolha) {
          progresso[i] = { nome: arquivo.name, estado: 'erro', detalhe: 'envio cancelado' };
          aoProgredir([...progresso]);
          continue;
        }
        resultado = await enviar(escolha);
      }

      if ('conflito' in resultado) continue;

      salvos.push(resultado);
      progresso[i] = {
        nome: arquivo.name,
        estado: resultado.reaproveitado ? 'reaproveitado' : 'recebido',
        detalhe: resultado.reaproveitado ? 'Este documento já estava no repositório.' : undefined,
      };
      aoProgredir([...progresso]);
    } catch (e) {
      progresso[i] = { nome: arquivo.name, estado: 'erro', detalhe: (e as Error).message };
      aoProgredir([...progresso]);
    }
  }

  return salvos;
}

/** Pergunta do conflito de nome, usada pelos dois pontos de envio. */
export function ModalConflitoNome({
  pedido,
  aoResponder,
}: {
  pedido: { nome: string; existenteEm: string } | null;
  aoResponder: (r: 'substituir' | 'manter' | null) => void;
}) {
  return (
    <Modal
      aberto={Boolean(pedido)}
      aoFechar={() => aoResponder(null)}
      titulo="Já existe um documento com esse nome"
      largura="max-w-md"
    >
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        <span className="font-medium">{pedido?.nome}</span> já está no repositório (enviado em{' '}
        {pedido?.existenteEm}), com conteúdo diferente.
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="btn-secundario" onClick={() => aoResponder(null)}>
          Cancelar
        </button>
        <button className="btn-secundario" onClick={() => aoResponder('manter')}>
          Manter os dois
        </button>
        <button className="btn-primario" onClick={() => aoResponder('substituir')}>
          Substituir o anterior
        </button>
      </div>
    </Modal>
  );
}

export function SeletorDocumentos({
  blocoId,
  fluxo,
  selecionados,
  aoMudarSelecao,
}: {
  blocoId: string;
  /** Define quais categorias vêm pré-filtradas, sem esconder as demais. */
  fluxo: TipoUso;
  selecionados: string[];
  aoMudarSelecao: (ids: string[]) => void;
}) {
  const [aba, setAba] = useState<'repositorio' | 'enviar'>('repositorio');
  const { documentos, carregando, recarregar: carregar } = usarDocumentos(blocoId);
  // Enviados por aqui que ainda estão sendo processados: entram na seleção
  // assim que ficarem prontos.
  const [aguardando, setAguardando] = useState<string[]>([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<CategoriaDocumento | 'sugeridas' | 'todas'>('sugeridas');
  const [categoriaEnvio, setCategoriaEnvio] = useState<CategoriaDocumento>(
    SUGESTOES_POR_FLUXO[fluxo][0] ?? 'outro'
  );
  const [progresso, setProgresso] = useState<ProgressoEnvio[]>([]);
  const [conflito, setConflito] = useState<{ nome: string; existenteEm: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const respostaConflito = useRef<((r: 'substituir' | 'manter' | null) => void) | null>(null);
  const entradaArquivo = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (aguardando.length === 0) return;
    const prontos = documentos.filter((d) => aguardando.includes(d.id) && d.status === 'pronto').map((d) => d.id);
    const encerrados = documentos.filter((d) => aguardando.includes(d.id) && d.status !== 'processando').map((d) => d.id);
    if (encerrados.length === 0) return;
    if (prontos.length) aoMudarSelecao([...new Set([...selecionados, ...prontos])]);
    setAguardando((a) => a.filter((id) => !encerrados.includes(id)));
  }, [documentos, aguardando, selecionados, aoMudarSelecao]);

  const sugeridas = SUGESTOES_POR_FLUXO[fluxo];

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return documentos.filter((d) => {
      if (termo && !d.nome_arquivo.toLowerCase().includes(termo)) return false;
      if (filtro === 'todas') return true;
      // O pré-filtro sugere, mas nunca esconde: "Todas" está a um clique.
      if (filtro === 'sugeridas') return sugeridas.includes(d.categoria);
      return d.categoria === filtro;
    });
  }, [documentos, busca, filtro, sugeridas]);

  const escolhidos = documentos.filter((d) => selecionados.includes(d.id));

  // O que o fluxo mandaria ao modelo com esta seleção. Só informa: o tamanho
  // nunca desabilita caixa nem botão.
  const [material, setMaterial] = useState<MaterialDoFluxo | null>(null);
  const chaveSelecao = escolhidos.map((d) => d.id).sort().join(',');
  useEffect(() => {
    if (!chaveSelecao) {
      setMaterial(null);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      apiDocumentos
        .material(blocoId, fluxo, chaveSelecao.split(','))
        .then((m) => vivo && setMaterial(m))
        .catch(() => vivo && setMaterial(null));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [blocoId, fluxo, chaveSelecao]);

  const alternar = (id: string) =>
    aoMudarSelecao(
      selecionados.includes(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id]
    );

  const perguntarConflito = (nome: string, existenteEm: string) =>
    new Promise<'substituir' | 'manter' | null>((resolve) => {
      respostaConflito.current = resolve;
      setConflito({ nome, existenteEm });
    });

  const enviar = async (arquivos: File[]) => {
    if (arquivos.length === 0) return;
    setErro(null);
    try {
      const salvos = await enviarParaRepositorio(
        blocoId,
        arquivos,
        categoriaEnvio,
        setProgresso,
        perguntarConflito
      );
      await carregar();
      // O que já está pronto entra na seleção agora; o resto, quando ficar pronto.
      const prontos = salvos.filter((d) => d.status === 'pronto').map((d) => d.id);
      if (prontos.length) aoMudarSelecao([...new Set([...selecionados, ...prontos])]);
      setAguardando((a) => [...new Set([...a, ...salvos.filter((d) => d.status !== 'pronto').map((d) => d.id)])]);
      setAba('repositorio');
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
        {(
          [
            ['repositorio', 'Do repositório'],
            ['enviar', 'Enviar novo'],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            className={cn(
              'flex-1 rounded-md px-3 py-1 text-sm transition',
              aba === id
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
            )}
            onClick={() => setAba(id)}
            aria-pressed={aba === id}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {aba === 'repositorio' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1">
              <IconeBusca className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                className="campo py-1.5 pl-8 text-sm"
                placeholder="Buscar documento…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                aria-label="Buscar documento"
              />
            </div>
            <select
              className="campo w-auto py-1.5 text-sm"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as CategoriaDocumento | 'sugeridas' | 'todas')}
              aria-label="Filtrar por categoria"
            >
              <option value="sugeridas">
                Sugeridas ({sugeridas.map((c) => rotuloCategoria(c)).join(', ')})
              </option>
              <option value="todas">Todas as categorias</option>
              {CATEGORIAS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </div>

          {carregando ? (
            <Carregando />
          ) : visiveis.length === 0 ? (
            <p className="py-3 text-sm text-zinc-500 dark:text-zinc-400">
              {documentos.length === 0
                ? 'O repositório deste bloco ainda está vazio.'
                : 'Nenhum documento nesta categoria. Escolha "Todas as categorias" para ver o resto.'}
            </p>
          ) : (
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              {visiveis.map((d) => {
                // O tamanho NUNCA desabilita a caixa. Só o status: um documento
                // que ainda está sendo processado, ou que falhou, não tem texto
                // para enviar — e o motivo fica sempre visível.
                const motivo = motivoIndisponivel(d);
                const situacao = situacaoDoDocumento(d);
                return (
                  <label
                    key={d.id}
                    className={cn(
                      'flex items-start gap-2 rounded px-1 py-1 text-sm',
                      motivo ? 'cursor-default' : 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    )}
                    title={motivo ?? d.nome_arquivo}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600"
                      checked={!motivo && selecionados.includes(d.id)}
                      disabled={Boolean(motivo)}
                      title={motivo ?? undefined}
                      aria-describedby={motivo ? `motivo-${d.id}` : undefined}
                      onChange={() => alternar(d.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate', motivo && 'text-zinc-500 dark:text-zinc-400')}>
                        {d.nome_arquivo}
                      </span>
                      {/* O motivo vai em linha própria: num nome longo, ele sumia no truncamento. */}
                      {motivo && situacao && (
                        <span
                          id={`motivo-${d.id}`}
                          className={cn(
                            'block text-xs',
                            d.status === 'falhou'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-zinc-500 dark:text-zinc-400'
                          )}
                        >
                          {situacao.texto}
                          {d.status === 'falhou' && situacao.detalhe ? ` — ${situacao.detalhe}` : ''}
                        </span>
                      )}
                    </span>
                    <Etiqueta>{rotuloCategoria(d.categoria)}</Etiqueta>
                  </label>
                );
              })}
            </div>
          )}

          {escolhidos.length > 0 && (
            <div className="space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              <p aria-label="Tamanho do que vai para a IA">
                {escolhidos.length} {escolhidos.length === 1 ? 'documento' : 'documentos'}
                {material?.porTrechos ? (
                  // Na lista, só vão os trechos do tópico — o tamanho do livro não importa.
                  <> · só os trechos relevantes do tópico vão para a IA (até {material.maxTrechos ?? 8})</>
                ) : material?.caracteres != null ? (
                  <> · {formatarCaracteres(material.caracteres)} vão para a IA</>
                ) : null}
              </p>
              {/* Só quando o conteúdo enviado passa do teto — e o fluxo já reduziu sozinho. */}
              {material?.aviso && <p>{material.aviso}</p>}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">Categoria</label>
            <select
              className="campo w-auto py-1.5 text-sm"
              value={categoriaEnvio}
              onChange={(e) => setCategoriaEnvio(e.target.value as CategoriaDocumento)}
              aria-label="Categoria do envio"
            >
              {CATEGORIAS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </div>
          <input
            ref={entradaArquivo}
            type="file"
            multiple
            accept={EXTENSOES_ACEITAS}
            className="hidden"
            onChange={(e) => void enviar([...(e.target.files ?? [])])}
          />
          <button className="btn-secundario" onClick={() => entradaArquivo.current?.click()}>
            <IconeUpload />
            Escolher arquivos
          </button>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            O arquivo entra no repositório do bloco e fica selecionado aqui assim que o processamento
            terminar. Até {LIMITE_ARQUIVO_MB} MB por arquivo.
          </p>
          <ListaProgresso progresso={progresso} />
          {erro && <Aviso tom="atencao">{erro}</Aviso>}
        </div>
      )}

      <ModalConflitoNome
        pedido={conflito}
        aoResponder={(r) => {
          setConflito(null);
          respostaConflito.current?.(r);
        }}
      />
    </div>
  );
}

export function ListaProgresso({ progresso }: { progresso: ProgressoEnvio[] }) {
  if (progresso.length === 0) return null;
  const texto: Record<ProgressoEnvio['estado'], string> = {
    enviando: 'enviando…',
    recebido: 'recebido — processando no servidor',
    reaproveitado: 'já estava no repositório',
    erro: 'não foi possível',
  };
  return (
    <ul className="space-y-1 text-xs">
      {progresso.map((p) => (
        <li key={p.nome} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{p.nome}</span>
          <span className="text-zinc-500 dark:text-zinc-400">{texto[p.estado]}</span>
          {/* Barra simples: em andamento, concluído ou parado. */}
          <span className="h-1 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <span
              className={cn(
                'block h-full rounded-full transition-all',
                p.estado === 'erro' ? 'w-full bg-zinc-400' : '',
                p.estado === 'enviando' ? 'w-1/2 bg-indigo-400' : '',
                p.estado === 'recebido' || p.estado === 'reaproveitado' ? 'w-full bg-indigo-500' : ''
              )}
            />
          </span>
          {p.detalhe && <span className="w-full text-zinc-400 dark:text-zinc-500">{p.detalhe}</span>}
        </li>
      ))}
    </ul>
  );
}
