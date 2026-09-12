import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiListas } from '../api';
import type { Bloco, ListaQuestoes, Topico } from '../tipos';
import { cn, formatarData, ROTULO_ORIGEM, ROTULO_PESO, ROTULO_STATUS_LISTA, topicosParaLinhas } from '../util';
import { ModalCriarLista, ModalEnviarLista } from '../componentes/ModaisLista';
import { VisualizadorLista } from '../componentes/VisualizadorLista';
import {
  Carregando,
  Etiqueta,
  IconeChevron,
  IconeLista,
  IconeMais,
  IconeUpload,
  Vazio,
} from '../componentes/ui';

/**
 * Modo Prova: cada tópico do bloco é um cartão expansível com suas listas de
 * questões. O status de cada lista é sempre do usuário — a IA nunca o altera.
 */
export function ModoProva({
  bloco,
  aoCorrigir,
}: {
  bloco: Bloco;
  aoCorrigir: (lista: ListaQuestoes) => Promise<void>;
}) {
  const [topicos, setTopicos] = useState<Topico[]>([]);
  const [listas, setListas] = useState<ListaQuestoes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [criando, setCriando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aberta, setAberta] = useState<ListaQuestoes | null>(null);

  const carregar = useCallback(async () => {
    const [t, l] = await Promise.all([api.listarTopicos(bloco.id), apiListas.listar(bloco.id, 'prova')]);
    setTopicos(t);
    setListas(l);
    setCarregando(false);
    return l;
  }, [bloco.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const linhas = useMemo(() => topicosParaLinhas(topicos), [topicos]);
  const porId = useMemo(() => new Map(topicos.map((t) => [t.id, t])), [topicos]);

  const listasPorTopico = useMemo(() => {
    const mapa = new Map<string, ListaQuestoes[]>();
    for (const l of listas) {
      const chave = l.topico_id ?? 'sem_topico';
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(l);
    }
    return mapa;
  }, [listas]);

  const semTopico = listasPorTopico.get('sem_topico') ?? [];

  // Recarrega a lista aberta para refletir mudanças feitas no visualizador.
  const aoMudarLista = async () => {
    const atualizadas = await carregar();
    setAberta((atual) => (atual ? (atualizadas.find((l) => l.id === atual.id) ?? null) : null));
  };

  if (carregando) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Tópicos do bloco
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Crie listas de questões por tópico, ou envie listas que você já tem.
        </p>
      </div>

      {linhas.length === 0 ? (
        <Vazio
          icone={<IconeLista className="h-7 w-7" />}
          titulo="Nenhum tópico ainda"
          descricao="Monte a tabela de conteúdos do bloco para poder criar listas por tópico."
        />
      ) : (
        <ul className="space-y-2">
          {linhas.map((linha) => {
            const topico = porId.get(linha.id);
            if (!topico) return null;
            const doTopico = listasPorTopico.get(topico.id) ?? [];
            const aberto = expandido === topico.id;

            return (
              <li key={topico.id} className="cartao overflow-hidden" style={{ marginLeft: linha.nivel * 16 }}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => setExpandido(aberto ? null : topico.id)}
                    aria-expanded={aberto}
                  >
                    <IconeChevron
                      className={cn('h-3 w-3 shrink-0 text-zinc-400 transition', aberto && 'rotate-90')}
                    />
                    <span className="truncate text-sm font-medium">{topico.titulo}</span>
                    <Etiqueta>Peso {ROTULO_PESO[topico.peso]}</Etiqueta>
                    <ContagemPorStatus listas={doTopico} />
                  </button>

                  <div className="flex shrink-0 gap-2">
                    <button className="btn-secundario py-1.5" onClick={() => setCriando(topico.id)}>
                      <IconeMais className="h-3.5 w-3.5" />
                      Criar lista de questões
                    </button>
                    <button className="btn-sutil py-1.5" onClick={() => setEnviando(topico.id)}>
                      <IconeUpload className="h-3.5 w-3.5" />
                      Enviar lista
                    </button>
                  </div>
                </div>

                {aberto && (
                  <div className="surgir border-t border-zinc-100 bg-zinc-50 px-3 py-3 dark:border-zinc-800/60 dark:bg-zinc-950/40">
                    {doTopico.length === 0 ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-500">
                        Nenhuma lista neste tópico ainda.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {doTopico.map((l) => (
                          <LinhaLista key={l.id} lista={l} aoAbrir={() => setAberta(l)} />
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

      {semTopico.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Listas sem tópico
          </h2>
          <ul className="cartao space-y-1.5 p-3">
            {semTopico.map((l) => (
              <LinhaLista key={l.id} lista={l} aoAbrir={() => setAberta(l)} />
            ))}
          </ul>
        </section>
      )}

      <ModalCriarLista
        aberto={criando !== null}
        blocoId={bloco.id}
        topicos={topicos}
        topicoInicial={criando}
        contexto="prova"
        titulo="Criar lista de questões"
        aoFechar={() => setCriando(null)}
        aoCriar={(l) => {
          void carregar();
          setAberta(l);
        }}
      />

      <ModalEnviarLista
        aberto={enviando !== null}
        blocoId={bloco.id}
        topicos={topicos}
        topicoInicial={enviando}
        contexto="prova"
        aoFechar={() => setEnviando(null)}
        aoCriar={(l) => {
          void carregar();
          setAberta(l);
        }}
      />

      <VisualizadorLista
        lista={aberta}
        aoFechar={() => setAberta(null)}
        aoMudar={() => void aoMudarLista()}
        aoCorrigir={aoCorrigir}
      />
    </div>
  );
}

/** Contagem objetiva de listas por status — nunca nota nem percentual. */
function ContagemPorStatus({ listas }: { listas: ListaQuestoes[] }) {
  if (listas.length === 0) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-600">nenhuma lista</span>;
  }
  const contar = (s: ListaQuestoes['status']) => listas.filter((l) => l.status === s).length;
  const partes = [
    [contar('nao_feita'), 'não feitas'],
    [contar('incompleta'), 'incompletas'],
    [contar('completa'), 'completas'],
  ] as [number, string][];

  return (
    <span className="text-xs text-zinc-500 dark:text-zinc-400">
      {partes
        .filter(([n]) => n > 0)
        .map(([n, rotulo]) => `${n} ${rotulo}`)
        .join(' · ')}
    </span>
  );
}

export function LinhaLista({ lista, aoAbrir }: { lista: ListaQuestoes; aoAbrir: () => void }) {
  return (
    <li>
      <button
        onClick={aoAbrir}
        className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-left transition hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <span className="min-w-0 flex-1 truncate text-sm">{lista.titulo}</span>
        <Etiqueta>{ROTULO_ORIGEM[lista.origem]}</Etiqueta>
        <Etiqueta>{ROTULO_STATUS_LISTA[lista.status]}</Etiqueta>
        <span className="text-xs text-zinc-400 dark:text-zinc-600">{formatarData(lista.criado_em)}</span>
      </button>
    </li>
  );
}
