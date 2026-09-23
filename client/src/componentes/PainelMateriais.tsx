import { useMemo, useRef, useState } from 'react';
import { apiDocumentos } from '../api';
import {
  CATEGORIAS,
  formatarTamanho,
  LIMITE_ARQUIVO_MB,
  rotuloCategoria,
  situacaoDoDocumento,
  textoDosUsos,
  type CategoriaDocumento,
  type Documento,
} from '../lib/documentos';
import { usarDocumentos } from '../estado/usarDocumentos';
import { EXTENSOES_ACEITAS } from '../extrairTexto';
import { cn, formatarData } from '../util';
import {
  enviarParaRepositorio,
  ListaProgresso,
  ModalConflitoNome,
  type ProgressoEnvio,
} from './SeletorDocumentos';
import {
  Aviso,
  Carregando,
  Confirmacao,
  Etiqueta,
  IconeBusca,
  IconeLapis,
  IconeLixeira,
  IconeUpload,
  Vazio,
} from './ui';

/**
 * Materiais: o repositório de documentos do bloco.
 *
 * É a origem única dos documentos — todos os fluxos que usam material do bloco
 * leem daqui. Excluir um documento nunca apaga o que foi gerado a partir dele.
 */
export function PainelMateriais({ blocoId }: { blocoId: string }) {
  // Enquanto algo está sendo processado no servidor, a lista se atualiza sozinha.
  const { documentos, carregando, erro: erroAoCarregar, recarregar: carregar } = usarDocumentos(blocoId);
  const [indexando, setIndexando] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<CategoriaDocumento | 'todas'>('todas');
  const [categoriaEnvio, setCategoriaEnvio] = useState<CategoriaDocumento>('outro');

  const [progresso, setProgresso] = useState<ProgressoEnvio[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [conflito, setConflito] = useState<{ nome: string; existenteEm: string } | null>(null);
  const [excluindo, setExcluindo] = useState<Documento | null>(null);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState('');
  const [texto, setTexto] = useState('');
  const [colando, setColando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const respostaConflito = useRef<((r: 'substituir' | 'manter' | null) => void) | null>(null);
  const entradaArquivo = useRef<HTMLInputElement | null>(null);

  // Documentos sem trechos, que falharam ou com a indexação incompleta.
  const aIndexar = documentos.filter((d) => d.precisa_indexar && d.status !== 'processando');

  const indexar = async () => {
    setErro(null);
    setIndexando(true);
    try {
      await apiDocumentos.indexar(blocoId);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setIndexando(false);
    }
  };

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return documentos.filter(
      (d) =>
        (!termo || d.nome_arquivo.toLowerCase().includes(termo)) &&
        (filtro === 'todas' || d.categoria === filtro)
    );
  }, [documentos, busca, filtro]);

  const perguntarConflito = (nome: string, existenteEm: string) =>
    new Promise<'substituir' | 'manter' | null>((resolve) => {
      respostaConflito.current = resolve;
      setConflito({ nome, existenteEm });
    });

  const enviar = async (arquivos: File[]) => {
    if (arquivos.length === 0) return;
    setErro(null);
    await enviarParaRepositorio(blocoId, arquivos, categoriaEnvio, setProgresso, perguntarConflito);
    await carregar();
  };

  const colar = async () => {
    if (!texto.trim()) return;
    setErro(null);
    try {
      const r = await apiDocumentos.enviar(blocoId, [
        {
          nome_arquivo: `Texto colado — ${formatarData(new Date().toISOString())}`,
          conteudo_texto: texto,
          categoria: categoriaEnvio,
        },
      ]);
      const primeiro = r.documentos[0];
      if (primeiro && 'reaproveitado' in primeiro && primeiro.reaproveitado) {
        setProgresso([
          {
            nome: primeiro.nome_arquivo,
            estado: 'reaproveitado',
            detalhe: 'Este documento já estava no repositório.',
          },
        ]);
      }
      setTexto('');
      setColando(false);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const renomear = async (d: Documento) => {
    if (nomeEditado.trim() && nomeEditado !== d.nome_arquivo) {
      await apiDocumentos.atualizar(d.id, { nome_arquivo: nomeEditado.trim() });
      await carregar();
    }
    setRenomeando(null);
  };

  return (
    <div className="space-y-4">
      {/* Área de envio: vários arquivos de uma vez, ou arrastados para cá. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          void enviar([...e.dataTransfer.files]);
        }}
        className={cn(
          'rounded-xl border border-dashed p-4 text-center transition',
          arrastando
            ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-500/10'
            : 'border-zinc-300 dark:border-zinc-700'
        )}
      >
        <input
          ref={entradaArquivo}
          type="file"
          multiple
          accept={EXTENSOES_ACEITAS}
          className="hidden"
          onChange={(e) => void enviar([...(e.target.files ?? [])])}
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button className="btn-secundario" onClick={() => entradaArquivo.current?.click()}>
            <IconeUpload />
            Escolher arquivos
          </button>
          <button className="btn-sutil px-2 py-1 text-xs" onClick={() => setColando((v) => !v)}>
            ou colar texto
          </button>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            categoria
            <select
              className="campo w-auto py-1 text-xs"
              value={categoriaEnvio}
              onChange={(e) => setCategoriaEnvio(e.target.value as CategoriaDocumento)}
              aria-label="Categoria dos arquivos enviados"
            >
              {CATEGORIAS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Arraste arquivos para cá, ou escolha vários de uma vez. (.pdf, .txt, .md, .docx — até{' '}
          {LIMITE_ARQUIVO_MB} MB cada)
        </p>

        {colando && (
          <div className="surgir mt-3 space-y-2 text-left">
            <textarea
              className="campo resize-y font-mono text-xs"
              rows={5}
              placeholder="Cole aqui o texto do material."
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              aria-label="Texto colado"
            />
            <button className="btn-primario py-1.5" onClick={() => void colar()} disabled={!texto.trim()}>
              Guardar no repositório
            </button>
          </div>
        )}

        {progresso.length > 0 && (
          <div className="mt-3 text-left">
            <ListaProgresso progresso={progresso} />
          </div>
        )}
      </div>

      {(erro ?? erroAoCarregar) && <Aviso tom="atencao">{erro ?? erroAoCarregar}</Aviso>}

      {/* Documentos antigos, falhas e indexações incompletas: processar de novo. */}
      {aIndexar.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {aIndexar.length === 1
              ? '1 documento ainda não está totalmente indexado.'
              : `${aIndexar.length} documentos ainda não estão totalmente indexados.`}
          </span>
          <button className="btn-secundario py-1 text-xs" onClick={() => void indexar()} disabled={indexando}>
            Indexar documentos
          </button>
        </div>
      )}

      {/* Busca e filtro */}
      {documentos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-44 flex-1">
            <IconeBusca className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              className="campo py-1.5 pl-8 text-sm"
              placeholder="Buscar por nome…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar material"
            />
          </div>
          <select
            className="campo w-auto py-1.5 text-sm"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as CategoriaDocumento | 'todas')}
            aria-label="Filtrar materiais por categoria"
          >
            <option value="todas">Todas as categorias</option>
            {CATEGORIAS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </div>
      )}

      {carregando ? (
        <Carregando />
      ) : documentos.length === 0 ? (
        <Vazio
          icone={<IconeUpload className="h-7 w-7" />}
          titulo="Nenhum material ainda"
          descricao="Envie a ementa, listas, provas antigas ou o roteiro do projeto. Todos os fluxos que usam documentos leem daqui."
        />
      ) : visiveis.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Nenhum material com esse nome ou nessa categoria.
        </p>
      ) : (
        <ul className="cartao divide-y divide-zinc-200 px-3 dark:divide-zinc-800">
          {visiveis.map((d) => (
            <LinhaDocumento key={d.id} d={d}>
              <div className="min-w-0 flex-1">
                {renomeando === d.id ? (
                  <input
                    className="campo py-1 text-sm"
                    value={nomeEditado}
                    autoFocus
                    onChange={(e) => setNomeEditado(e.target.value)}
                    onBlur={() => void renomear(d)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenomeando(null);
                    }}
                    aria-label={`Novo nome de ${d.nome_arquivo}`}
                  />
                ) : (
                  <p className="truncate text-sm font-medium">{d.nome_arquivo}</p>
                )}
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <Etiqueta>{rotuloCategoria(d.categoria)}</Etiqueta>
                  <span>{formatarData(d.criado_em)}</span>
                  <span>{formatarTamanho(d.tamanho_bytes)}</span>
                  {d.paginas ? <span>{d.paginas} páginas</span> : null}
                  <span>{textoDosUsos(d.usos)}</span>
                </p>
                <SituacaoDocumento d={d} />
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <select
                  className="campo w-auto py-1 text-xs"
                  value={d.categoria}
                  onChange={async (e) => {
                    await apiDocumentos.atualizar(d.id, {
                      categoria: e.target.value as CategoriaDocumento,
                    });
                    await carregar();
                  }}
                  aria-label={`Categoria de ${d.nome_arquivo}`}
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.rotulo}
                    </option>
                  ))}
                </select>
                <a
                  className="btn-sutil px-2 py-1 text-xs"
                  href={apiDocumentos.urlDoArquivo(d.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir
                </a>
                <button
                  className="btn-sutil px-1.5 py-1"
                  onClick={() => {
                    setRenomeando(d.id);
                    setNomeEditado(d.nome_arquivo);
                  }}
                  aria-label={`Renomear ${d.nome_arquivo}`}
                  title="Renomear"
                >
                  <IconeLapis className="h-3.5 w-3.5" />
                </button>
                <button
                  className="btn-perigo px-1.5 py-1"
                  onClick={() => setExcluindo(d)}
                  aria-label={`Excluir ${d.nome_arquivo}`}
                  title="Excluir"
                >
                  <IconeLixeira className="h-3.5 w-3.5" />
                </button>
              </div>
            </LinhaDocumento>
          ))}
        </ul>
      )}

      <ModalConflitoNome
        pedido={conflito}
        aoResponder={(r) => {
          setConflito(null);
          respostaConflito.current?.(r);
        }}
      />

      <Confirmacao
        aberto={excluindo !== null}
        titulo="Excluir este material?"
        mensagem={
          (excluindo?.usos.length ?? 0) > 0
            ? `O que já foi gerado a partir de ${excluindo?.nome_arquivo} continua como está — listas, tabelas e entregáveis não são afetados. Só a referência passa a aparecer como "documento removido".`
            : `${excluindo?.nome_arquivo} sai do repositório deste bloco.`
        }
        rotuloConfirmar="Excluir"
        perigo
        aoConfirmar={async () => {
          if (excluindo) await apiDocumentos.excluir(excluindo.id);
          setExcluindo(null);
          await carregar();
        }}
        aoCancelar={() => setExcluindo(null)}
      />
    </div>
  );
}

function LinhaDocumento({ d, children }: { d: Documento; children: React.ReactNode }) {
  return (
    <li
      className={cn('flex flex-wrap items-center gap-2 py-2.5', d.status === 'processando' && 'opacity-80')}
      aria-busy={d.status === 'processando'}
    >
      {children}
    </li>
  );
}

/**
 * Status do processamento: "lendo o arquivo: 120 de 557 páginas",
 * "indexando: 120 de 400 trechos", ou o motivo de uma falha. Some quando o
 * documento está pronto e não há nada a dizer.
 */
function SituacaoDocumento({ d }: { d: Documento }) {
  const s = situacaoDoDocumento(d);
  if (!s) return null;
  const falhou = d.status === 'falhou';
  const progresso =
    (d.status === 'processando' || d.etapa === 'indexando') && d.progresso_total
      ? (d.progresso_feito ?? 0) / d.progresso_total
      : null;
  return (
    <div className="mt-1 space-y-1 text-xs">
      <p className={cn(falhou ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400')}>
        {s.texto}
        {s.detalhe && <span className="text-zinc-400 dark:text-zinc-500"> — {s.detalhe}</span>}
      </p>
      {progresso !== null && (
        <span className="block h-1 w-40 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <span className="block h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.round(progresso * 100)}%` }} />
        </span>
      )}
    </div>
  );
}
