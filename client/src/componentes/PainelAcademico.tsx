import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiAvaliacoes, apiEntregaveis, apiListas, apiVinculos, type ItemVinculado } from '../api';
import type { Avaliacao, Bloco, LinhaAvaliacao } from '../tipos';
import { CampoEstimativa, minutosNumero, type Estimativa } from './CampoEstimativa';
import {
  calcularMedias,
  cn,
  formatarNota,
  novoId,
  numeroOuNulo,
  textoFaltas,
  type ResultadoMedias,
} from '../util';
import { Aviso, Carregando, IconeBaixo, IconeCalendario, IconeLixeira, IconeMais } from './ui';
import {
  calcularFormula,
  FUNCOES_DISPONIVEIS,
  nomeDeVariavel,
  validarFormula,
  type VariavelFormula,
} from '../formula';

const CHAVE_SOMA = 'soma-esperada-pesos';

/** Quantas avaliações aparecem antes de a lista precisar ser expandida. */
const LIMITE_RECOLHIDO = 5;

/**
 * Painel acadêmico: contador de faltas e calculadora de média.
 * As notas são dado acadêmico informado pelo usuário — a plataforma não avalia
 * nada, apenas guarda e faz a aritmética que ele pediu.
 */
export function PainelAcademico({
  bloco,
  aoAtualizarBloco,
  aoIrParaBloco,
}: {
  bloco: Bloco;
  aoAtualizarBloco: () => void;
  /** Leva para as configurações do bloco, onde limite e média são definidos. */
  aoIrParaBloco: () => void;
}) {
  return (
    <div className="space-y-8">
      <NaturezasDosTopicos />
      <ContadorFaltas bloco={bloco} aoAtualizarBloco={aoAtualizarBloco} aoIrParaBloco={aoIrParaBloco} />
      <Calculadora bloco={bloco} aoIrParaBloco={aoIrParaBloco} aoAtualizarBloco={aoAtualizarBloco} />
    </div>
  );
}

/**
 * Lembrete do que cada natureza de tópico significa, em uma linha.
 * A natureza define o protocolo da sondagem, então vale ter a definição à mão
 * sem precisar abrir o editor da tabela de conteúdos.
 */
function NaturezasDosTopicos() {
  return (
    <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
      <span className="font-medium text-zinc-600 dark:text-zinc-300">Naturezas dos tópicos:</span>{' '}
      <strong className="font-medium">declarativo</strong> — o quê: conceitos, definições e fatos ·{' '}
      <strong className="font-medium">procedimental</strong> — como: passos, técnicas e execução ·{' '}
      <strong className="font-medium">relacional</strong> — por quê: como as partes se conectam e o
      que muda quando uma delas muda.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Contador de faltas
// ---------------------------------------------------------------------------
function ContadorFaltas({
  bloco,
  aoAtualizarBloco,
  aoIrParaBloco,
}: {
  bloco: Bloco;
  aoAtualizarBloco: () => void;
  aoIrParaBloco: () => void;
}) {
  const [faltas, setFaltas] = useState(bloco.faltas_registradas);
  const [rascunho, setRascunho] = useState(String(bloco.faltas_registradas));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setFaltas(bloco.faltas_registradas);
    setRascunho(String(bloco.faltas_registradas));
  }, [bloco.faltas_registradas]);

  const limite = bloco.limite_faltas;

  const gravar = async (valor: number) => {
    const novo = Math.max(0, Math.round(valor));
    setFaltas(novo);
    setRascunho(String(novo));
    setSalvando(true);
    try {
      await api.atualizarBloco(bloco.id, { faltas_registradas: novo });
      aoAtualizarBloco();
    } finally {
      setSalvando(false);
    }
  };

  const proporcao = limite && limite > 0 ? Math.min(faltas / limite, 1) : 0;
  const restam = limite === null ? null : limite - faltas;
  // Âmbar ao se aproximar e ao atingir o limite. Nunca vermelho alarmante.
  const emAtencao = restam !== null && restam <= Math.max(2, Math.ceil((limite ?? 0) * 0.25));

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">Faltas</h3>

      {limite === null ? (
        <Aviso>
          <span className="flex flex-wrap items-center gap-2">
            Este bloco ainda não tem limite de faltas registrado. As faltas continuam sendo
            contadas normalmente.
            <button className="btn-secundario py-1" onClick={aoIrParaBloco}>
              Definir limite
            </button>
          </span>
        </Aviso>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm">
              <span className="text-lg font-semibold">{faltas}</span>
              <span className="text-zinc-500 dark:text-zinc-400"> de {limite}</span>
            </span>
            <span
              className={cn(
                'text-sm',
                emAtencao ? 'text-amber-700 dark:text-amber-300' : 'text-zinc-500 dark:text-zinc-400'
              )}
            >
              {textoFaltas(faltas, limite)}
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                emAtencao ? 'bg-amber-500' : 'bg-indigo-500'
              )}
              style={{ width: `${proporcao * 100}%` }}
            />
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-secundario py-1.5" onClick={() => void gravar(faltas - 1)} disabled={faltas === 0 || salvando}>
          −1 falta
        </button>
        <button className="btn-secundario py-1.5" onClick={() => void gravar(faltas + 1)} disabled={salvando}>
          <IconeMais className="h-3.5 w-3.5" />1 falta
        </button>
        <span className="mx-1 text-xs text-zinc-400 dark:text-zinc-600">ou</span>
        <input
          className="campo w-24 py-1.5"
          type="number"
          min={0}
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={() => void gravar(numeroOuNulo(rascunho) ?? faltas)}
          onKeyDown={(e) => e.key === 'Enter' && void gravar(numeroOuNulo(rascunho) ?? faltas)}
          aria-label="Faltas registradas"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Calculadora de média e simulador
// ---------------------------------------------------------------------------
/** A avaliação do servidor vira linha editável; tudo vazio vira texto vazio. */
function linhaDaAvaliacao(a: Avaliacao): LinhaAvaliacao {
  return {
    id: a.id,
    titulo: a.titulo,
    peso: a.peso === null ? '' : String(a.peso),
    nota: a.nota === null ? '' : String(a.nota),
    data_prevista: a.data_prevista ?? '',
    tempo_estimado_min: a.tempo_estimado_min === null ? '' : String(a.tempo_estimado_min),
    origem_estimativa: a.origem_estimativa,
    tipo_tarefa: a.tipo_tarefa ?? '',
    feita: a.feita === 1,
    realizada: a.realizada === 1,
  };
}

const LINHA_VAZIA = (id: string): LinhaAvaliacao => ({
  id,
  titulo: '',
  peso: '',
  nota: '',
  data_prevista: '',
  tempo_estimado_min: '',
  origem_estimativa: null,
  tipo_tarefa: '',
  feita: false,
  realizada: false,
});

/** Pausa na digitação antes de gravar. */
const ESPERA_SALVAR_MS = 600;

type EstadoSalvamento = 'salvando' | 'salvo' | 'erro';

interface AtividadeDoBloco {
  item_tipo: 'entregavel' | 'lista_questoes';
  item_id: string;
  titulo: string;
}

/** Linha vazia não vira registro; qualquer conteúdo já a torna real. */
const temConteudo = (l: LinhaAvaliacao) =>
  Boolean(
    l.titulo.trim() || l.peso || l.nota || l.data_prevista || l.tempo_estimado_min ||
      l.tipo_tarefa.trim() || l.feita || l.realizada
  );

/** Nota, peso e tempo precisam ser números não negativos. */
function validarCampo(campo: string, mudanca: Partial<LinhaAvaliacao>): string | null {
  if (!['peso', 'nota', 'tempo_estimado_min'].includes(campo)) return null;
  const bruto = String((mudanca as Record<string, unknown>)[campo] ?? '').trim();
  if (!bruto) return null;
  const n = Number(bruto.replace(',', '.'));
  if (!Number.isFinite(n)) return 'Use um número.';
  if (n < 0) return 'Não pode ser negativo.';
  return null;
}

function Calculadora({
  bloco,
  aoIrParaBloco,
  aoAtualizarBloco,
}: {
  bloco: Bloco;
  aoIrParaBloco: () => void;
  aoAtualizarBloco: () => void;
}) {
  const [linhas, setLinhas] = useState<LinhaAvaliacao[]>([]);
  const [simuladas, setSimuladas] = useState<Record<string, string>>({});
  const [simulando, setSimulando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  // Estado do salvamento por linha: some sozinho depois de "Salvo".
  const [estado, setEstado] = useState<Record<string, EstadoSalvamento>>({});
  const [invalidos, setInvalidos] = useState<Record<string, string>>({});
  const [vinculos, setVinculos] = useState<Record<string, ItemVinculado[]>>({});
  const [atividades, setAtividades] = useState<AtividadeDoBloco[]>([]);
  const cronometro = useRef<number | null>(null);
  const ultimasLinhas = useRef<LinhaAvaliacao[]>([]);
  // Com a fórmula ligada, os pesos deixam de valer e sumem da tela.
  const usarFormula = bloco.usar_formula === 1;
  const [trocandoModo, setTrocandoModo] = useState(false);
  // Lista longa fica recolhida: só as primeiras avaliações aparecem.
  const [expandida, setExpandida] = useState(false);
  // Qual linha está com os campos de cronograma abertos. Só uma por vez.
  const [agendaAberta, setAgendaAberta] = useState<string | null>(null);
  const [somaEsperada, setSomaEsperada] = useState<number | null>(() => {
    try {
      const bruto = localStorage.getItem(CHAVE_SOMA);
      return bruto ? Number(bruto) || null : null;
    } catch {
      return null;
    }
  });

  const carregarVinculos = useCallback(async () => {
    try {
      const v = await apiVinculos.doBloco(bloco.id);
      setVinculos(v.porAvaliacao);
    } catch {
      setVinculos({});
    }
  }, [bloco.id]);

  useEffect(() => {
    apiAvaliacoes
      .listar(bloco.id)
      .then((avs) => setLinhas(avs.map(linhaDaAvaliacao)))
      .finally(() => setCarregando(false));
    void carregarVinculos();
    // Entregáveis e listas do bloco, para a multi-seleção dos vínculos.
    void Promise.all([apiEntregaveis.listar(bloco.id), apiListas.listar(bloco.id, 'prova')])
      .then(([es, ls]) =>
        setAtividades([
          ...es.map((e): AtividadeDoBloco => ({ item_tipo: 'entregavel', item_id: e.id, titulo: e.titulo })),
          ...ls.map((l): AtividadeDoBloco => ({ item_tipo: 'lista_questoes', item_id: l.id, titulo: l.titulo })),
        ])
      )
      .catch(() => setAtividades([]));
  }, [bloco.id, carregarVinculos]);

  const trocarSomaEsperada = (valor: number | null) => {
    setSomaEsperada(valor);
    try {
      if (valor === null) localStorage.removeItem(CHAVE_SOMA);
      else localStorage.setItem(CHAVE_SOMA, String(valor));
    } catch {
      // armazenamento indisponível — vale só para esta sessão
    }
  };

  const resultado = useMemo(
    () => calcularMedias(linhas, simulando ? simuladas : {}, bloco.media_aprovacao, somaEsperada),
    [linhas, simuladas, simulando, bloco.media_aprovacao, somaEsperada]
  );

  // Cada avaliação com título vira uma variável da fórmula.
  const variaveis = useMemo(() => {
    const usados = new Set<string>();
    return linhas
      .filter((l) => l.titulo.trim())
      .map((l) => ({
        nome: nomeDeVariavel(l.titulo, usados),
        rotulo: l.titulo.trim(),
        valor: numeroOuNulo(l.nota),
        simulada: numeroOuNulo(simuladas[l.id] ?? ''),
      }));
  }, [linhas, simuladas]);

  // Sem peso, a grade perde uma coluna.
  const colunas = usarFormula
    ? 'grid-cols-[1fr_6rem_2rem_2rem]'
    : 'grid-cols-[1fr_5rem_6rem_2rem_2rem]';
  const temMais = linhas.length > LIMITE_RECOLHIDO;
  const visiveis = temMais && !expandida ? linhas.slice(0, LIMITE_RECOLHIDO) : linhas;

  const adicionar = () => {
    // A nova linha entra no fim: abrir a lista evita que ela nasça escondida.
    // Nada é gravado até ela ganhar conteúdo.
    setExpandida(true);
    setLinhas((atuais) => [...atuais, LINHA_VAZIA(novoId())]);
  };

  const trocarModo = async (porFormula: boolean) => {
    setTrocandoModo(true);
    try {
      await api.atualizarBloco(bloco.id, { usar_formula: porFormula });
      aoAtualizarBloco();
    } finally {
      setTrocandoModo(false);
    }
  };

  const remover = (id: string) => {
    setLinhas((atuais) => atuais.filter((l) => l.id !== id));
    setSimuladas(({ [id]: _removida, ...resto }) => resto);
  };

  /**
   * Salvamento automático.
   *
   * As notas simuladas NUNCA são enviadas: elas vivem em `simuladas`, fora das
   * linhas, e o que vai ao servidor são sempre as linhas reais — ligar a
   * simulação não muda nada do que é gravado.
   */
  const gravar = useCallback(
    async (lista: LinhaAvaliacao[], chaves: string[]) => {
      // Linha totalmente vazia não vira registro: só ocupa a tela até ganhar
      // algum conteúdo.
      const comConteudo = lista.filter((l) => temConteudo(l));
      setEstado((e) => ({ ...e, ...Object.fromEntries(chaves.map((k) => [k, 'salvando'])) }));
      try {
        const avs = await apiAvaliacoes.salvar(
          bloco.id,
          comConteudo.map((l) => ({
            ...l,
            data_prevista: l.data_prevista || null,
            tempo_estimado_min: minutosNumero(l.tempo_estimado_min),
            origem_estimativa: l.tempo_estimado_min ? l.origem_estimativa : null,
            tipo_tarefa: l.tipo_tarefa.trim() || null,
            feita: l.feita,
            realizada: l.realizada,
          }))
        );
        // A resposta traz o que o servidor decidiu (realizada, concluído): as
        // linhas vazias em edição continuam onde estão.
        setLinhas((atuais) => {
          const gravadas = new Map(avs.map((a) => [a.id, linhaDaAvaliacao(a)]));
          return atuais.map((l) => gravadas.get(l.id) ?? l);
        });
        setEstado((e) => ({ ...e, ...Object.fromEntries(chaves.map((k) => [k, 'salvo'])) }));
        window.setTimeout(
          () => setEstado((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !chaves.includes(k)))),
          2500
        );
        aoAtualizarBloco();
      } catch {
        // O valor digitado permanece no campo: nada do que o usuário escreveu
        // é descartado por uma falha de rede.
        setEstado((e) => ({ ...e, ...Object.fromEntries(chaves.map((k) => [k, 'erro'])) }));
      }
    },
    [bloco.id, aoAtualizarBloco]
  );

  /** Campos de texto e número: espera uma pausa na digitação. */
  const agendarGravacao = useCallback(
    (lista: LinhaAvaliacao[], chave: string) => {
      ultimasLinhas.current = lista;
      if (cronometro.current) window.clearTimeout(cronometro.current);
      cronometro.current = window.setTimeout(() => void gravar(ultimasLinhas.current, [chave]), ESPERA_SALVAR_MS);
    },
    [gravar]
  );

  /** Seletores, datas e caixas de marcar: gravam na hora. */
  const gravarAgora = useCallback(
    (lista: LinhaAvaliacao[], chave: string) => {
      if (cronometro.current) window.clearTimeout(cronometro.current);
      void gravar(lista, [chave]);
    },
    [gravar]
  );

  const editar = (id: string, mudanca: Partial<LinhaAvaliacao>, imediato = false) => {
    const campo = Object.keys(mudanca)[0];
    const erro = validarCampo(campo, mudanca);
    setInvalidos((v) => {
      const proximo = { ...v };
      if (erro) proximo[`${id}:${campo}`] = erro;
      else delete proximo[`${id}:${campo}`];
      return proximo;
    });

    setLinhas((atuais) => {
      const novas = atuais.map((l) => (l.id === id ? { ...l, ...mudanca } : l));
      // Entrada inválida não é gravada: o último valor válido continua no banco.
      if (!erro) {
        if (imediato) gravarAgora(novas, id);
        else agendarGravacao(novas, id);
      }
      return novas;
    });
  };

  const tentarDeNovo = (id: string) => void gravar(linhas, [id]);

  if (carregando) return <Carregando />;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Média e simulação</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          {!usarFormula && (
            <span className="flex items-center gap-2">
              <label htmlFor="soma-esperada">Soma esperada dos pesos</label>
              <select
                id="soma-esperada"
                className="campo w-28 py-1 text-xs"
                value={somaEsperada === null ? '' : String(somaEsperada)}
                onChange={(e) => trocarSomaEsperada(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Livre</option>
                <option value="10">10</option>
                <option value="100">100</option>
              </select>
            </span>
          )}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={usarFormula}
              disabled={trocandoModo}
              onChange={(e) => void trocarModo(e.target.checked)}
            />
            Calcular por fórmula
          </label>
        </div>
      </div>

      {/* Grade editável */}
      <div className="cartao overflow-hidden">
        <div
          className={cn(
            'grid gap-2 border-b border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400',
            colunas
          )}
        >
          <span>Avaliação</span>
          {!usarFormula && <span>Peso</span>}
          <span>Nota</span>
          <span />
          <span />
        </div>

        {linhas.length === 0 ? (
          <p className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
            Nenhuma avaliação cadastrada.
          </p>
        ) : (
          <div className="relative">
            {visiveis.map((l) => {
            const semNota = numeroOuNulo(l.nota) === null;
            const simulada = simulando && semNota;
            const agendada = Boolean(l.data_prevista || l.tempo_estimado_min);
            return (
              <Fragment key={l.id}>
              <div
                className={cn(
                  'grid items-center gap-2 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800/60',
                  colunas
                )}
              >
                <input
                  className="campo py-1.5"
                  placeholder="Nome da avaliação"
                  value={l.titulo}
                  onChange={(e) => editar(l.id, { titulo: e.target.value })}
                  onBlur={() => gravarAgora(linhas, l.id)}
                />
                {!usarFormula && (
                  <input
                    className={cn('campo py-1.5', invalidos[`${l.id}:peso`] && 'border-amber-500')}
                    placeholder="—"
                    inputMode="decimal"
                    value={l.peso}
                    onChange={(e) => editar(l.id, { peso: e.target.value })}
                    onBlur={() => gravarAgora(linhas, l.id)}
                    aria-label={`Peso de ${l.titulo || 'avaliação'}`}
                  />
                )}
                {simulada ? (
                  // Nota hipotética: itálico e fundo distinto. Nunca salva no banco.
                  <input
                    className="campo bg-amber-50 py-1.5 italic dark:bg-amber-950/40"
                    placeholder="simular"
                    inputMode="decimal"
                    value={simuladas[l.id] ?? ''}
                    onChange={(e) => setSimuladas((s) => ({ ...s, [l.id]: e.target.value }))}
                    aria-label={`Nota simulada de ${l.titulo || 'avaliação'}`}
                  />
                ) : (
                  <input
                    className={cn('campo py-1.5', invalidos[`${l.id}:nota`] && 'border-amber-500')}
                    placeholder={l.realizada || l.feita ? 'aguardando' : '—'}
                    title={l.realizada || l.feita ? 'Realizada, aguardando nota' : undefined}
                    inputMode="decimal"
                    value={l.nota}
                    onChange={(e) => editar(l.id, { nota: e.target.value })}
                    onBlur={() => gravarAgora(linhas, l.id)}
                    aria-label={`Nota de ${l.titulo || 'avaliação'}`}
                  />
                )}
                {/* Estado do salvamento desta linha. Em repouso, nada. */}
                <IndicadorSalvamento
                  estado={estado[l.id]}
                  aoTentarDeNovo={() => tentarDeNovo(l.id)}
                />
                {/* Entrada inválida não é gravada; o último valor válido fica. */}
                {(invalidos[`${l.id}:nota`] || invalidos[`${l.id}:peso`]) && (
                  <span className="whitespace-nowrap text-xs text-amber-700 dark:text-amber-400">
                    {invalidos[`${l.id}:nota`] ?? invalidos[`${l.id}:peso`]}
                  </span>
                )}
                <button
                  className={cn(
                    'rounded-md px-1.5 py-1 transition',
                    agendada
                      ? 'text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10'
                      : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  )}
                  onClick={() => setAgendaAberta((a) => (a === l.id ? null : l.id))}
                  aria-expanded={agendaAberta === l.id}
                  aria-label={`Cronograma de ${l.titulo || 'avaliação'}`}
                  title="Data e tempo estimado (opcionais)"
                >
                  <IconeCalendario className="h-3.5 w-3.5" />
                </button>
                <button
                  className="btn-perigo px-1.5 py-1"
                  onClick={() => remover(l.id)}
                  aria-label={`Remover ${l.titulo || 'avaliação'}`}
                  title="Remover avaliação"
                >
                  <IconeLixeira className="h-3.5 w-3.5" />
                </button>
              </div>

              {agendaAberta === l.id && (
                <div className="surgir space-y-3 border-b border-zinc-100 bg-zinc-50 px-3 py-3 dark:border-zinc-800/60 dark:bg-zinc-900/40">
                  <div className="sm:max-w-xs">
                    <label className="rotulo">Data prevista</label>
                    <input
                      className="campo"
                      type="date"
                      value={l.data_prevista}
                      onChange={(e) => editar(l.id, { data_prevista: e.target.value }, true)}
                      aria-label={`Data prevista de ${l.titulo || 'avaliação'}`}
                    />
                  </div>
                  <CampoEstimativa
                    valor={{
                      minutos: l.tempo_estimado_min,
                      origem: l.origem_estimativa,
                      tipoTarefa: l.tipo_tarefa,
                    }}
                    aoMudar={(v: Estimativa) =>
                      editar(l.id, {
                        tempo_estimado_min: v.minutos,
                        origem_estimativa: v.origem,
                        tipo_tarefa: v.tipoTarefa,
                      })
                    }
                    descricao={`Estudar para ${l.titulo || 'a avaliação'}`}
                    contexto={bloco.nome}
                    rotulo="Tempo estimado de preparação"
                  />
                  {/* Com nota, a nota já diz tudo: não há o que marcar. Sem nota,
                      "Realizada" tira a avaliação da fila enquanto o resultado
                      não sai. */}
                  {l.nota.trim() === '' ? (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-indigo-600"
                        checked={l.realizada || l.feita}
                        onChange={(e) =>
                          editar(
                            l.id,
                            { realizada: e.target.checked, feita: e.target.checked && l.feita },
                            true
                          )
                        }
                      />
                      Realizada
                      {(l.realizada || l.feita) && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">aguardando nota</span>
                      )}
                    </label>
                  ) : (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">Nota registrada: {l.nota}</p>
                  )}

                  {/* Quem realiza esta avaliação. Com itens vinculados, ela sai
                      da fila do cronograma: o trabalho está neles. */}
                  <AtividadesVinculadas
                    avaliacaoId={l.id}
                    atividades={atividades}
                    vinculadosAqui={vinculos[l.id] ?? []}
                    todosOsVinculos={vinculos}
                    titulosDasAvaliacoes={Object.fromEntries(linhas.map((x) => [x.id, x.titulo]))}
                    aoMudar={carregarVinculos}
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    A data e o tempo são opcionais: sem eles, a avaliação continua contando na média
                    e apenas não entra no cronograma. Marcar como realizada a tira do cronograma sem
                    exigir nota — o resultado pode chegar depois.
                  </p>
                </div>
              )}
              </Fragment>
            );
            })}

            {/* Degradê sobre as últimas linhas visíveis, sinalizando que há mais. */}
            {temMais && !expandida && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent dark:from-zinc-900" />
            )}
          </div>
        )}

        {temMais && (
          <button
            type="button"
            onClick={() => setExpandida((v) => !v)}
            aria-expanded={expandida}
            className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-200 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
          >
            {expandida ? 'Mostrar menos' : `Mostrar todas as ${linhas.length} avaliações`}
            <IconeBaixo className={cn('h-3.5 w-3.5 transition', expandida && 'rotate-180')} />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-secundario py-1.5" onClick={adicionar}>
          <IconeMais className="h-3.5 w-3.5" />
          Adicionar avaliação
        </button>
        {/* Sem botão de salvar: cada alteração é gravada sozinha. */}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          As alterações são salvas automaticamente.
        </span>
      </div>

      {/* Simulação */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={simulando}
            onChange={(e) => setSimulando(e.target.checked)}
          />
          Simular notas
        </label>
        <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
          Preenche notas hipotéticas nas avaliações sem nota. Nada disso é salvo.
        </span>
        {simulando && (
          <button className="btn-sutil py-1" onClick={() => setSimuladas({})}>
            Limpar simulação
          </button>
        )}
      </div>

      {!usarFormula && (
        <>
          {resultado.avisoPesos && (
            <div className="mt-3">
              <Aviso>{resultado.avisoPesos}</Aviso>
            </div>
          )}

          <Resultados
            resultado={resultado}
            mediaAprovacao={bloco.media_aprovacao}
            simulando={simulando}
            aoIrParaBloco={aoIrParaBloco}
          />
        </>
      )}

      {usarFormula && (
        <FormulaMedia
          bloco={bloco}
          variaveis={variaveis}
          simulando={simulando}
          aoAtualizarBloco={aoAtualizarBloco}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Os três resultados, ao vivo
// ---------------------------------------------------------------------------
function Resultados({
  resultado,
  mediaAprovacao,
  simulando,
  aoIrParaBloco,
}: {
  resultado: ResultadoMedias;
  mediaAprovacao: number | null;
  simulando: boolean;
  aoIrParaBloco: () => void;
}) {
  const { mediaAtual, mediaProjetada, notaNecessaria, situacao } = resultado;

  const textoNecessaria = () => {
    if (mediaAprovacao === null) return 'Este bloco não tem média para aprovação registrada.';
    switch (situacao) {
      case 'garantida':
        return `As notas já informadas alcançam a média ${formatarNota(mediaAprovacao)}, independentemente das restantes.`;
      case 'inalcancavel':
        return `Com as notas informadas, a média ${formatarNota(mediaAprovacao)} não é mais alcançável nas avaliações restantes.`;
      case 'sem_restantes':
        return mediaAtual !== null && mediaAtual >= mediaAprovacao
          ? `Todas as avaliações têm nota. A média final é ${formatarNota(mediaAtual)}, igual ou acima de ${formatarNota(mediaAprovacao)}.`
          : `Todas as avaliações têm nota. A média final é ${formatarNota(mediaAtual)}.`;
      case 'em_andamento':
        return `Média ${formatarNota(notaNecessaria)} nas avaliações restantes para fechar ${formatarNota(mediaAprovacao)}.`;
      default:
        return 'Informe pesos e ao menos uma nota para calcular.';
    }
  };

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Resultado rotulo="Média atual" valor={formatarNota(mediaAtual)} nota="Só as avaliações com nota informada." />
      <Resultado
        rotulo="Média final projetada"
        valor={formatarNota(mediaProjetada)}
        nota={
          simulando
            ? 'Com as notas simuladas; as demais assumem a média atual.'
            : 'As avaliações sem nota assumem a média atual, então o valor coincide com ela.'
        }
        destaque={simulando}
      />
      <Resultado
        rotulo="Nota necessária"
        valor={situacao === 'em_andamento' ? formatarNota(notaNecessaria) : '—'}
        nota={textoNecessaria()}
        acao={
          mediaAprovacao === null ? (
            <button className="btn-secundario mt-2 py-1" onClick={aoIrParaBloco}>
              Definir média
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

function Resultado({
  rotulo,
  valor,
  nota,
  destaque,
  acao,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  destaque?: boolean;
  acao?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        destaque
          ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
          : 'border-zinc-200 dark:border-zinc-800'
      )}
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{rotulo}</p>
      <p className={cn('mt-0.5 text-2xl font-semibold tabular-nums', destaque && 'italic')}>{valor}</p>
      <p className="mt-1 text-xs leading-snug text-zinc-500 dark:text-zinc-500">{nota}</p>
      {acao}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fórmula da média
// As variáveis são as próprias avaliações da disciplina. A fórmula é
// interpretada por um avaliador próprio (src/formula.ts), nunca por eval.
// ---------------------------------------------------------------------------
function FormulaMedia({
  bloco,
  variaveis,
  simulando,
  aoAtualizarBloco,
}: {
  bloco: Bloco;
  variaveis: (VariavelFormula & { simulada: number | null })[];
  simulando: boolean;
  aoAtualizarBloco: () => void;
}) {
  const [formula, setFormula] = useState(bloco.formula_media ?? '');
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFormula(bloco.formula_media ?? '');
  }, [bloco.formula_media]);

  const semNotas = useMemo(
    () => variaveis.map(({ nome, rotulo }) => ({ nome, rotulo, valor: null })),
    [variaveis]
  );
  const comNotasReais = useMemo(
    () => variaveis.map(({ nome, rotulo, valor }) => ({ nome, rotulo, valor })),
    [variaveis]
  );
  const comSimuladas = useMemo(
    () => variaveis.map(({ nome, rotulo, valor, simulada }) => ({ nome, rotulo, valor: valor ?? simulada })),
    [variaveis]
  );

  // Erro de escrita é mostrado enquanto se digita, sem depender das notas.
  const erroDeEscrita = useMemo(() => validarFormula(formula, semNotas), [formula, semNotas]);
  const resultado = useMemo(
    () => (formula.trim() ? calcularFormula(formula, comNotasReais) : null),
    [formula, comNotasReais]
  );
  const resultadoSimulado = useMemo(
    () => (simulando && formula.trim() ? calcularFormula(formula, comSimuladas) : null),
    [simulando, formula, comSimuladas]
  );

  const inserir = (nome: string) => {
    const el = campo.current;
    const inicio = el?.selectionStart ?? formula.length;
    const fim = el?.selectionEnd ?? formula.length;
    const novo = formula.slice(0, inicio) + nome + formula.slice(fim);
    setFormula(novo);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(inicio + nome.length, inicio + nome.length);
    });
  };

  const salvar = async () => {
    setSalvando(true);
    setMensagem(null);
    try {
      await api.atualizarBloco(bloco.id, { formula_media: formula });
      aoAtualizarBloco();
      setMensagem(formula.trim() ? 'Fórmula salva.' : 'Fórmula removida.');
    } catch (e) {
      setMensagem((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const alterada = (bloco.formula_media ?? '') !== formula;

  return (
    <section className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Fórmula da média</h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Opcional. Escreva a regra da disciplina usando as avaliações como variáveis — útil quando a
        média não é uma simples ponderação.
      </p>

      {variaveis.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Cadastre ao menos uma avaliação acima para ter variáveis disponíveis.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Variáveis:</span>
            {variaveis.map((v) => (
              <button
                key={v.nome}
                type="button"
                onClick={() => inserir(v.nome)}
                title={`${v.rotulo}${v.valor === null ? ' — sem nota' : ` — nota ${formatarNota(v.valor)}`}`}
                className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 transition hover:bg-indigo-100 hover:text-indigo-800 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-indigo-950 dark:hover:text-indigo-200"
              >
                {v.nome}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={campo}
              className="campo flex-1 font-mono text-sm"
              placeholder="Ex.: (P1 + P2) / 2"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !erroDeEscrita && void salvar()}
              aria-label="Fórmula da média"
            />
            <button
              className="btn-primario py-1.5"
              onClick={() => void salvar()}
              disabled={salvando || Boolean(erroDeEscrita) || !alterada}
            >
              Salvar fórmula
            </button>
          </div>

          <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
            <p>
              Aceita + − × ÷ ^, parênteses, comparações e as funções{' '}
              {FUNCOES_DISPONIVEIS.join(', ')}. Separe argumentos com ";". As variáveis vêm do nome
              de cada avaliação.
            </p>
            <p>
              Para as melhores ou piores notas:{' '}
              <code className="font-mono">soma_maiores(2; P1; P2; P3)</code> soma as 2 maiores —{' '}
              <code className="font-mono">soma_menores</code> faz o oposto.
            </p>
          </div>

          {erroDeEscrita && (
            <div className="mt-2">
              <Aviso tom="atencao">{erroDeEscrita}</Aviso>
            </div>
          )}
          {mensagem && !erroDeEscrita && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{mensagem}</p>
          )}

          {resultado && !erroDeEscrita && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Resultado
                rotulo="Média pela fórmula"
                valor={resultado.ok ? formatarNota(resultado.valor) : '—'}
                nota={
                  resultado.ok
                    ? 'Calculada com as notas informadas.'
                    : resultado.erro
                }
              />
              {resultadoSimulado && (
                <Resultado
                  rotulo="Com as notas simuladas"
                  valor={resultadoSimulado.ok ? formatarNota(resultadoSimulado.valor) : '—'}
                  nota={
                    resultadoSimulado.ok
                      ? 'As avaliações sem nota usam os valores simulados.'
                      : resultadoSimulado.erro
                  }
                  destaque
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Estado do salvamento automático, por linha
// ---------------------------------------------------------------------------
/** Discreto: "Salvando…", "Salvo" por alguns segundos, e nada em repouso. */
function IndicadorSalvamento({
  estado,
  aoTentarDeNovo,
}: {
  estado: EstadoSalvamento | undefined;
  aoTentarDeNovo: () => void;
}) {
  if (!estado) return null;
  if (estado === 'erro') {
    return (
      <span className="flex items-center gap-1 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
        Não foi possível salvar
        <button className="underline underline-offset-2" onClick={aoTentarDeNovo}>
          Tentar novamente
        </button>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap text-xs text-zinc-400 dark:text-zinc-500">
      {estado === 'salvando' ? 'Salvando…' : 'Salvo'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Atividades que realizam a avaliação
// ---------------------------------------------------------------------------
/**
 * Uma avaliação vinculada é realizada PELAS atividades escolhidas: o trabalho
 * passa a ser representado por elas no cronograma, e a avaliação sai da fila
 * como item próprio — o mesmo trabalho nunca conta duas vezes.
 *
 * A nota continua sendo o que conclui a avaliação: concluir os vinculados não
 * preenche nota nenhuma.
 */
function AtividadesVinculadas({
  avaliacaoId,
  atividades,
  vinculadosAqui,
  todosOsVinculos,
  titulosDasAvaliacoes,
  aoMudar,
}: {
  avaliacaoId: string;
  atividades: AtividadeDoBloco[];
  vinculadosAqui: ItemVinculado[];
  todosOsVinculos: Record<string, ItemVinculado[]>;
  titulosDasAvaliacoes: Record<string, string>;
  aoMudar: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);

  const chave = (t: string, i: string) => `${t}:${i}`;
  const aqui = new Set(vinculadosAqui.map((v) => chave(v.item_tipo, v.item_id)));

  /** A qual OUTRA avaliação um item já pertence. */
  const donoDe = (t: string, i: string) => {
    for (const [id, itens] of Object.entries(todosOsVinculos)) {
      if (id === avaliacaoId) continue;
      if (itens.some((v) => chave(v.item_tipo, v.item_id) === chave(t, i))) {
        return titulosDasAvaliacoes[id] ?? 'outra avaliação';
      }
    }
    return null;
  };

  const alternar = async (a: AtividadeDoBloco) => {
    const marcado = aqui.has(chave(a.item_tipo, a.item_id));
    const novos = marcado
      ? vinculadosAqui.filter((v) => chave(v.item_tipo, v.item_id) !== chave(a.item_tipo, a.item_id))
      : [...vinculadosAqui, a];
    setErro(null);
    try {
      await apiVinculos.definirItens(
        avaliacaoId,
        novos.map((v) => ({ item_tipo: v.item_tipo, item_id: v.item_id }))
      );
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  const todosConcluidos =
    vinculadosAqui.length > 0 && vinculadosAqui.every((v) => v.concluido === 1);

  return (
    <div>
      <label className="rotulo">Atividades vinculadas</label>
      {atividades.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Este bloco ainda não tem entregáveis nem listas.
        </p>
      ) : (
        <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
          {atividades.map((a) => {
            const dono = donoDe(a.item_tipo, a.item_id);
            return (
              <label
                key={chave(a.item_tipo, a.item_id)}
                className={cn(
                  'flex items-center gap-2 rounded px-1 py-0.5 text-xs',
                  dono ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800'
                )}
              >
                <input
                  type="checkbox"
                  className="h-3 w-3 shrink-0 accent-indigo-600"
                  checked={aqui.has(chave(a.item_tipo, a.item_id))}
                  disabled={Boolean(dono)}
                  onChange={() => void alternar(a)}
                />
                <span className="truncate">{a.titulo}</span>
                {dono && <span className="shrink-0 text-zinc-400">já é de {dono}</span>}
              </label>
            );
          })}
        </div>
      )}

      {vinculadosAqui.length > 0 && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          O trabalho desta avaliação é representado por estas atividades; ela não entra no
          cronograma como item próprio.
        </p>
      )}
      {/* Sem cobrança e sem pedir a nota: só o fato. */}
      {todosConcluidos && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Todas as atividades vinculadas foram concluídas.
        </p>
      )}
      {erro && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{erro}</p>}
    </div>
  );
}
