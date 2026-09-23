import { useEffect, useMemo, useRef, useState } from 'react';
import { apiDocumentos, apiListas, apiVinculos } from '../api';
import type { ContextoLista, ListaQuestoes, OrigemLista, OrigemPaginas, Questao, Topico } from '../tipos';
import { textoParaQuestoes, topicosParaLinhas } from '../util';
import { Aviso, Carregando, Confirmacao, IconeBussola, IconeLista, IconeUpload, Modal } from './ui';
import { SeletorDocumentos } from './SeletorDocumentos';
// "Enviar lista" recebe o arquivo com as próprias questões: não é material
// do bloco, então não passa pelo repositório.
import { EXTENSOES_ACEITAS, extrairTexto } from '../extrairTexto';
import {
  CampoEstimativa,
  ESTIMATIVA_VAZIA,
  minutosNumero,
  type Estimativa,
} from './CampoEstimativa';

/** Campos de agenda que fazem a lista entrar no cronograma. Todos opcionais. */
function BlocoAgenda({
  data,
  aoMudarData,
  estimativa,
  aoMudarEstimativa,
  descricao,
}: {
  data: string;
  aoMudarData: (v: string) => void;
  estimativa: Estimativa;
  aoMudarEstimativa: (v: Estimativa) => void;
  descricao: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div>
        <label className="rotulo">Quando pretende fazer</label>
        <input className="campo" type="date" value={data} onChange={(e) => aoMudarData(e.target.value)} />
      </div>
      <CampoEstimativa
        valor={estimativa}
        aoMudar={aoMudarEstimativa}
        descricao={descricao}
        contexto="lista de questões"
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Sem prazo e sem tempo, a lista fica registrada mas não entra no cronograma.
      </p>
    </div>
  );
}

// As duas fontes de documento viraram uma: o seletor já cobre escolher do
// repositório e enviar um novo.
type Fonte = 'documentos' | 'internet';

const AVISO_INTERNET =
  'Questões da internet podem não refletir o estilo de cobrança da sua disciplina.';

/**
 * "Criar lista de questões": três fontes com peso visual igual.
 * A busca na internet exige confirmação explícita.
 */
export function ModalCriarLista({
  aberto,
  blocoId,
  topicos,
  topicoInicial,
  contexto,
  titulo,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  blocoId: string;
  topicos: Topico[];
  topicoInicial: string | null;
  contexto: ContextoLista;
  titulo: string;
  aoFechar: () => void;
  aoCriar: (lista: ListaQuestoes) => void;
}) {
  const [topicoId, setTopicoId] = useState<string | null>(topicoInicial);
  const [quantidade, setQuantidade] = useState('5');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  // A lista pode realizar uma avaliação do bloco.
  const [avaliacaoId, setAvaliacaoId] = useState('');
  const [avisoLido, setAvisoLido] = useState(false);
  const [data, setData] = useState('');
  const [estimativa, setEstimativa] = useState<Estimativa>(ESTIMATIVA_VAZIA);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Os documentos não tratam do tópico: nada foi gerado. Gerar mesmo assim,
  // pelo conhecimento geral, só com confirmação.
  const [semRelevancia, setSemRelevancia] = useState<string | null>(null);
  const [confirmandoGeral, setConfirmandoGeral] = useState(false);

  const linhas = useMemo(() => topicosParaLinhas(topicos), [topicos]);
  const porId = useMemo(() => new Map(topicos.map((t) => [t.id, t])), [topicos]);

  useEffect(() => {
    if (!aberto) return;
    setTopicoId(topicoInicial);
    setQuantidade('5');
    setSelecionados([]);
    setAvisoLido(false);
    setData('');
    setEstimativa(ESTIMATIVA_VAZIA);
    setErro(null);
    setSemRelevancia(null);
  }, [aberto, blocoId, topicoInicial]);

  const topico = topicoId ? porId.get(topicoId) : null;

  const salvar = async (
    questoes: Questao[],
    gabarito: unknown,
    origem: Exclude<OrigemLista, 'enviada'>,
    origemPaginas: OrigemPaginas[] | null = null
  ) => {
    const lista = await apiListas.criar(blocoId, {
      topico_id: topicoId,
      titulo: `${contexto === 'projeto' ? 'Teste teórico' : 'Lista'} — ${topico?.titulo ?? 'sem tópico'}`,
      questoes,
      gabarito: gabarito as never,
      origem,
      quantidade: questoes.length,
      contexto,
      data_prevista: data || null,
      tempo_estimado_min: minutosNumero(estimativa.minutos),
      origem_estimativa: estimativa.minutos ? estimativa.origem : null,
      tipo_tarefa: estimativa.tipoTarefa.trim() || null,
      origem_paginas: origemPaginas,
    });
    aoCriar(lista);
    aoFechar();
    return lista;
  };

  const gerar = async (fonte: Fonte | 'geral') => {
    if (!topicoId) {
      setErro('Escolha o tópico da lista.');
      return;
    }
    setErro(null);
    setSemRelevancia(null);
    try {
      const documentosIds = selecionados;

      setOcupado(
        fonte === 'internet'
          ? 'Buscando questões na internet…'
          : fonte === 'geral'
            ? 'Gerando as questões…'
            : 'Buscando os trechos do tópico e gerando as questões…'
      );
      const r = await apiListas.gerar({
        bloco_id: blocoId,
        topico_id: topicoId,
        quantidade: Number(quantidade) || 5,
        fonte:
          fonte === 'documentos'
            ? { tipo: 'documentos', documentos_ids: documentosIds }
            : { tipo: fonte },
      });

      // Nenhum trecho trata do tópico: nada fora do tópico é gerado.
      if (r.sem_relevancia) {
        setSemRelevancia(r.aviso ?? 'Os documentos selecionados não parecem tratar deste tópico.');
        return;
      }
      if (r.erro || r.questoes.length === 0) {
        // A falha nunca bloqueia: "Enviar lista" continua como caminho manual.
        setErro(r.erro ?? 'A IA não retornou questões.');
        return;
      }
      const lista = await salvar(
        r.questoes,
        r.gabarito,
        fonte === 'internet' ? 'gerada_internet' : fonte === 'geral' ? 'gerada_geral' : 'gerada_fontes',
        r.origem_paginas ?? null
      );
      if (avaliacaoId && lista) {
        await apiVinculos.definirAvaliacao('lista_questoes', lista.id, avaliacaoId);
      }
      // Fica registrado de quais documentos a lista saiu.
      if (fonte === 'documentos' && documentosIds.length > 0 && lista) {
        await apiDocumentos.registrarUso(documentosIds, 'lista_questoes', lista.id);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };


  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={titulo} largura="max-w-4xl">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="rotulo">Tópico</label>
          <select
            className="campo"
            value={topicoId ?? ''}
            onChange={(e) => setTopicoId(e.target.value || null)}
            disabled={Boolean(topicoInicial)}
          >
            <option value="">Escolha um tópico…</option>
            {linhas.map((l) => (
              <option key={l.id} value={l.id}>
                {'— '.repeat(l.nivel)}
                {l.titulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="rotulo">Quantidade de questões</label>
          <input
            className="campo"
            type="number"
            min={1}
            max={20}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 sm:max-w-sm">
        <SeletorDeAvaliacao blocoId={blocoId} valor={avaliacaoId} aoMudar={setAvaliacaoId} />
      </div>

      <div className="mb-4">
        <BlocoAgenda
          data={data}
          aoMudarData={setData}
          estimativa={estimativa}
          aoMudarEstimativa={setEstimativa}
          descricao={`Resolver ${quantidade} questões de ${topico?.titulo ?? 'um tópico'}`}
        />
      </div>

      {ocupado && (
        <div className="mb-4 flex justify-center">
          <Carregando texto={ocupado} />
        </div>
      )}
      {erro && (
        <div className="mb-4">
          <Aviso tom="atencao">{erro}</Aviso>
        </div>
      )}
      {semRelevancia && (
        <div className="mb-4 space-y-2">
          <Aviso>{semRelevancia}</Aviso>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button className="btn-secundario py-1.5" onClick={() => setConfirmandoGeral(true)} disabled={Boolean(ocupado)}>
              Gerar mesmo assim, pelo conhecimento geral
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              ou escolha outros documentos, ou busque na internet.
            </span>
          </div>
        </div>
      )}

      <Confirmacao
        aberto={confirmandoGeral}
        titulo="Gerar pelo conhecimento geral?"
        mensagem={`As questões sobre "${topico?.titulo ?? 'este tópico'}" não virão dos seus documentos: serão geradas a partir do conhecimento geral da IA, sem a notação e o nível do seu material. A lista fica marcada como "Gerada por conhecimento geral".`}
        rotuloConfirmar="Gerar"
        aoConfirmar={() => {
          setConfirmandoGeral(false);
          void gerar('geral');
        }}
        aoCancelar={() => setConfirmandoGeral(false)}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {/* 1. Documentos já enviados */}
        <Fonte3 icone={<IconeLista className="h-6 w-6" />} titulo="Usar documentos do bloco">
          <SeletorDocumentos
            blocoId={blocoId}
            fluxo="lista_questoes"
            selecionados={selecionados}
            aoMudarSelecao={setSelecionados}
          />
          <div className="flex-1" />
          <button
            className="btn-primario w-full"
            disabled={selecionados.length === 0 || Boolean(ocupado)}
            onClick={() => void gerar('documentos')}
          >
            Gerar destes documentos
          </button>
        </Fonte3>

        {/* 3. Internet — exige confirmação explícita */}
        <Fonte3 icone={<IconeBussola className="h-6 w-6" />} titulo="Buscar na internet">
          <Aviso tom="atencao">{AVISO_INTERNET}</Aviso>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600"
              checked={avisoLido}
              onChange={(e) => setAvisoLido(e.target.checked)}
            />
            <span className="text-zinc-600 dark:text-zinc-400">Li o aviso e quero buscar na internet.</span>
          </label>
          <div className="flex-1" />
          <button
            className="btn-primario w-full"
            disabled={!avisoLido || Boolean(ocupado)}
            onClick={() => void gerar('internet')}
          >
            Buscar na internet
          </button>
        </Fonte3>
      </div>
    </Modal>
  );
}

function Fonte3({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cartao flex flex-col gap-3 p-4">
      <span className="text-indigo-600 dark:text-indigo-400">{icone}</span>
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {children}
    </div>
  );
}

/**
 * "Enviar lista": upload de arquivo ou colagem de texto.
 * Sem gabarito próprio, o gabarito é gerado pela IA e salvo junto.
 */
export function ModalEnviarLista({
  aberto,
  blocoId,
  topicos,
  topicoInicial,
  contexto,
  aoFechar,
  aoCriar,
}: {
  aberto: boolean;
  blocoId: string;
  topicos: Topico[];
  topicoInicial: string | null;
  contexto: ContextoLista;
  aoFechar: () => void;
  aoCriar: (lista: ListaQuestoes) => void;
}) {
  const [topicoId, setTopicoId] = useState<string | null>(topicoInicial);
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [temGabarito, setTemGabarito] = useState(false);
  const [data, setData] = useState('');
  const [estimativa, setEstimativa] = useState<Estimativa>(ESTIMATIVA_VAZIA);
  const [gabarito, setGabarito] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);

  const linhas = useMemo(() => topicosParaLinhas(topicos), [topicos]);

  useEffect(() => {
    if (!aberto) return;
    setTopicoId(topicoInicial);
    setTitulo('');
    setTexto('');
    setTemGabarito(false);
    setGabarito('');
    setData('');
    setEstimativa(ESTIMATIVA_VAZIA);
    setErro(null);
  }, [aberto, topicoInicial]);

  const carregarArquivo = async (arquivo: File | undefined, destino: 'questoes' | 'gabarito') => {
    if (!arquivo) return;
    setOcupado('Lendo o arquivo…');
    setErro(null);
    try {
      const conteudo = await extrairTexto(arquivo);
      if (destino === 'questoes') {
        setTexto(conteudo);
        if (!titulo.trim()) setTitulo(arquivo.name.replace(/\.[^.]+$/, ''));
      } else {
        setGabarito(conteudo);
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async () => {
    if (!texto.trim()) {
      setErro('Cole o texto da lista ou envie um arquivo.');
      return;
    }
    setErro(null);
    try {
      const questoes = textoParaQuestoes(texto);
      let gabaritoFinal: unknown = temGabarito ? gabarito.trim() || null : null;
      let avisoGabarito: string | null = null;

      // Sem gabarito próprio: a IA resolve as questões e o resultado é salvo.
      if (!temGabarito) {
        setOcupado('Gerando o gabarito…');
        const r = await apiListas.gerarGabarito(questoes);
        gabaritoFinal = r.gabarito.length ? r.gabarito : null;
        avisoGabarito = r.erro;
      }

      setOcupado('Salvando…');
      const lista = await apiListas.criar(blocoId, {
        topico_id: topicoId,
        titulo: titulo.trim() || 'Lista enviada',
        questoes,
        gabarito: gabaritoFinal as never,
        origem: 'enviada',
        quantidade: Array.isArray(questoes) ? questoes.length : null,
        contexto,
        data_prevista: data || null,
        tempo_estimado_min: minutosNumero(estimativa.minutos),
        origem_estimativa: estimativa.minutos ? estimativa.origem : null,
        tipo_tarefa: estimativa.tipoTarefa.trim() || null,
      });

      // A lista é salva mesmo quando o gabarito falha.
      if (avisoGabarito) setErro(avisoGabarito);
      aoCriar(lista);
      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Enviar lista"
      descricao="Envie um arquivo ou cole o texto de uma lista que você já tem."
      largura="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="rotulo">Título</label>
            <input
              className="campo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Prova 2023 — 2ª chamada"
            />
          </div>
          <div>
            <label className="rotulo">Tópico</label>
            <select
              className="campo"
              value={topicoId ?? ''}
              onChange={(e) => setTopicoId(e.target.value || null)}
              disabled={Boolean(topicoInicial)}
            >
              <option value="">Sem tópico</option>
              {linhas.map((l) => (
                <option key={l.id} value={l.id}>
                  {'— '.repeat(l.nivel)}
                  {l.titulo}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="rotulo">Questões</label>
          <input
            ref={entradaArquivo}
            type="file"
            accept={EXTENSOES_ACEITAS}
            className="hidden"
            onChange={(e) => void carregarArquivo(e.target.files?.[0], 'questoes')}
          />
          <button className="btn-secundario mb-2" onClick={() => entradaArquivo.current?.click()}>
            <IconeUpload />
            Enviar arquivo (.txt, .md, .pdf)
          </button>
          <textarea
            className="campo resize-y font-mono text-xs"
            rows={8}
            placeholder={'1. Primeira questão…\n2. Segunda questão…'}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>

        <BlocoAgenda
          data={data}
          aoMudarData={setData}
          estimativa={estimativa}
          aoMudarEstimativa={setEstimativa}
          descricao={`Resolver a lista ${titulo.trim() || 'enviada'}`}
        />

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={temGabarito}
            onChange={(e) => setTemGabarito(e.target.checked)}
          />
          Esta lista já vem com gabarito
        </label>

        {temGabarito ? (
          <div className="surgir">
            <label className="rotulo">Gabarito</label>
            <textarea
              className="campo resize-y font-mono text-xs"
              rows={6}
              placeholder={'1. Resposta…\n2. Resposta…'}
              value={gabarito}
              onChange={(e) => setGabarito(e.target.value)}
            />
          </div>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Sem gabarito próprio, a IA resolve as questões e o gabarito é salvo junto com a lista.
            Se a geração falhar, a lista é salva do mesmo jeito.
          </p>
        )}

        {erro && <Aviso tom="atencao">{erro}</Aviso>}
      </div>

      <div className="mt-5 flex items-center justify-end gap-3">
        {ocupado && <Carregando texto={ocupado} />}
        <button className="btn-secundario" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="btn-primario" onClick={() => void salvar()} disabled={Boolean(ocupado) || !texto.trim()}>
          Salvar lista
        </button>
      </div>
    </Modal>
  );
}

/**
 * Escolha da avaliação antes de a lista existir: aqui só se guarda a escolha,
 * e o vínculo é criado quando a lista é gravada.
 */
function SeletorDeAvaliacao({
  blocoId,
  valor,
  aoMudar,
}: {
  blocoId: string;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  const [avaliacoes, setAvaliacoes] = useState<{ id: string; titulo: string }[]>([]);

  useEffect(() => {
    apiVinculos
      .doBloco(blocoId)
      .then((v) => setAvaliacoes(v.avaliacoes))
      .catch(() => setAvaliacoes([]));
  }, [blocoId]);

  if (avaliacoes.length === 0) return null;

  return (
    <div>
      <label className="rotulo">Vale para a avaliação</label>
      <select
        className="campo"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        aria-label="Vale para a avaliação"
      >
        <option value="">Nenhuma</option>
        {avaliacoes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.titulo || 'Avaliação sem nome'}
          </option>
        ))}
      </select>
    </div>
  );
}
