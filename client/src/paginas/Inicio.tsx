import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Bloco, Revisao } from '../tipos';
import { useSondagem } from '../estado/sondagem';
import { diasRelativos, formatarData } from '../util';
import { CardCompromissos } from '../componentes/CardCompromissos';
import { CardSugestoes } from '../componentes/CardSugestoes';
import {
  Carregando,
  Etiqueta,
  IconeBloco,
  IconeRelogio,
  Vazio,
} from '../componentes/ui';

export function PaginaInicio() {
  const { versao } = useSondagem();
  const [recentes, setRecentes] = useState<(Bloco & { pasta_nome: string | null })[]>([]);
  const [revisoes, setRevisoes] = useState<Revisao[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api
      .inicio()
      .then((d) => {
        setRecentes(d.blocos_recentes);
        setRevisoes(d.revisoes_hoje);
      })
      .finally(() => setCarregando(false));
  }, [versao]);

  if (carregando) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-6">
      <h1 className="text-xl font-semibold">Início</h1>

      <CardSugestoes />

      <CardCompromissos />

      {/* Card: revisões pendentes hoje */}
      <section>
        <div className="cartao p-4">
          <div className="mb-3 flex items-center gap-2">
            <IconeRelogio className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold">Revisões pendentes hoje</h2>
            <Etiqueta>{revisoes.length}</Etiqueta>
          </div>

          {revisoes.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nenhuma revisão com data prevista até hoje.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {revisoes.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{r.topico_titulo}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <Etiqueta>Revisão {r.numero}/3</Etiqueta>
                      <span>{r.bloco_nome}</span>
                      <span>
                        {formatarData(r.data_prevista)} · {diasRelativos(r.data_prevista)}
                      </span>
                    </p>
                  </div>
                  <Link className="btn-secundario py-1.5" to={`/blocos/${r.bloco_id}`}>
                    Abrir bloco
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Blocos acessados recentemente */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Acessados recentemente
        </h2>
        {recentes.length === 0 ? (
          <Vazio
            icone={<IconeBloco className="h-7 w-7" />}
            titulo="Nenhum bloco acessado ainda"
            descricao="Crie seu primeiro bloco na página Blocos."
            acao={
              <Link className="btn-primario" to="/blocos">
                Ir para Blocos
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {recentes.map((b) => (
              <li key={b.id}>
                <Link
                  to={`/blocos/${b.id}`}
                  className="cartao flex items-center gap-3 p-3 transition hover:border-indigo-400 dark:hover:border-indigo-600"
                >
                  <IconeBloco className="h-5 w-5 shrink-0 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.nome}</p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {b.pasta_nome ?? 'Raiz'} · {formatarData(b.ultimo_acesso)}
                    </p>
                  </div>
                  {b.wrapper_academico === 1 && <Etiqueta>Disciplina</Etiqueta>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
