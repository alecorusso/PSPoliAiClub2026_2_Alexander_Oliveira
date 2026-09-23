import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Bloco, Evidencia, Revisao, Topico } from '../tipos';
import { useSondagem } from '../estado/sondagem';
import {
  cn,
  diasRelativos,
  formatarData,
  formatarDataHora,
  hojeISO,
  ROTULO_PESO,
  topicosParaLinhas,
} from '../util';
import {
  Carregando,
  Etiqueta,
  IconeCheck,
  IconeChevron,
  IconeConversa,
  IconeLista,
  IconeRelogio,
  IconeX,
  Modal,
  TagNatureza,
  Vazio,
} from '../componentes/ui';
import { GeradoAPartirDe } from '../componentes/GeradoAPartirDe';

export function ModoAprendizagem({
  bloco,
  aoAbrirTabela,
}: {
  bloco: Bloco;
  aoAbrirTabela: () => void;
}) {
  const { abrir, versao, sugestaoTabela, dispensarSugestao, ativa } = useSondagem();

  const [topicos, setTopicos] = useState<Topico[]>([]);
  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const [evidencias, setEvidencias] = useState<Evidencia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [selecionandoTopico, setSelecionandoTopico] = useState(false);
  const [reagendando, setReagendando] = useState<Revisao | null>(null);

  const carregar = useCallback(async () => {
    const [t, r, e] = await Promise.all([
      api.listarTopicos(bloco.id),
      api.listarRevisoes(bloco.id),
      api.listarEvidencias(bloco.id),
    ]);
    setTopicos(t);
    setRevisoes(r);
    setEvidencias(e);
    setCarregando(false);
  }, [bloco.id]);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  const linhas = useMemo(() => topicosParaLinhas(topicos), [topicos]);
  const porId = useMemo(() => new Map(topicos.map((t) => [t.id, t])), [topicos]);

  const evidenciasPorTopico = useMemo(() => {
    const mapa = new Map<string, Evidencia[]>();
    for (const e of evidencias) {
      if (!mapa.has(e.topico_id)) mapa.set(e.topico_id, []);
      mapa.get(e.topico_id)!.push(e);
    }
    return mapa;
  }, [evidencias]);

  const marcados = topicos.filter((t) => t.check_aprendizagem === 1).length;

  // Marcar o check manualmente é permitido e não exige sondagem.
  const alternarCheck = async (topico: Topico) => {
    await api.marcarCheck(topico.id, topico.check_aprendizagem !== 1);
    await carregar();
  };

  const concluirRevisao = async (r: Revisao) => {
    await api.concluirRevisao(r.id);
    await carregar();
  };

  const reagendar = async (r: Revisao, data: string) => {
    await api.reagendarRevisao(r.id, data);
    setReagendando(null);
    await carregar();
  };

  if (carregando) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-6 pb-24">
      {/* Aviso pós-sondagem: discreto e dispensável, exclusivo deste modo. */}
      {sugestaoTabela === bloco.id && (
        <div className="surgir flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex-1 text-zinc-600 dark:text-zinc-400">
            Quer revisar a tabela de conteúdos deste bloco?
          </span>
          <button
            className="btn-secundario py-1.5"
            onClick={() => {
              dispensarSugestao();
              aoAbrirTabela();
            }}
          >
            Abrir editor
          </button>
          <button
            className="btn-sutil px-1.5 py-1.5"
            onClick={dispensarSugestao}
            aria-label="Dispensar aviso"
          >
            <IconeX />
          </button>
        </div>
      )}

      {/* 1. Sondagem */}
      <section>
        <button
          className="btn-primario w-full py-4 text-base"
          onClick={() => setSelecionandoTopico(true)}
          disabled={topicos.length === 0}
        >
          <IconeConversa className="h-5 w-5" />
          Fazer sondagem
        </button>
        {topicos.length === 0 && (
          <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
            Adicione tópicos à tabela de conteúdos para poder sondar.
          </p>
        )}
        {ativa && (
          <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
            Há uma sondagem aberta: {ativa.topico.titulo}.
          </p>
        )}
      </section>

      {/* 2. Tópicos do bloco */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Tópicos do bloco
          </h2>
          {topicos.length > 0 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              {marcados} de {topicos.length} tópicos marcados
            </span>
          )}
        </div>

        {/* De quais documentos a tabela de conteúdos foi gerada. */}
        <div className="mb-3">
          <GeradoAPartirDe tipo="tabela_conteudos" itemId={bloco.id} blocoId={bloco.id} />
        </div>

        {/* Contagem objetiva de checks — sem nota, score ou percentual. */}
        {topicos.length > 0 && (
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-indigo-500 transition-all"
              style={{ width: `${(marcados / topicos.length) * 100}%` }}
            />
          </div>
        )}

        {linhas.length === 0 ? (
          <Vazio
            icone={<IconeLista className="h-7 w-7" />}
            titulo="Nenhum tópico ainda"
            descricao="Abra as configurações do bloco para montar a tabela de conteúdos."
            acao={
              <button className="btn-secundario" onClick={aoAbrirTabela}>
                Abrir editor
              </button>
            }
          />
        ) : (
          <ul className="cartao divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
            {linhas.map((linha) => {
              const topico = porId.get(linha.id);
              if (!topico) return null;
              const marcado = topico.check_aprendizagem === 1;
              const aberto = expandido === topico.id;
              const logs = evidenciasPorTopico.get(topico.id) ?? [];

              return (
                <li key={topico.id}>
                  <div
                    className="flex items-center gap-2.5 px-3 py-2.5"
                    style={{ paddingLeft: 12 + linha.nivel * 20 }}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => void alternarCheck(topico)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-indigo-600"
                      aria-label={`Marcar ${topico.titulo}`}
                    />
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setExpandido(aberto ? null : topico.id)}
                    >
                      <IconeChevron
                        className={cn(
                          'h-3 w-3 shrink-0 text-zinc-400 transition',
                          aberto && 'rotate-90'
                        )}
                      />
                      <span
                        className={cn(
                          'truncate text-sm',
                          marcado && 'text-zinc-500 dark:text-zinc-500'
                        )}
                      >
                        {topico.titulo}
                      </span>
                    </button>
                    <TagNatureza natureza={topico.natureza} />
                  </div>

                  {aberto && (
                    <div
                      className="surgir space-y-2 border-t border-zinc-100 bg-zinc-50 px-3 py-3 dark:border-zinc-800/60 dark:bg-zinc-950/40"
                      style={{ paddingLeft: 42 + linha.nivel * 20 }}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <Etiqueta>Peso {ROTULO_PESO[topico.peso]}</Etiqueta>
                        {marcado && <Etiqueta>Marcado em {formatarData(topico.data_check)}</Etiqueta>}
                      </div>
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                        Log de evidências
                      </p>
                      {logs.length === 0 ? (
                        <p className="text-sm text-zinc-500 dark:text-zinc-500">
                          Nenhuma evidência registrada para este tópico.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {logs.map((e) => (
                            <li key={e.id} className="flex gap-2 text-sm">
                              <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                                {formatarDataHora(e.data)}
                              </span>
                              <Etiqueta>{e.modo}</Etiqueta>
                              <span className="text-zinc-600 dark:text-zinc-300">{e.descricao}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 3. Revisões */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Revisões
        </h2>
        {revisoes.length === 0 ? (
          <Vazio
            icone={<IconeRelogio className="h-7 w-7" />}
            titulo="Nenhuma revisão agendada"
            descricao="Ao marcar um tópico, a primeira revisão é agendada para daqui a 3 dias."
          />
        ) : (
          <ul className="cartao divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
            {revisoes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.topico_titulo}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <Etiqueta>Revisão {r.numero}/3</Etiqueta>
                    <span>
                      {formatarData(r.data_prevista)} · {diasRelativos(r.data_prevista)}
                    </span>
                    <BadgeStatus revisao={r} />
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="btn-secundario py-1.5" onClick={() => void concluirRevisao(r)}>
                    <IconeCheck className="h-3.5 w-3.5" />
                    Concluir
                  </button>
                  <button className="btn-sutil py-1.5" onClick={() => setReagendando(r)}>
                    Reagendar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ModalSelecionarTopico
        aberto={selecionandoTopico}
        topicos={topicos}
        aoFechar={() => setSelecionandoTopico(false)}
        aoEscolher={(topico) => {
          setSelecionandoTopico(false);
          abrir({ blocoId: bloco.id, blocoNome: bloco.nome, topico });
        }}
      />

      <ModalReagendar
        revisao={reagendando}
        aoFechar={() => setReagendando(null)}
        aoConfirmar={(data) => reagendando && void reagendar(reagendando, data)}
      />
    </div>
  );
}

/**
 * Badge de status. Reagendada é sempre neutra: reagendar nunca aparece como
 * atraso, falha ou pendência negativa.
 */
function BadgeStatus({ revisao }: { revisao: Revisao }) {
  if (revisao.status === 'reagendada') return <Etiqueta>Reagendada</Etiqueta>;
  if (revisao.data_prevista < hojeISO()) return <Etiqueta tom="atencao">Atrasada</Etiqueta>;
  return <Etiqueta>Pendente</Etiqueta>;
}

/** Seleção única de tópico, exibida como árvore. */
function ModalSelecionarTopico({
  aberto,
  topicos,
  aoFechar,
  aoEscolher,
}: {
  aberto: boolean;
  topicos: Topico[];
  aoFechar: () => void;
  aoEscolher: (t: Topico) => void;
}) {
  const linhas = useMemo(() => topicosParaLinhas(topicos), [topicos]);
  const porId = useMemo(() => new Map(topicos.map((t) => [t.id, t])), [topicos]);

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Escolha o tópico da sondagem"
      descricao="Um tópico por vez."
    >
      <div className="max-h-80 space-y-0.5 overflow-y-auto">
        {linhas.map((linha) => {
          const topico = porId.get(linha.id);
          if (!topico) return null;
          return (
            <button
              key={topico.id}
              onClick={() => aoEscolher(topico)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              style={{ paddingLeft: 8 + linha.nivel * 20 }}
            >
              <span className="min-w-0 flex-1 truncate">{topico.titulo}</span>
              {topico.check_aprendizagem === 1 && <Etiqueta>Marcado</Etiqueta>}
              <TagNatureza natureza={topico.natureza} />
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function ModalReagendar({
  revisao,
  aoFechar,
  aoConfirmar,
}: {
  revisao: Revisao | null;
  aoFechar: () => void;
  aoConfirmar: (data: string) => void;
}) {
  const [data, setData] = useState(hojeISO());

  useEffect(() => {
    if (revisao) setData(revisao.data_prevista);
  }, [revisao]);

  return (
    <Modal
      aberto={Boolean(revisao)}
      aoFechar={aoFechar}
      titulo="Reagendar revisão"
      descricao={revisao?.topico_titulo}
      largura="max-w-md"
    >
      <label className="rotulo">Nova data</label>
      <input className="campo" type="date" value={data} onChange={(e) => setData(e.target.value)} />
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Reagendar apenas move a data. A revisão continua sendo a {revisao?.numero}ª.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => aoConfirmar(data)}>
          Reagendar
        </button>
      </div>
    </Modal>
  );
}
