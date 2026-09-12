import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiEntregaveis, apiListas } from '../api';
import type { Bloco, Entregavel, ListaQuestoes, SugestaoEntregavel, Topico } from '../tipos';
import {
  cn,
  diasRelativos,
  formatarData,
  hojeISO,
  topicosParaLinhas,
} from '../util';
import { ModalCriarLista } from '../componentes/ModaisLista';
import { VisualizadorLista } from '../componentes/VisualizadorLista';
import { LinhaLista } from './ModoProva';
import {
  Aviso,
  Carregando,
  Etiqueta,
  IconeBussola,
  IconeLista,
  IconeMais,
  IconeLixeira,
  IconeX,
  Modal,
  Vazio,
} from '../componentes/ui';

/** Limite rígido de testes gerados de uma vez ao concluir um entregável. */
const LIMITE_TESTES = 3;

export function ModoProjeto({
  bloco,
  aoCorrigir,
  aoAtualizarBloco,
}: {
  bloco: Bloco;
  aoCorrigir: (lista: ListaQuestoes) => Promise<void>;
  aoAtualizarBloco: () => void;
}) {
  const [topicos, setTopicos] = useState<Topico[]>([]);
  const [entregaveis, setEntregaveis] = useState<Entregavel[]>([]);
  const [testes, setTestes] = useState<ListaQuestoes[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [novoAberto, setNovoAberto] = useState(false);
  const [editando, setEditando] = useState<Entregavel | null>(null);
  const [reagendando, setReagendando] = useState<Entregavel | null>(null);
  const [excluindo, setExcluindo] = useState<Entregavel | null>(null);
  const [pedindoTeste, setPedindoTeste] = useState(false);
  const [abertaLista, setAbertaLista] = useState<ListaQuestoes | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [t, e, l] = await Promise.all([
      api.listarTopicos(bloco.id),
      apiEntregaveis.listar(bloco.id),
      apiListas.listar(bloco.id, 'projeto'),
    ]);
    setTopicos(t);
    setEntregaveis(e);
    setTestes(l);
    setCarregando(false);
    return l;
  }, [bloco.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const concluidos = entregaveis.filter((e) => e.concluido === 1).length;

  const alternarConcluido = async (e: Entregavel) => {
    setRecado(null);
    const r = await apiEntregaveis.concluir(e.id, e.concluido !== 1);
    await carregar();
    if (r.erro) setRecado(r.erro);
    else if (r.testes_gerados.length > 0) {
      setRecado(
        `${r.testes_gerados.length} ${r.testes_gerados.length === 1 ? 'teste teórico foi gerado' : 'testes teóricos foram gerados'} na seção abaixo.`
      );
    }
  };

  const alternarSugestaoAutomatica = async () => {
    await api.atualizarBloco(bloco.id, { sugerir_testes_auto: bloco.sugerir_testes_auto !== 1 });
    aoAtualizarBloco();
  };

  const aoMudarLista = async () => {
    const atualizadas = await carregar();
    setAbertaLista((atual) => (atual ? (atualizadas.find((l) => l.id === atual.id) ?? null) : null));
  };

  if (carregando) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 py-6">
      {/* ===================== ENTREGÁVEIS ===================== */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Entregáveis
          </h2>
          <div className="flex gap-2">
            <button className="btn-secundario py-1.5" onClick={() => setNovoAberto(true)}>
              <IconeMais className="h-3.5 w-3.5" />
              Novo entregável
            </button>
          </div>
        </div>

        {/* Contagem pura — nunca percentual de domínio, nota ou nível. */}
        {entregaveis.length > 0 && (
          <div className="mb-4">
            <p className="mb-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {concluidos} de {entregaveis.length} entregáveis concluídos
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${(concluidos / entregaveis.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {recado && (
          <div className="mb-4">
            <Aviso>{recado}</Aviso>
          </div>
        )}

        {entregaveis.length === 0 ? (
          <Vazio
            icone={<IconeLista className="h-7 w-7" />}
            titulo="Nenhum entregável ainda"
            descricao="Crie os entregáveis do projeto, ou peça sugestões à IA abaixo."
            acao={
              <button className="btn-primario" onClick={() => setNovoAberto(true)}>
                Novo entregável
              </button>
            }
          />
        ) : (
          <ul className="cartao divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
            {entregaveis.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-3 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-indigo-600"
                  checked={e.concluido === 1}
                  onChange={() => void alternarConcluido(e)}
                  aria-label={`Marcar ${e.titulo} como concluído`}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', e.concluido === 1 && 'text-zinc-500 dark:text-zinc-500')}>
                    {e.titulo}
                  </p>
                  {e.descricao && (
                    <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{e.descricao}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {e.data_entrega && (
                      <span>
                        Entrega em {formatarData(e.data_entrega)} · {diasRelativos(e.data_entrega)}
                      </span>
                    )}
                    {e.tempo_estimado_horas != null && <Etiqueta>{e.tempo_estimado_horas} h estimadas</Etiqueta>}
                    {e.ferramentas && <Etiqueta>{e.ferramentas}</Etiqueta>}
                  </div>
                  {e.topicos.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {e.topicos.map((t) => (
                        <Etiqueta key={t.id}>{t.titulo}</Etiqueta>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button className="btn-sutil px-2 py-1 text-xs" onClick={() => setEditando(e)}>
                    Editar
                  </button>
                  {e.data_entrega && (
                    <button className="btn-sutil px-2 py-1 text-xs" onClick={() => setReagendando(e)}>
                      Reagendar
                    </button>
                  )}
                  <button
                    className="btn-perigo px-1.5 py-1"
                    onClick={() => setExcluindo(e)}
                    aria-label="Excluir entregável"
                    title="Excluir entregável"
                  >
                    <IconeLixeira className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <PainelSugestoes bloco={bloco} topicos={topicos} aoAdicionar={() => void carregar()} />
      </section>

      {/* ===================== TESTES TEÓRICOS ===================== */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Testes teóricos
        </h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          Reutilizam o mesmo formato das listas de questões do Modo Prova, e ficam aqui mesmo.
        </p>

        <div className="cartao mb-4 space-y-3 p-3">
          <button className="btn-secundario" onClick={() => setPedindoTeste(true)} disabled={topicos.length === 0}>
            <IconeLista className="h-3.5 w-3.5" />
            Pedir teste de um tópico
          </button>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-indigo-600"
              checked={bloco.sugerir_testes_auto === 1}
              onChange={() => void alternarSugestaoAutomatica()}
            />
            <span className="text-sm">
              Sugerir testes automaticamente
              <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                Ao marcar um entregável como concluído, gera testes para os tópicos associados.
                No máximo {LIMITE_TESTES} testes por vez — havendo mais tópicos, os de maior peso
                têm prioridade. Usa os documentos-fonte do bloco.
              </span>
            </span>
          </label>
        </div>

        {testes.length === 0 ? (
          <Vazio
            icone={<IconeLista className="h-7 w-7" />}
            titulo="Nenhum teste teórico ainda"
            descricao="Peça um teste de um tópico, ou ligue a sugestão automática acima."
          />
        ) : (
          <ul className="cartao space-y-1.5 p-3">
            {testes.map((l) => (
              <LinhaLista key={l.id} lista={l} aoAbrir={() => setAbertaLista(l)} />
            ))}
          </ul>
        )}
      </section>

      {/* ===================== MODAIS ===================== */}
      <ModalEntregavel
        aberto={novoAberto || editando !== null}
        blocoId={bloco.id}
        topicos={topicos}
        entregavel={editando}
        aoFechar={() => {
          setNovoAberto(false);
          setEditando(null);
        }}
        aoSalvar={() => void carregar()}
      />

      <ModalReagendarEntregavel
        entregavel={reagendando}
        aoFechar={() => setReagendando(null)}
        aoSalvar={() => void carregar()}
      />

      <Modal
        aberto={excluindo !== null}
        aoFechar={() => setExcluindo(null)}
        titulo="Excluir entregável"
        largura="max-w-md"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          "{excluindo?.titulo}" será removido. As evidências já registradas permanecem no log dos
          tópicos.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secundario" onClick={() => setExcluindo(null)}>
            Cancelar
          </button>
          <button
            className="btn bg-red-600 text-white hover:bg-red-500"
            onClick={async () => {
              if (excluindo) await apiEntregaveis.excluir(excluindo.id);
              setExcluindo(null);
              void carregar();
            }}
          >
            Excluir
          </button>
        </div>
      </Modal>

      <ModalCriarLista
        aberto={pedindoTeste}
        blocoId={bloco.id}
        topicos={topicos}
        topicoInicial={null}
        contexto="projeto"
        titulo="Pedir teste de um tópico"
        aoFechar={() => setPedindoTeste(false)}
        aoCriar={(l) => {
          void carregar();
          setAbertaLista(l);
        }}
      />

      <VisualizadorLista
        lista={abertaLista}
        aoFechar={() => setAbertaLista(null)}
        aoMudar={() => void aoMudarLista()}
        aoCorrigir={aoCorrigir}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sugestões da IA — cartões de proposta, nada é salvo sem ação do usuário
// ---------------------------------------------------------------------------
function PainelSugestoes({
  bloco,
  topicos,
  aoAdicionar,
}: {
  bloco: Bloco;
  topicos: Topico[];
  aoAdicionar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [descricao, setDescricao] = useState('');
  const [propostas, setPropostas] = useState<SugestaoEntregavel[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pedir = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await apiEntregaveis.sugerir(bloco.id, descricao);
      setPropostas(r.entregaveis);
      setErro(r.erro);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const adicionar = async (p: SugestaoEntregavel, indice: number) => {
    await apiEntregaveis.criar(bloco.id, {
      titulo: p.titulo,
      descricao: p.descricao,
      ferramentas: p.ferramentas,
      tempo_estimado_horas: p.tempo_estimado_horas,
      topico_ids: p.topico_ids,
    });
    setPropostas((atuais) => atuais.filter((_, i) => i !== indice));
    aoAdicionar();
  };

  if (!aberto) {
    return (
      <button className="btn-sutil mt-3" onClick={() => setAberto(true)} disabled={topicos.length === 0}>
        <IconeBussola className="h-4 w-4" />
        Sugerir entregáveis
      </button>
    );
  }

  return (
    <div className="cartao mt-4 space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Sugerir entregáveis</h3>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            As sugestões aparecem como propostas. Nada é criado até você clicar em "Adicionar".
          </p>
        </div>
        <button className="btn-sutil px-1.5 py-1" onClick={() => setAberto(false)} aria-label="Fechar sugestões">
          <IconeX />
        </button>
      </div>

      <textarea
        className="campo resize-none"
        rows={3}
        placeholder="Descreva o que você espera do projeto…"
        value={descricao}
        onChange={(e) => setDescricao(e.target.value)}
      />

      <div className="flex items-center gap-3">
        <button className="btn-primario" onClick={() => void pedir()} disabled={!descricao.trim() || ocupado}>
          Pedir sugestões
        </button>
        {ocupado && <Carregando texto="Montando propostas…" />}
      </div>

      {erro && <Aviso tom="atencao">{erro}</Aviso>}

      {propostas.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {propostas.map((p, i) => (
            <li
              key={`${p.titulo}-${i}`}
              className="surgir flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700"
            >
              <Etiqueta>Proposta</Etiqueta>
              <p className="text-sm font-medium">{p.titulo}</p>
              {p.descricao && <p className="text-xs text-zinc-500 dark:text-zinc-400">{p.descricao}</p>}
              <div className="flex flex-wrap gap-1">
                {p.tempo_estimado_horas != null && <Etiqueta>{p.tempo_estimado_horas} h</Etiqueta>}
                {p.ferramentas && <Etiqueta>{p.ferramentas}</Etiqueta>}
                {p.topicos.map((t) => (
                  <Etiqueta key={t}>{t}</Etiqueta>
                ))}
              </div>
              <div className="mt-auto flex gap-2 pt-1">
                <button className="btn-primario flex-1 py-1.5" onClick={() => void adicionar(p, i)}>
                  Adicionar
                </button>
                <button
                  className="btn-secundario py-1.5"
                  onClick={() => setPropostas((atuais) => atuais.filter((_, j) => j !== i))}
                >
                  Descartar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de criação / edição de entregável
// ---------------------------------------------------------------------------
function ModalEntregavel({
  aberto,
  blocoId,
  topicos,
  entregavel,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  blocoId: string;
  topicos: Topico[];
  entregavel: Entregavel | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [ferramentas, setFerramentas] = useState('');
  const [tempo, setTempo] = useState('');
  const [data, setData] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const linhas = useMemo(() => topicosParaLinhas(topicos), [topicos]);

  useEffect(() => {
    if (!aberto) return;
    setTitulo(entregavel?.titulo ?? '');
    setDescricao(entregavel?.descricao ?? '');
    setFerramentas(entregavel?.ferramentas ?? '');
    setTempo(entregavel?.tempo_estimado_horas != null ? String(entregavel.tempo_estimado_horas) : '');
    setData(entregavel?.data_entrega ?? '');
    setSelecionados(entregavel?.topicos.map((t) => t.id) ?? []);
    setErro(null);
  }, [aberto, entregavel]);

  const salvar = async () => {
    if (!titulo.trim()) return;
    const dados = {
      titulo,
      descricao,
      ferramentas,
      tempo_estimado_horas: tempo,
      data_entrega: data || null,
      topico_ids: selecionados,
    };
    try {
      if (entregavel) await apiEntregaveis.atualizar(entregavel.id, dados);
      else await apiEntregaveis.criar(blocoId, dados);
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={entregavel ? 'Editar entregável' : 'Novo entregável'}
      largura="max-w-2xl"
    >
      <div className="space-y-4">
        <div>
          <label className="rotulo">Nome</label>
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="rotulo">Descrição</label>
          <textarea
            className="campo resize-none"
            rows={3}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        <div>
          <label className="rotulo">Tópicos associados</label>
          {linhas.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Este bloco ainda não tem tópicos.
            </p>
          ) : (
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
              {linhas.map((l) => (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  style={{ paddingLeft: 4 + l.nivel * 16 }}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
                    checked={selecionados.includes(l.id)}
                    onChange={(e) =>
                      setSelecionados((atuais) =>
                        e.target.checked ? [...atuais, l.id] : atuais.filter((x) => x !== l.id)
                      )
                    }
                  />
                  <span className="truncate">{l.titulo}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="rotulo">Ferramentas utilizadas</label>
            <input
              className="campo"
              value={ferramentas}
              onChange={(e) => setFerramentas(e.target.value)}
              placeholder="Ex.: Python, Figma"
            />
          </div>
          <div>
            <label className="rotulo">Tempo estimado (h)</label>
            <input
              className="campo"
              type="number"
              min={0}
              step="0.5"
              value={tempo}
              onChange={(e) => setTempo(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="rotulo">Data de entrega</label>
          <input className="campo" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>

        {erro && <Aviso tom="atencao">{erro}</Aviso>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => void salvar()} disabled={!titulo.trim()}>
          {entregavel ? 'Salvar' : 'Criar entregável'}
        </button>
      </div>
    </Modal>
  );
}

/** Reagendar apenas move a data. Nunca aparece como atraso ou falha. */
function ModalReagendarEntregavel({
  entregavel,
  aoFechar,
  aoSalvar,
}: {
  entregavel: Entregavel | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [data, setData] = useState(hojeISO());

  useEffect(() => {
    if (entregavel?.data_entrega) setData(entregavel.data_entrega);
  }, [entregavel]);

  return (
    <Modal
      aberto={entregavel !== null}
      aoFechar={aoFechar}
      titulo="Reagendar entregável"
      descricao={entregavel?.titulo}
      largura="max-w-md"
    >
      <label className="rotulo">Nova data de entrega</label>
      <input className="campo" type="date" value={data} onChange={(e) => setData(e.target.value)} />
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Reagendar apenas move a data de entrega.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button
          className="btn-primario"
          onClick={async () => {
            if (entregavel) await apiEntregaveis.reagendar(entregavel.id, data);
            aoSalvar();
            aoFechar();
          }}
        >
          Reagendar
        </button>
      </div>
    </Modal>
  );
}
