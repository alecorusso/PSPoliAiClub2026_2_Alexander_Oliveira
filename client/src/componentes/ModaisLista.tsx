import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiListas } from '../api';
import type { ContextoLista, DocumentoFonte, ListaQuestoes, Questao, Topico } from '../tipos';
import { textoParaQuestoes, topicosParaLinhas } from '../util';
import { Aviso, Carregando, IconeBussola, IconeLista, IconeUpload, Modal } from './ui';
import { EXTENSOES_ACEITAS, extrairTexto } from '../extrairTexto';

type Fonte = 'documentos' | 'novos' | 'internet';

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
  const [documentos, setDocumentos] = useState<DocumentoFonte[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [avisoLido, setAvisoLido] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entradaArquivo = useRef<HTMLInputElement>(null);

  const linhas = useMemo(() => topicosParaLinhas(topicos), [topicos]);
  const porId = useMemo(() => new Map(topicos.map((t) => [t.id, t])), [topicos]);

  useEffect(() => {
    if (!aberto) return;
    setTopicoId(topicoInicial);
    setQuantidade('5');
    setSelecionados([]);
    setArquivos([]);
    setAvisoLido(false);
    setErro(null);
    api
      .listarDocumentos(blocoId)
      .then((d) => {
        setDocumentos(d);
        setSelecionados(d.map((x) => x.id));
      })
      .catch(() => setDocumentos([]));
  }, [aberto, blocoId, topicoInicial]);

  const topico = topicoId ? porId.get(topicoId) : null;

  const salvar = async (questoes: Questao[], gabarito: unknown, origem: 'gerada_fontes' | 'gerada_internet') => {
    const lista = await apiListas.criar(blocoId, {
      topico_id: topicoId,
      titulo: `${contexto === 'projeto' ? 'Teste teórico' : 'Lista'} — ${topico?.titulo ?? 'sem tópico'}`,
      questoes,
      gabarito: gabarito as never,
      origem,
      quantidade: questoes.length,
      contexto,
    });
    aoCriar(lista);
    aoFechar();
  };

  const gerar = async (fonte: Fonte) => {
    if (!topicoId) {
      setErro('Escolha o tópico da lista.');
      return;
    }
    setErro(null);
    try {
      let documentosIds = selecionados;

      // "Enviar novos documentos": o texto é extraído aqui e também guardado
      // em documentos_fonte, ficando disponível para as próximas listas.
      if (fonte === 'novos') {
        setOcupado('Lendo os documentos…');
        const novos = [];
        for (const arquivo of arquivos) {
          novos.push({ nome_arquivo: arquivo.name, conteudo_texto: await extrairTexto(arquivo) });
        }
        await api.enviarDocumentos(blocoId, novos);
        const atualizados = await api.listarDocumentos(blocoId);
        const antigos = new Set(documentos.map((d) => d.id));
        documentosIds = atualizados.filter((d) => !antigos.has(d.id)).map((d) => d.id);
        setDocumentos(atualizados);
      }

      setOcupado(fonte === 'internet' ? 'Buscando questões na internet…' : 'Gerando as questões…');
      const r = await apiListas.gerar({
        bloco_id: blocoId,
        topico_id: topicoId,
        quantidade: Number(quantidade) || 5,
        fonte:
          fonte === 'internet'
            ? { tipo: 'internet' }
            : { tipo: 'documentos', documentos_ids: documentosIds },
      });

      if (r.erro || r.questoes.length === 0) {
        // A falha nunca bloqueia: "Enviar lista" continua como caminho manual.
        setErro(r.erro ?? 'A IA não retornou questões.');
        return;
      }
      await salvar(r.questoes, r.gabarito, fonte === 'internet' ? 'gerada_internet' : 'gerada_fontes');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const semDocumentos = documentos.length === 0;

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

      <div className="grid gap-4 md:grid-cols-3">
        {/* 1. Documentos já enviados */}
        <Fonte3 icone={<IconeLista className="h-6 w-6" />} titulo="Usar documentos já enviados">
          {semDocumentos ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Este bloco ainda não tem documentos-fonte. Envie um documento ao lado, ou use a tabela
              de conteúdos para adicionar material.
            </p>
          ) : (
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {documentos.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-indigo-600"
                    checked={selecionados.includes(d.id)}
                    onChange={(e) =>
                      setSelecionados((atuais) =>
                        e.target.checked ? [...atuais, d.id] : atuais.filter((x) => x !== d.id)
                      )
                    }
                  />
                  <span className="truncate">{d.nome_arquivo}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex-1" />
          <button
            className="btn-primario w-full"
            disabled={semDocumentos || selecionados.length === 0 || Boolean(ocupado)}
            onClick={() => void gerar('documentos')}
          >
            Gerar destes documentos
          </button>
        </Fonte3>

        {/* 2. Novos documentos */}
        <Fonte3 icone={<IconeUpload className="h-6 w-6" />} titulo="Enviar novos documentos">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            O texto é extraído e também fica guardado como documento-fonte do bloco.
          </p>
          <input
            ref={entradaArquivo}
            type="file"
            multiple
            accept={EXTENSOES_ACEITAS}
            className="hidden"
            onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
          />
          <button className="btn-secundario w-full" onClick={() => entradaArquivo.current?.click()}>
            Escolher arquivos (.txt, .md, .pdf)
          </button>
          {arquivos.length > 0 && (
            <ul className="space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {arquivos.map((a) => (
                <li key={a.name} className="truncate">
                  {a.name}
                </li>
              ))}
            </ul>
          )}
          <div className="flex-1" />
          <button
            className="btn-primario w-full"
            disabled={arquivos.length === 0 || Boolean(ocupado)}
            onClick={() => void gerar('novos')}
          >
            Enviar e gerar
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
