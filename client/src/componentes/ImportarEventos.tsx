import { useEffect, useMemo, useState } from 'react';
import { api, apiCalendario, apiEntregaveis } from '../api';
import type { Bloco } from '../tipos';
import type { ItemCalendario } from '../lib/calendario';
import {
  destinoDoItem,
  linhaVazia,
  precisaConferir,
  prepararLinhas,
  resumirImportacao,
  temProvasSemWrapper,
  textoDoResumo,
  type LinhaImportacao,
  type TipoExtraido,
} from '../lib/importacao';
import { SeletorDocumentos } from './SeletorDocumentos';
import { apiDocumentos } from '../api';
import { cn } from '../util';
import {
  Aviso,
  Carregando,
  Etiqueta,
  IconeBusca,
  IconeChevron,
  IconeLixeira,
  IconeMais,
  Modal,
} from './ui';

/**
 * Importação de eventos a partir de um documento.
 *
 * A IA propõe; nada é gravado sem passar pela tela de revisão. Data incerta é
 * sinalizada, nunca apresentada como certa, e provável duplicata vem
 * desmarcada — o mesmo compromisso não pode existir duas vezes.
 */

const TIPOS: { id: TipoExtraido; rotulo: string }[] = [
  { id: 'prova', rotulo: 'Prova' },
  { id: 'entrega', rotulo: 'Entrega' },
  { id: 'aula', rotulo: 'Aula' },
  { id: 'outro', rotulo: 'Outro' },
];

type Etapa = 'entrada' | 'revisao' | 'fim';

export function ModalImportarEventos({
  aberto,
  itensDoCalendario,
  aoFechar,
  aoImportar,
}: {
  aberto: boolean;
  /** Para detectar duplicatas antes de mostrar a revisão. */
  itensDoCalendario: ItemCalendario[];
  aoFechar: () => void;
  aoImportar: () => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>('entrada');
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [blocoId, setBlocoId] = useState('');
  const [escolheuBloco, setEscolheuBloco] = useState(false);
  const [busca, setBusca] = useState('');
  const [inicioPeriodo, setInicioPeriodo] = useState('');
  // O documento vem do repositório do bloco; sem bloco, é texto colado.
  const [documentosIds, setDocumentosIds] = useState<string[]>([]);
  const [texto, setTexto] = useState('');

  const [linhas, setLinhas] = useState<LinhaImportacao[]>([]);
  const [incluirAulas, setIncluirAulas] = useState(false);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<string>('');


  useEffect(() => {
    if (!aberto) return;
    setEtapa('entrada');
    setBlocoId('');
    setEscolheuBloco(false);
    setBusca('');
    setInicioPeriodo('');
    setTexto('');
    setDocumentosIds([]);
    setLinhas([]);
    setIncluirAulas(false);
    setErro(null);
    setResumo('');
    api.listarBlocos().then(setBlocos).catch(() => setBlocos([]));
  }, [aberto]);

  const bloco = blocos.find((b) => b.id === blocoId) ?? null;
  const temWrapper = bloco?.wrapper_academico === 1;

  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return [];
    return blocos.filter((b) => b.nome.toLowerCase().includes(termo)).slice(0, 6);
  }, [busca, blocos]);

  /** Lê o documento e leva para a revisão. Nada é gravado aqui. */
  const extrair = async (comAulas = incluirAulas) => {
    if (documentosIds.length === 0 && !texto.trim()) {
      setErro('Escolha um documento do repositório ou cole o texto.');
      return;
    }
    setOcupado('Lendo o documento…');
    setErro(null);
    try {
      const r = await api.extrairEventos({
        texto: documentosIds.length > 0 ? '' : texto,
        documentos_ids: documentosIds,
        bloco_id: blocoId || null,
        inicio_periodo: inicioPeriodo || null,
        incluir_aulas: comAulas,
      });
      // Falha da IA nunca bloqueia: a revisão abre vazia e dá para adicionar à mão.
      if (r.erro) setErro(r.erro);
      const doBloco = itensDoCalendario.filter((i) => (blocoId ? i.bloco_id === blocoId : true));
      setLinhas(prepararLinhas(r.eventos, doBloco));
      setEtapa('revisao');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const atualizar = (chave: string, mudanca: Partial<LinhaImportacao>) =>
    setLinhas((atuais) => atuais.map((l) => (l.chave === chave ? { ...l, ...mudanca } : l)));

  const ativarWrapper = async () => {
    if (!blocoId) return;
    await api.atualizarBloco(blocoId, { wrapper_academico: true });
    setBlocos((atuais) =>
      atuais.map((b) => (b.id === blocoId ? { ...b, wrapper_academico: 1 } : b))
    );
  };

  const confirmar = async () => {
    setOcupado('Gravando…');
    setErro(null);
    try {
      for (const l of linhas) {
        if (!l.incluir || !l.data || !l.titulo.trim()) continue;
        const destino = destinoDoItem(l, temWrapper);

        if (destino === 'entregavel' && blocoId) {
          await apiEntregaveis.criar(blocoId, { titulo: l.titulo, data_entrega: l.data });
          continue;
        }
        // Prova de disciplina vira avaliação no próprio servidor: é a mesma
        // regra de unificação do calendário, num lugar só.
        await apiCalendario.criar({
          titulo: l.titulo,
          tipo: l.tipo,
          bloco_id: blocoId || null,
          data_inicio: l.data,
        });
      }
      if (blocoId && documentosIds.length > 0) {
        await apiDocumentos.registrarUso(documentosIds, 'importacao_calendario', blocoId);
      }
      setResumo(textoDoResumo(resumirImportacao(linhas, temWrapper)));
      setEtapa('fim');
      aoImportar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const marcadas = linhas.filter((l) => l.incluir && l.data).length;

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Importar de documento"
      descricao={
        etapa === 'entrada'
          ? 'Calendário de disciplina, cronograma de curso ou programação.'
          : etapa === 'revisao'
            ? 'Confira antes de gravar. Nada é salvo sem sua confirmação.'
            : undefined
      }
      largura={etapa === 'revisao' ? 'max-w-4xl' : 'max-w-lg'}
    >
      {/* ---------------------------------------------------------------- */}
      {/* A. Entrada                                                        */}
      {/* ---------------------------------------------------------------- */}
      {etapa === 'entrada' && (
        <div className="space-y-4">
          <div>
            <label className="rotulo">Bloco</label>
            {escolheuBloco ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{bloco?.nome ?? 'Sem bloco'}</span>
                <button
                  className="btn-sutil px-2 py-0.5 text-xs"
                  onClick={() => {
                    setEscolheuBloco(false);
                    setBlocoId('');
                    setBusca('');
                  }}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <IconeBusca className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    className="campo pl-9"
                    placeholder="Buscar bloco pelo nome…"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    aria-label="Buscar bloco"
                  />
                </div>
                {resultados.length > 0 && (
                  <div className="cartao mt-1 divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
                    {resultados.map((b) => (
                      <button
                        key={b.id}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => {
                          setBlocoId(b.id);
                          setEscolheuBloco(true);
                        }}
                      >
                        {b.nome}
                        {b.wrapper_academico === 1 && (
                          <span className="text-zinc-500 dark:text-zinc-400"> · disciplina</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="btn-sutil mt-1 px-2 py-1 text-xs"
                  onClick={() => {
                    setBlocoId('');
                    setEscolheuBloco(true);
                  }}
                >
                  Sem bloco (programação geral)
                </button>
              </>
            )}
          </div>

          <div>
            <label className="rotulo">Início do período letivo</label>
            <input
              className="campo"
              type="date"
              value={inicioPeriodo}
              onChange={(e) => setInicioPeriodo(e.target.value)}
              aria-label="Início do período letivo"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Opcional. Serve para resolver datas relativas como "semana 5" ou "aula 12".
            </p>
          </div>

          <div>
            <label className="rotulo">Documento</label>
            {blocoId ? (
              <SeletorDocumentos
                blocoId={blocoId}
                fluxo="importacao_calendario"
                selecionados={documentosIds}
                aoMudarSelecao={setDocumentosIds}
              />
            ) : (
              // Programação geral não pertence a bloco nenhum: não há
              // repositório onde guardar, então segue o texto colado.
              <textarea
                className="campo resize-y font-mono text-xs"
                rows={7}
                placeholder="Cole aqui o texto da programação."
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                aria-label="Texto do documento"
              />
            )}
          </div>

          {erro && <Aviso tom="atencao">{erro}</Aviso>}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* C. Revisão                                                        */}
      {/* ---------------------------------------------------------------- */}
      {etapa === 'revisao' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                checked={incluirAulas}
                onChange={(e) => {
                  setIncluirAulas(e.target.checked);
                  void extrair(e.target.checked);
                }}
              />
              Incluir aulas regulares
            </label>
            <button
              className="btn-sutil px-2 py-1 text-xs"
              onClick={() =>
                setLinhas((atuais) => [...atuais, linhaVazia(`manual-${Date.now()}`)])
              }
            >
              <IconeMais className="h-3 w-3" />
              Adicionar linha
            </button>
            <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
              {marcadas} de {linhas.length} marcados
            </span>
          </div>

          {/* Sugestão discreta: provas indo para evento só por falta de wrapper. */}
          {temProvasSemWrapper(linhas, temWrapper) && blocoId && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
              <span>Este bloco tem provas; ativar o wrapper acadêmico?</span>
              <button className="btn-secundario py-1 text-xs" onClick={() => void ativarWrapper()}>
                Ativar wrapper
              </button>
            </div>
          )}

          {linhas.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
              Nenhum evento foi identificado. Você pode adicionar linhas manualmente.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              {linhas.map((l) => (
                <div
                  key={l.chave}
                  className="border-b border-zinc-100 p-2 last:border-0 dark:border-zinc-800/60"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-indigo-600"
                      checked={l.incluir}
                      onChange={(e) => atualizar(l.chave, { incluir: e.target.checked })}
                      aria-label={`Incluir ${l.titulo || 'linha'}`}
                    />
                    <input
                      className="campo min-w-40 flex-1 py-1 text-sm"
                      value={l.titulo}
                      placeholder="Nome do evento"
                      onChange={(e) => atualizar(l.chave, { titulo: e.target.value })}
                      aria-label="Título"
                    />
                    <input
                      className="campo w-36 py-1 text-sm"
                      type="date"
                      value={l.data ?? ''}
                      onChange={(e) => atualizar(l.chave, { data: e.target.value || null })}
                      aria-label={`Data de ${l.titulo || 'linha'}`}
                    />
                    <input
                      className="campo w-24 py-1 text-sm"
                      type="time"
                      value={l.hora ?? ''}
                      onChange={(e) => atualizar(l.chave, { hora: e.target.value || null })}
                      aria-label="Hora"
                    />
                    <select
                      className="campo w-28 py-1 text-sm"
                      value={l.tipo}
                      onChange={(e) => atualizar(l.chave, { tipo: e.target.value as TipoExtraido })}
                      aria-label={`Tipo de ${l.titulo || 'linha'}`}
                    >
                      {TIPOS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.rotulo}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-perigo px-1.5 py-1"
                      onClick={() => setLinhas((a) => a.filter((x) => x.chave !== l.chave))}
                      aria-label={`Remover ${l.titulo || 'linha'}`}
                    >
                      <IconeLixeira className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs">
                    {/* Data incerta: sinalizada de forma discreta, nunca escondida. */}
                    {precisaConferir(l) && (
                      <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                        <span aria-hidden="true">◦</span>
                        {l.data === null ? 'sem data identificada — confira a data' : 'confira a data'}
                      </span>
                    )}
                    {l.duplicataDe && (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        já existe no calendário:{' '}
                        <span className="font-medium">{l.duplicataDe.titulo}</span>
                      </span>
                    )}
                    {l.tipo === 'prova' && temWrapper && (
                      <Etiqueta>vira avaliação do bloco</Etiqueta>
                    )}
                    {l.tipo === 'entrega' && blocoId && (
                      <label className="flex cursor-pointer items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 accent-indigo-600"
                          checked={l.virarEntregavel}
                          onChange={(e) =>
                            atualizar(l.chave, { virarEntregavel: e.target.checked })
                          }
                        />
                        Criar como entregável do modo projeto
                      </label>
                    )}
                    {l.trecho_origem && (
                      <button
                        className="flex items-center gap-1 text-zinc-500 hover:underline dark:text-zinc-400"
                        onClick={() => setExpandida(expandida === l.chave ? null : l.chave)}
                        aria-expanded={expandida === l.chave}
                      >
                        <IconeChevron
                          className={cn('h-3 w-3 transition', expandida === l.chave && 'rotate-90')}
                        />
                        trecho de origem
                      </button>
                    )}
                  </div>

                  {expandida === l.chave && l.trecho_origem && (
                    <p className="surgir mt-1 rounded bg-zinc-100 px-2 py-1.5 pl-6 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                      {l.trecho_origem}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {erro && <Aviso tom="atencao">{erro}</Aviso>}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Fim                                                               */}
      {/* ---------------------------------------------------------------- */}
      {etapa === 'fim' && <p className="py-2 text-sm">{resumo}</p>}

      <div className="mt-5 flex items-center justify-end gap-3">
        {ocupado && <Carregando texto={ocupado} />}
        {etapa === 'entrada' && (
          <>
            <button className="btn-secundario" onClick={aoFechar}>
              Cancelar
            </button>
            <button
              className="btn-primario"
              onClick={() => void extrair()}
              disabled={
                !escolheuBloco ||
                (documentosIds.length === 0 && !texto.trim()) ||
                Boolean(ocupado)
              }
            >
              Ler documento
            </button>
          </>
        )}
        {etapa === 'revisao' && (
          <>
            <button className="btn-secundario" onClick={() => setEtapa('entrada')}>
              Voltar
            </button>
            <button
              className="btn-primario"
              onClick={() => void confirmar()}
              disabled={marcadas === 0 || Boolean(ocupado)}
            >
              Importar {marcadas > 0 ? `${marcadas} ${marcadas === 1 ? 'item' : 'itens'}` : ''}
            </button>
          </>
        )}
        {etapa === 'fim' && (
          <button className="btn-primario" onClick={aoFechar}>
            Fechar
          </button>
        )}
      </div>
    </Modal>
  );
}
