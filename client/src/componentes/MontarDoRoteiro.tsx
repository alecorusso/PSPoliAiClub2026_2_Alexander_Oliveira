import { useEffect, useMemo, useState } from 'react';
import { api, apiAvaliacoes, apiCalendario, apiCronograma, apiEntregaveis } from '../api';
import type { Entregavel, Topico } from '../tipos';
import type { CasoHistorico } from '../lib/calibracao';
import { ORCAMENTO_PADRAO_MIN } from '../lib/cronograma';
import {
  capacidadeDaJanela,
  diferencaEmDias,
  distribuirDatas,
  margemPadraoEmDias,
  somarDias,
  type EntregavelComData,
  type EntregavelParaDistribuir,
} from '../lib/distribuicaoDatas';
import { titulosSemelhantes } from '../lib/importacao';
import { SeletorDocumentos } from './SeletorDocumentos';
import { apiDocumentos, apiVinculos } from '../api';
import { cn, formatarData, hojeISO, topicosParaLinhas } from '../util';
import { textoDuracao } from './CampoEstimativa';
import {
  Aviso,
  Carregando,
  Etiqueta,
  IconeBaixo,
  IconeChevron,
  IconeCima,
  IconeLixeira,
  IconeMais,
  Modal,
} from './ui';

/**
 * Montagem dos entregáveis a partir do roteiro do projeto.
 *
 * A IA decompõe e estima; as datas são calculadas aqui, por
 * `distribuirDatas`. Nada é gravado sem passar pela revisão, e qualquer edição
 * redistribui as datas na hora — sem nova ida à IA.
 */

/** Proposta em edição: o que a IA devolveu mais o que a revisão acrescenta. */
interface Proposta extends EntregavelParaDistribuir {
  descricao: string;
  topicos_ids: string[];
  trecho_origem: string;
  incluir: boolean;
  /** Minutos como a IA propôs; se mudar, a estimativa passa a ser do usuário. */
  tempoOriginal: number | null;
  duplicataDe: string | null;
}

type Etapa = 'entrada' | 'revisao' | 'fim';

export function ModalMontarDoRoteiro({
  aberto,
  blocoId,
  blocoNome,
  aoFechar,
  aoCriar,
  aoAbrirTabela,
}: {
  aberto: boolean;
  blocoId: string;
  blocoNome: string;
  aoFechar: () => void;
  aoCriar: () => void;
  /** Para adicionar os tópicos sugeridos: abre o editor da tabela. */
  aoAbrirTabela: () => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>('entrada');
  // O roteiro vem do repositório do bloco: a origem dos documentos é uma só.
  const [documentosIds, setDocumentosIds] = useState<string[]>([]);
  const [entregaFinal, setEntregaFinal] = useState('');
  const [inicio, setInicio] = useState(hojeISO());
  const [margem, setMargem] = useState('');
  const [margemTocada, setMargemTocada] = useState(false);
  // Se a entrega corresponde a uma avaliação, os entregáveis criados passam a
  // realizá-la: o trabalho fica neles, e ela sai da fila como item próprio.
  const [avaliacaoId, setAvaliacaoId] = useState('');
  const [avaliacoes, setAvaliacoes] = useState<{ id: string; titulo: string; data: string | null }[]>([]);

  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [topicosSugeridos, setTopicosSugeridos] = useState<string[]>([]);
  const [topicos, setTopicos] = useState<Topico[]>([]);
  const [tiposConhecidos, setTiposConhecidos] = useState<string[]>([]);
  const [historico, setHistorico] = useState<CasoHistorico[]>([]);
  const [orcamento, setOrcamento] = useState(ORCAMENTO_PADRAO_MIN);
  const [existentes, setExistentes] = useState<Entregavel[]>([]);

  const [expandida, setExpandida] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState('');


  useEffect(() => {
    if (!aberto) return;
    setEtapa('entrada');
    setDocumentosIds([]);
    setEntregaFinal('');
    setInicio(hojeISO());
    setMargem('');
    setMargemTocada(false);
    setAvaliacaoId('');
    setPropostas([]);
    setTopicosSugeridos([]);
    setExpandida(null);
    setErro(null);
    setResumo('');

    void api.listarTopicos(blocoId).then(setTopicos).catch(() => setTopicos([]));
    void apiAvaliacoes
      .listar(blocoId)
      .then((avs) =>
        setAvaliacoes(avs.map((a) => ({ id: a.id, titulo: a.titulo, data: a.data_prevista })))
      )
      .catch(() => setAvaliacoes([]));
    void api.tiposTarefa().then(setTiposConhecidos).catch(() => setTiposConhecidos([]));
    void apiEntregaveis.listar(blocoId).then(setExistentes).catch(() => setExistentes([]));
    void apiCronograma
      .dados()
      .then((d) => {
        setHistorico(d.historico);
        setOrcamento(Number(d.config?.orcamento_diario_min) || ORCAMENTO_PADRAO_MIN);
      })
      .catch(() => undefined);
  }, [aberto, blocoId]);

  // Margem padrão: uma fatia da janela, até o usuário mexer.
  const margemSugerida = useMemo(
    () => (entregaFinal ? margemPadraoEmDias(inicio, entregaFinal) : 0),
    [inicio, entregaFinal]
  );
  useEffect(() => {
    if (!margemTocada) setMargem(String(margemSugerida));
  }, [margemSugerida, margemTocada]);

  const margemDias = Number(margem) || 0;
  const fimComMargem = entregaFinal ? somarDias(entregaFinal, -margemDias) : '';

  const linhasTopicos = useMemo(() => topicosParaLinhas(topicos), [topicos]);
  const nomeDoTopico = useMemo(
    () => new Map(topicos.map((t) => [t.id, t.titulo])),
    [topicos]
  );

  // Recalcula as datas a cada edição de tempo, ordem ou travamento.
  const comDatas: EntregavelComData[] = useMemo(
    () => (fimComMargem ? distribuirDatas(propostas, inicio, fimComMargem, historico) : []),
    [propostas, inicio, fimComMargem, historico]
  );

  const incluidas = useMemo(
    () => comDatas.filter((_, i) => propostas[i]?.incluir),
    [comDatas, propostas]
  );
  const capacidade = useMemo(
    () => capacidadeDaJanela(incluidas, inicio, fimComMargem || inicio, orcamento),
    [incluidas, inicio, fimComMargem, orcamento]
  );

  const decompor = async () => {
    if (documentosIds.length === 0 || !entregaFinal) return;
    setOcupado('Lendo o roteiro…');
    setErro(null);
    try {
      const r = await api.decomporRoteiro({
        documentos_ids: documentosIds,
        bloco_id: blocoId,
        inicio,
        fim: entregaFinal,
      });
      // Falha da IA nunca bloqueia: a revisão abre e dá para montar à mão.
      if (r.erro) setErro(r.erro);
      setTopicosSugeridos(r.topicos_sugeridos);
      setPropostas(
        r.entregaveis.map((e, i) => {
          const igual = existentes.find((x) => titulosSemelhantes(x.titulo, e.nome));
          return {
            chave: `p-${i}-${e.nome}`,
            nome: e.nome,
            descricao: e.descricao,
            tipo_tarefa: e.tipo_tarefa,
            tempo_estimado_min: e.tempo_estimado_min,
            tempoOriginal: e.tempo_estimado_min,
            data_fixa: e.data_fixa,
            topicos_ids: e.topicos_ids,
            trecho_origem: e.trecho_origem,
            incluir: !igual,
            duplicataDe: igual?.titulo ?? null,
          };
        })
      );
      setEtapa('revisao');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const atualizar = (chave: string, mudanca: Partial<Proposta>) =>
    setPropostas((atuais) => atuais.map((p) => (p.chave === chave ? { ...p, ...mudanca } : p)));

  const mover = (indice: number, passo: number) =>
    setPropostas((atuais) => {
      const destino = indice + passo;
      if (destino < 0 || destino >= atuais.length) return atuais;
      const copia = [...atuais];
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });

  const alternarTravamento = (indice: number) => {
    const p = propostas[indice];
    // Travar congela a data que o cálculo deu; destravar devolve ao cálculo.
    atualizar(p.chave, { data_fixa: p.data_fixa ? null : comDatas[indice].data_entrega });
  };

  const confirmar = async () => {
    setOcupado('Gravando…');
    setErro(null);
    try {
      const criados: string[] = [];
      for (let i = 0; i < propostas.length; i++) {
        const p = propostas[i];
        if (!p.incluir || !p.nome.trim()) continue;
        const novo = await apiEntregaveis.criar(blocoId, {
          titulo: p.nome,
          descricao: p.descricao,
          tempo_estimado_horas: p.tempo_estimado_min ? p.tempo_estimado_min / 60 : null,
          // Manteve a sugestão da IA: 'llm'. Editou: virou julgamento do usuário
          // e passa a alimentar a calibração.
          origem_estimativa:
            p.tempo_estimado_min === null
              ? null
              : p.tempo_estimado_min === p.tempoOriginal
                ? 'llm'
                : 'exata',
          tipo_tarefa: p.tipo_tarefa,
          data_entrega: comDatas[i].data_entrega,
          topico_ids: p.topicos_ids,
        });
        criados.push(novo.id);
      }

      // A entrega final do projeto vira um evento, se ainda não houver um.
      const cal = await apiCalendario.itens();
      const jaExiste = cal.itens.some(
        (i) => i.data === entregaFinal && i.bloco_id === blocoId && titulosSemelhantes(i.titulo, `Entrega final — ${blocoNome}`)
      );
      if (!jaExiste) {
        await apiCalendario.criar({
          titulo: `Entrega final — ${blocoNome}`,
          tipo: 'entrega',
          bloco_id: blocoId,
          data_inicio: entregaFinal,
        });
      }

      // Registra de quais documentos a montagem saiu.
      await apiDocumentos.registrarUso(documentosIds, 'roteiro_projeto', blocoId);

      // Os entregáveis criados realizam a avaliação escolhida.
      if (avaliacaoId && criados.length > 0) {
        await apiVinculos.definirItens(
          avaliacaoId,
          criados.map((id) => ({ item_tipo: 'entregavel', item_id: id }))
        );
      }

      setResumo(
        `${criados.length} ${criados.length === 1 ? 'entregável criado' : 'entregáveis criados'} até a entrega final em ${formatarData(entregaFinal)}.`
      );
      setEtapa('fim');
      aoCriar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const marcadas = propostas.filter((p) => p.incluir).length;

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Montar a partir do roteiro"
      descricao={
        etapa === 'entrada'
          ? 'O roteiro do projeto vira uma sequência de entregáveis com datas.'
          : etapa === 'revisao'
            ? 'Confira antes de gravar. Nada é salvo sem sua confirmação.'
            : undefined
      }
      largura={etapa === 'revisao' ? 'max-w-5xl' : 'max-w-lg'}
    >
      {/* ---------------------------------------------------------------- */}
      {/* A. Entrada                                                        */}
      {/* ---------------------------------------------------------------- */}
      {etapa === 'entrada' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="rotulo">Entrega final</label>
              <input
                className="campo"
                type="date"
                value={entregaFinal}
                onChange={(e) => setEntregaFinal(e.target.value)}
                aria-label="Data da entrega final"
              />
            </div>
            <div>
              <label className="rotulo">Início</label>
              <input
                className="campo"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                aria-label="Data de início"
              />
            </div>
          </div>

          {avaliacoes.length > 0 && (
            <div>
              <label className="rotulo">Esta entrega corresponde à avaliação</label>
              <select
                className="campo"
                value={avaliacaoId}
                onChange={(e) => {
                  setAvaliacaoId(e.target.value);
                  // A data da avaliação vira a sugestão de entrega final.
                  const a = avaliacoes.find((x) => x.id === e.target.value);
                  if (a?.data) setEntregaFinal(a.data);
                }}
                aria-label="Avaliação correspondente"
              >
                <option value="">Nenhuma</option>
                {avaliacoes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.titulo || 'Avaliação sem nome'}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Opcional. Os entregáveis criados passam a realizar essa avaliação.
              </p>
            </div>
          )}

          <div className="sm:max-w-48">
            <label className="rotulo">Margem antes da entrega</label>
            <div className="flex items-center gap-2">
              <input
                className="campo w-20"
                type="number"
                min={0}
                value={margem}
                onChange={(e) => {
                  setMargemTocada(true);
                  setMargem(e.target.value);
                }}
                aria-label="Margem em dias"
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">dias</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Para o último entregável não cair no mesmo dia da entrega final.
            </p>
          </div>

          <div>
            <label className="rotulo">Roteiro do projeto</label>
            <SeletorDocumentos
              blocoId={blocoId}
              fluxo="roteiro_projeto"
              selecionados={documentosIds}
              aoMudarSelecao={setDocumentosIds}
            />
          </div>

          {erro && <Aviso tom="atencao">{erro}</Aviso>}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* D. Revisão                                                        */}
      {/* ---------------------------------------------------------------- */}
      {etapa === 'revisao' && (
        <div className="space-y-3">
          <LinhaDoTempo
            itens={comDatas}
            propostas={propostas}
            inicio={inicio}
            fim={entregaFinal}
          />

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              className="btn-sutil px-2 py-1"
              onClick={() =>
                setPropostas((a) => [
                  ...a,
                  {
                    chave: `manual-${Date.now()}`,
                    nome: '',
                    descricao: '',
                    tipo_tarefa: null,
                    tempo_estimado_min: null,
                    tempoOriginal: null,
                    data_fixa: null,
                    topicos_ids: [],
                    trecho_origem: '',
                    incluir: true,
                    duplicataDe: null,
                  },
                ])
              }
            >
              <IconeMais className="h-3 w-3" />
              Adicionar entregável
            </button>
            <span className="ml-auto text-zinc-500 dark:text-zinc-400">
              {marcadas} de {propostas.length} marcados
            </span>
          </div>

          {/* Aviso informativo: não impede confirmar, não cobra nada. */}
          {capacidade.excede && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              O tempo estimado total é maior que o disponível até a entrega pelo seu orçamento
              diário. ({textoDuracao(capacidade.totalMin)} estimados,{' '}
              {textoDuracao(capacidade.disponivelMin)} disponíveis em {capacidade.dias} dias.)
            </p>
          )}

          {topicosSugeridos.length > 0 && (
            <div className="rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-300">
                O roteiro menciona conhecimentos que não estão na tabela de conteúdos:{' '}
                <span className="font-medium">{topicosSugeridos.join(', ')}</span>
              </p>
              <button className="btn-secundario mt-1.5 py-1 text-xs" onClick={aoAbrirTabela}>
                Abrir a tabela de conteúdos
              </button>
            </div>
          )}

          {propostas.length === 0 ? (
            <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
              Nenhum entregável foi proposto. Você pode adicioná-los manualmente.
            </p>
          ) : (
            <div className="max-h-[26rem] overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              {propostas.map((p, i) => (
                <div
                  key={p.chave}
                  className="border-b border-zinc-100 p-2 last:border-0 dark:border-zinc-800/60"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-indigo-600"
                      checked={p.incluir}
                      onChange={(e) => atualizar(p.chave, { incluir: e.target.checked })}
                      aria-label={`Incluir ${p.nome || 'entregável'}`}
                    />
                    <span className="flex shrink-0 flex-col">
                      <button
                        className="btn-sutil px-1 py-0"
                        onClick={() => mover(i, -1)}
                        disabled={i === 0}
                        aria-label={`Subir ${p.nome || 'entregável'}`}
                      >
                        <IconeCima className="h-3 w-3" />
                      </button>
                      <button
                        className="btn-sutil px-1 py-0"
                        onClick={() => mover(i, 1)}
                        disabled={i === propostas.length - 1}
                        aria-label={`Descer ${p.nome || 'entregável'}`}
                      >
                        <IconeBaixo className="h-3 w-3" />
                      </button>
                    </span>
                    <input
                      className="campo min-w-40 flex-1 py-1 text-sm"
                      value={p.nome}
                      placeholder="Nome do entregável"
                      onChange={(e) => atualizar(p.chave, { nome: e.target.value })}
                      aria-label="Nome"
                    />
                    <input
                      className="campo w-36 py-1 text-sm"
                      list="tipos-do-roteiro"
                      value={p.tipo_tarefa ?? ''}
                      placeholder="Tipo de tarefa"
                      onChange={(e) => atualizar(p.chave, { tipo_tarefa: e.target.value || null })}
                      aria-label={`Tipo de tarefa de ${p.nome || 'entregável'}`}
                    />
                    <div className="flex items-center gap-1">
                      <input
                        className="campo w-20 py-1 text-sm"
                        type="number"
                        min={0}
                        step={15}
                        value={p.tempo_estimado_min ?? ''}
                        onChange={(e) =>
                          atualizar(p.chave, {
                            tempo_estimado_min: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        aria-label={`Tempo estimado de ${p.nome || 'entregável'}`}
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">min</span>
                    </div>
                    <button
                      className="btn-perigo px-1.5 py-1"
                      onClick={() => setPropostas((a) => a.filter((x) => x.chave !== p.chave))}
                      aria-label={`Remover ${p.nome || 'entregável'}`}
                    >
                      <IconeLixeira className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs">
                    <span className="text-zinc-600 dark:text-zinc-300">
                      {formatarData(comDatas[i]?.data_entrega ?? '')}
                    </span>
                    <button
                      className="text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
                      onClick={() => alternarTravamento(i)}
                      aria-label={`${p.data_fixa ? 'Destravar' : 'Travar'} a data de ${p.nome || 'entregável'}`}
                    >
                      {p.data_fixa ? 'fixa do roteiro — destravar' : 'calculada — travar'}
                    </button>
                    {p.duplicataDe && (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        já existe no bloco: <span className="font-medium">{p.duplicataDe}</span>
                      </span>
                    )}
                    {p.topicos_ids.length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {p.topicos_ids.map((id) => (
                          <Etiqueta key={id}>{nomeDoTopico.get(id) ?? '—'}</Etiqueta>
                        ))}
                      </span>
                    )}
                    <button
                      className="flex items-center gap-1 text-zinc-500 hover:underline dark:text-zinc-400"
                      onClick={() => setExpandida(expandida === p.chave ? null : p.chave)}
                      aria-expanded={expandida === p.chave}
                    >
                      <IconeChevron
                        className={cn('h-3 w-3 transition', expandida === p.chave && 'rotate-90')}
                      />
                      detalhes
                    </button>
                  </div>

                  {expandida === p.chave && (
                    <div className="surgir mt-2 space-y-2 pl-6">
                      <div>
                        <label className="rotulo">Descrição</label>
                        <textarea
                          className="campo resize-none text-sm"
                          rows={2}
                          value={p.descricao}
                          onChange={(e) => atualizar(p.chave, { descricao: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="rotulo">Tópicos associados</label>
                        {linhasTopicos.length === 0 ? (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Este bloco ainda não tem tópicos.
                          </p>
                        ) : (
                          <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                            {linhasTopicos.map((l) => (
                              <label
                                key={l.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                style={{ paddingLeft: 4 + l.nivel * 14 }}
                              >
                                <input
                                  type="checkbox"
                                  className="h-3 w-3 shrink-0 accent-indigo-600"
                                  checked={p.topicos_ids.includes(l.id)}
                                  onChange={(e) =>
                                    atualizar(p.chave, {
                                      topicos_ids: e.target.checked
                                        ? [...p.topicos_ids, l.id]
                                        : p.topicos_ids.filter((x) => x !== l.id),
                                    })
                                  }
                                />
                                <span className="truncate">{l.titulo}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {p.trecho_origem && (
                        <p className="rounded bg-zinc-100 px-2 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                          {p.trecho_origem}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <datalist id="tipos-do-roteiro">
            {tiposConhecidos.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          {erro && <Aviso tom="atencao">{erro}</Aviso>}
        </div>
      )}

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
              onClick={() => void decompor()}
              disabled={documentosIds.length === 0 || !entregaFinal || Boolean(ocupado)}
            >
              Ler roteiro
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
              Criar {marcadas} {marcadas === 1 ? 'entregável' : 'entregáveis'}
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

/** Linha do tempo compacta: onde cada entregável cai até a entrega final. */
function LinhaDoTempo({
  itens,
  propostas,
  inicio,
  fim,
}: {
  itens: EntregavelComData[];
  propostas: Proposta[];
  inicio: string;
  fim: string;
}) {
  const janela = Math.max(1, diferencaEmDias(inicio, fim));
  if (itens.length === 0) return null;

  return (
    <div>
      <div className="relative h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800/60">
        {itens.map((e, i) => {
          if (!propostas[i]?.incluir) return null;
          const fracao = Math.min(1, Math.max(0, diferencaEmDias(inicio, e.data_entrega) / janela));
          return (
            <span
              key={e.chave}
              title={`${e.nome || 'entregável'} · ${formatarData(e.data_entrega)}`}
              className={cn(
                'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                e.travada
                  ? 'h-4 w-1.5 bg-zinc-900 dark:bg-zinc-100'
                  : 'h-2.5 w-2.5 bg-indigo-500'
              )}
              style={{ left: `${fracao * 100}%` }}
            />
          );
        })}
        {/* A entrega final fecha a linha. */}
        <span className="absolute right-0 top-1/2 h-5 w-0.5 -translate-y-1/2 bg-zinc-400 dark:bg-zinc-500" />
      </div>
      <div className="mt-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{formatarData(inicio)}</span>
        <span>entrega final · {formatarData(fim)}</span>
      </div>
    </div>
  );
}
