import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiDesempenho } from '../api';
import { calcularFormula, nomeDeVariavel } from '../formula';
import { CALIB_MAX, CALIB_MIN, MIN_CASOS_TIPO } from '../lib/calibracao';
import {
  calibracaoPorTipo,
  contarRevisoes,
  cumprimentoDoPlano,
  focoPorBloco,
  formatarFator,
  MIN_ITENS_GRAFICO,
  plural,
  situacaoAcademica,
  type DadosDesempenho,
  type TipoMeta,
} from '../lib/desempenho';
import { calcularMedias, cn, formatarNota, textoFaltas } from '../util';
import { textoDuracao } from '../componentes/CampoEstimativa';
import { Carregando, IconeGrafico, Vazio } from '../componentes/ui';

/**
 * Desempenho.
 *
 * Descreve o que foi registrado; não julga quem estudou. Nada aqui vira score,
 * percentual de domínio, tendência ou comparação entre períodos, e as evidências
 * de aprendizagem não entram em conta nenhuma. Todo número aparece junto do que
 * o sustenta — quantas tarefas, quantas sessões, quantas notas.
 */

const TIPOS_META: { id: TipoMeta; rotulo: string }[] = [
  { id: 'avaliacao', rotulo: 'Avaliações' },
  { id: 'entregavel', rotulo: 'Entregáveis de projeto' },
  { id: 'lista', rotulo: 'Listas de questões' },
];

/** Cores das barras: neutra e âmbar suave. Vermelho seria linguagem de falha. */
const COR_NA_DATA = '#6366f1';
const COR_APOS = '#f59e0b';

export function PaginaDesempenho() {
  const [dados, setDados] = useState<DadosDesempenho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [blocosSel, setBlocosSel] = useState<Set<string> | null>(null);
  const [tiposSel, setTiposSel] = useState<Set<TipoMeta>>(
    () => new Set(TIPOS_META.map((t) => t.id))
  );

  useEffect(() => {
    apiDesempenho
      .dados()
      .then((d) => {
        setDados(d);
        // Todos os blocos marcados por padrão: a visão nasce agregada.
        setBlocosSel(new Set(d.blocos.map((b) => b.id)));
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  if (erro) {
    return (
      <div className="px-6 py-6">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{erro}</p>
      </div>
    );
  }
  if (!dados || !blocosSel) {
    return (
      <div className="px-6 py-6">
        <Carregando />
      </div>
    );
  }

  return (
    <Conteudo
      dados={dados}
      blocosSel={blocosSel}
      setBlocosSel={setBlocosSel}
      tiposSel={tiposSel}
      setTiposSel={setTiposSel}
    />
  );
}

function Conteudo({
  dados,
  blocosSel,
  setBlocosSel,
  tiposSel,
  setTiposSel,
}: {
  dados: DadosDesempenho;
  blocosSel: Set<string>;
  setBlocosSel: (s: Set<string>) => void;
  tiposSel: Set<TipoMeta>;
  setTiposSel: (s: Set<TipoMeta>) => void;
}) {
  const plano = useMemo(
    () => cumprimentoDoPlano(dados.metas, blocosSel, tiposSel),
    [dados.metas, blocosSel, tiposSel]
  );

  /** A média segue a regra do próprio bloco: ponderada ou fórmula. */
  const mediaDoBloco = useMemo(() => {
    return (blocoId: string): number | null => {
      const bloco = dados.blocos.find((b) => b.id === blocoId);
      if (!bloco) return null;
      const avs = dados.avaliacoes.filter((a) => a.bloco_id === blocoId);
      if (avs.length === 0) return null;

      if (bloco.usar_formula === 1 && bloco.formula_media?.trim()) {
        const usados = new Set<string>();
        const variaveis = avs.map((a) => ({
          nome: nomeDeVariavel(a.titulo, usados),
          rotulo: a.titulo,
          valor: a.nota,
        }));
        const r = calcularFormula(bloco.formula_media, variaveis);
        return r.ok ? r.valor : null;
      }

      const linhas = avs.map((a) => ({
        id: a.id,
        titulo: a.titulo,
        peso: a.peso === null ? '' : String(a.peso),
        nota: a.nota === null ? '' : String(a.nota),
        data_prevista: '',
        tempo_estimado_min: '',
        origem_estimativa: null,
        tipo_tarefa: '',
        feita: false,
        realizada: false,
      }));
      return calcularMedias(linhas, {}, bloco.media_aprovacao).mediaAtual;
    };
  }, [dados.blocos, dados.avaliacoes]);

  const academico = useMemo(
    () => situacaoAcademica(dados.blocos, dados.avaliacoes, blocosSel, mediaDoBloco),
    [dados.blocos, dados.avaliacoes, blocosSel, mediaDoBloco]
  );
  const tipos = useMemo(
    () => calibracaoPorTipo(dados.calibracao, blocosSel),
    [dados.calibracao, blocosSel]
  );
  const foco = useMemo(
    () => focoPorBloco(dados.foco, dados.blocos, blocosSel),
    [dados.foco, dados.blocos, blocosSel]
  );
  const revisoes = useMemo(
    () => contarRevisoes(dados.revisoes, blocosSel, dados.hoje),
    [dados.revisoes, blocosSel, dados.hoje]
  );

  const alternar = <T,>(conjunto: Set<T>, valor: T, aplicar: (s: Set<T>) => void) => {
    const novo = new Set(conjunto);
    if (novo.has(valor)) novo.delete(valor);
    else novo.add(valor);
    aplicar(novo);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-6">
      <h1 className="text-xl font-semibold">Desempenho</h1>

      {/* ---------------------------------------------------------------- */}
      {/* A. Filtros                                                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="cartao space-y-4 p-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Blocos</h2>
            <button
              className="btn-sutil px-2 py-0.5 text-xs"
              onClick={() => setBlocosSel(new Set(dados.blocos.map((b) => b.id)))}
            >
              Marcar todos
            </button>
            <button className="btn-sutil px-2 py-0.5 text-xs" onClick={() => setBlocosSel(new Set())}>
              Desmarcar todos
            </button>
          </div>
          {dados.blocos.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum bloco criado ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {dados.blocos.map((b) => (
                <label key={b.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-600"
                    checked={blocosSel.has(b.id)}
                    onChange={() => alternar(blocosSel, b.id, setBlocosSel)}
                  />
                  {b.nome}
                </label>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Itens no gráfico de metas</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {TIPOS_META.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-600"
                  checked={tiposSel.has(t.id)}
                  onChange={() => alternar(tiposSel, t.id, setTiposSel)}
                />
                {t.rotulo}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* B. Cumprimento do plano                                           */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Cumprimento do plano atual</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Compara cada conclusão com a data vigente do item. Reagendamentos não contam como atraso.
        </p>

        <div className="cartao mt-3 p-4">
          {plano.total < MIN_ITENS_GRAFICO ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {plano.total === 0
                ? 'Nenhum item concluído com data ainda. Assim que você concluir avaliações, entregáveis ou listas que tinham prazo, a comparação aparece aqui.'
                : `Por enquanto há ${plural(plano.total, 'item concluído', 'itens concluídos')} com data — poucos para uma comparação que signifique algo.`}
            </p>
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={plano.meses}
                    margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    barGap={4}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 12 }} stroke="currentColor" className="text-zinc-500" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="currentColor" className="text-zinc-500" />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      labelStyle={{ fontWeight: 500 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="naData" name="Concluídos na data" fill={COR_NA_DATA} radius={[3, 3, 0, 0]} maxBarSize={44} />
                    <Bar dataKey="aposAData" name="Concluídos após a data" fill={COR_APOS} radius={[3, 3, 0, 0]} maxBarSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                {plural(plano.total, 'item concluído', 'itens concluídos')} com data: {plano.naData} na
                data, {plano.aposAData} após a data.
              </p>
            </>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* C. Situação acadêmica                                             */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Situação acadêmica</h2>
        {academico.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Nenhum dos blocos selecionados é uma disciplina cursada.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {academico.map((a) => (
              <div key={a.blocoId} className="cartao space-y-3 p-4">
                <Link className="text-sm font-medium hover:underline" to={`/blocos/${a.blocoId}`}>
                  {a.nome}
                </Link>

                <div>
                  <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Faltas
                    <span
                      className={cn(
                        'font-medium',
                        (a.pertoDoLimite || a.limiteAtingido) && 'text-amber-700 dark:text-amber-400'
                      )}
                    >
                      {a.faltas}
                      {a.limiteFaltas !== null ? ` de ${a.limiteFaltas}` : ''}
                    </span>
                  </p>
                  {a.limiteFaltas === null ? (
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                      Sem limite registrado.
                    </p>
                  ) : (
                    <>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            a.pertoDoLimite || a.limiteAtingido ? 'bg-amber-500' : 'bg-zinc-400 dark:bg-zinc-500'
                          )}
                          style={{ width: `${Math.min(100, (a.faltas / Math.max(a.limiteFaltas, 1)) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {/* Mesmo texto do painel Acadêmico, para não divergirem. */}
                        {textoFaltas(a.faltas, a.limiteFaltas)}
                      </p>
                    </>
                  )}
                </div>

                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Média atual{' '}
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">
                      {a.mediaAtual === null ? '—' : formatarNota(a.mediaAtual)}
                    </span>
                    {a.mediaAprovacao !== null && (
                      <> · aprovação com {formatarNota(a.mediaAprovacao)}</>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                    {a.avaliacoesComNota === 0
                      ? 'Nenhuma nota registrada ainda.'
                      : `${plural(a.avaliacoesComNota, 'nota registrada', 'notas registradas')} de ${a.totalAvaliacoes}.`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* D. Calibração das estimativas                                     */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Como suas estimativas se comparam ao tempo real</h2>
        <div className="cartao mt-3 p-4">
          {tipos.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ainda não há tarefas concluídas com tempo informado por você. A estimativa da IA não
              entra nesta conta: ela mediria o acerto do modelo, não o seu.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {tipos.map((t) => (
                <li key={t.tipo} className="py-2 first:pt-0 last:pb-0">
                  <p className="text-sm">
                    <span className="font-medium">{t.tipo}</span>
                    {' — '}
                    {t.suficiente && t.mediana !== null ? (
                      <>
                        em mediana, {formatarFator(t.mediana)}× o estimado (
                        {plural(t.casos, 'tarefa', 'tarefas')})
                      </>
                    ) : (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        histórico insuficiente ({plural(t.casos, 'tarefa', 'tarefas')} de{' '}
                        {MIN_CASOS_TIPO})
                      </span>
                    )}
                  </p>
                  {t.limitado && (
                    <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                      No cronograma o ajuste entra como {formatarFator(t.fator)}×, porque o fator é
                      contido entre {formatarFator(CALIB_MIN)}× e {formatarFator(CALIB_MAX)}×.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Esses valores são usados para ajustar as estimativas do cronograma.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* E. Tempo de foco                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Tempo de foco acumulado</h2>
        <div className="cartao mt-3 p-4">
          {foco.linhas.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nenhuma sessão de foco encerrada ainda.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {foco.linhas.map((l) => (
                  <li
                    key={l.blocoId ?? 'sem-bloco'}
                    className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm first:pt-0 last:pb-0"
                  >
                    <span className="min-w-0 flex-1 truncate">{l.nome}</span>
                    <span className="font-medium">{textoDuracao(l.minutos)}</span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      {plural(l.sessoes, 'sessão', 'sessões')}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
                Total: <span className="font-medium">{textoDuracao(foco.totalMin)}</span>
              </p>
            </>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* F. Revisões de aprendizagem                                       */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">Revisões de aprendizagem</h2>
        <div className="cartao mt-3 p-4">
          {revisoes.pendentes === 0 && revisoes.concluidas === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nenhuma revisão agendada nos blocos selecionados.
            </p>
          ) : (
            <p className="text-sm">
              {revisoes.emDia} em dia · {revisoes.atrasadas} atrasadas · {revisoes.reagendadas}{' '}
              reagendadas
            </p>
          )}
          <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Status de organização das revisões, não uma medida de desempenho.
            {revisoes.pendentes > 0 &&
              ` Somam as ${plural(revisoes.pendentes, 'revisão pendente', 'revisões pendentes')}.`}
          </p>
        </div>
      </section>

      {dados.blocos.length > 0 && blocosSel.size === 0 && (
        <Vazio
          icone={<IconeGrafico className="h-7 w-7" />}
          titulo="Nenhum bloco selecionado"
          descricao="Marque ao menos um bloco acima para ver os números."
        />
      )}
    </div>
  );
}
