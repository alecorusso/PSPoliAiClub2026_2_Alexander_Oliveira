import { useState } from 'react';
import { api, apiDocumentos } from '../api';
import type { Bloco, LinhaEditor } from '../tipos';
import { linhasParaPayload, novoId, sugestoesParaLinhas } from '../util';
import { EditorTabelaConteudos } from '../componentes/EditorTabelaConteudos';
import { Aviso, Carregando, IconeBussola, IconeLista, IconeUpload } from '../componentes/ui';
import { SeletorDocumentos } from '../componentes/SeletorDocumentos';

type Etapa = 'escolha' | 'revisao';
type Origem = 'documentos' | 'manual' | 'roteiro';

/**
 * Primeira entrada num bloco (tabela_conteudos_construida = 0).
 * As três opções têm peso visual igual — nenhuma é "a recomendada".
 * Qualquer uma delas termina na tela de revisão, editável; só ao confirmar
 * a tabela é marcada como construída.
 */
export function ConstruirTabela({ bloco, aoConcluir }: { bloco: Bloco; aoConcluir: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>('escolha');
  const [origem, setOrigem] = useState<Origem>('manual');
  const [linhas, setLinhas] = useState<LinhaEditor[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tema, setTema] = useState('');
  // Os documentos vêm do repositório do bloco, que já deduplica.
  const [documentosIds, setDocumentosIds] = useState<string[]>([]);

  const irParaRevisao = (novas: LinhaEditor[], deOnde: Origem, mensagemErro: string | null) => {
    setLinhas(novas);
    setOrigem(deOnde);
    setErro(mensagemErro);
    setEtapa('revisao');
  };

  // Opção 1 — documentos do repositório do bloco.
  const gerarDosDocumentos = async () => {
    if (documentosIds.length === 0) return;
    setErro(null);
    setOcupado('Gerando a árvore de tópicos…');
    try {
      const r = await api.extrairTabela(bloco.id, documentosIds);
      // Fica registrado de quais documentos a tabela saiu.
      await apiDocumentos.registrarUso(documentosIds, 'tabela_conteudos', bloco.id);
      irParaRevisao(sugestoesParaLinhas(r.topicos), 'documentos', r.erro);
    } catch (e) {
      // Falha da IA nunca bloqueia: cai na tela de revisão vazia.
      irParaRevisao([], 'documentos', (e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  // Opção 2 — manual: abre o editor com a árvore vazia.
  const montarManualmente = () => {
    irParaRevisao(
      [{ id: novoId(), titulo: '', natureza: 'declarativo', peso: 'medio', nivel: 0 }],
      'manual',
      null
    );
  };

  // Opção 3 — roteiro: a árvore vem do conhecimento do modelo.
  const buscarRoteiro = async () => {
    if (!tema.trim()) return;
    setErro(null);
    setOcupado('Buscando um roteiro de estudos…');
    try {
      const r = await api.buscarRoteiro(tema);
      irParaRevisao(sugestoesParaLinhas(r.topicos), 'roteiro', r.erro);
    } catch (e) {
      irParaRevisao([], 'roteiro', (e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  const confirmar = async () => {
    setOcupado('Salvando…');
    try {
      const uteis = linhas.filter((l) => l.titulo.trim());
      await api.salvarTopicos(bloco.id, linhasParaPayload(uteis), true);
      aoConcluir();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  // -------------------------------------------------------------------------
  // Tela de revisão da árvore gerada
  // -------------------------------------------------------------------------
  if (etapa === 'revisao') {
    const rotuloOrigem = {
      documentos: 'a partir dos documentos enviados',
      manual: 'montada por você',
      roteiro: 'a partir do roteiro de estudos',
    }[origem];

    return (
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Revise a tabela de conteúdos</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Proposta {rotuloOrigem}. Edite à vontade: títulos, natureza, peso, ordem e nível. Nada é
            salvo até você confirmar.
          </p>
        </div>

        {erro && (
          <div className="mb-4">
            <Aviso tom="atencao">{erro}</Aviso>
          </div>
        )}

        <div className="cartao p-4">
          <EditorTabelaConteudos linhas={linhas} aoMudar={setLinhas} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button className="btn-secundario" onClick={() => setEtapa('escolha')} disabled={Boolean(ocupado)}>
            Voltar às opções
          </button>
          <div className="flex items-center gap-3">
            {ocupado && <Carregando texto={ocupado} />}
            <button
              className="btn-primario"
              onClick={() => void confirmar()}
              disabled={Boolean(ocupado) || linhas.every((l) => !l.titulo.trim())}
            >
              Confirmar tabela de conteúdos
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Escolha entre as três opções (peso visual igual)
  // -------------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 text-center">
        <h2 className="text-lg font-semibold">Monte a tabela de conteúdos de {bloco.nome}</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Escolha um caminho. Todos terminam na mesma tela de revisão, onde você edita tudo antes de
          confirmar.
        </p>
      </div>

      {ocupado && (
        <div className="mb-5 flex justify-center">
          <Carregando texto={ocupado} />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {/* 1. Documentos */}
        <Opcao icone={<IconeUpload className="h-6 w-6" />} titulo="Enviar documentos">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Os melhores documentos são a ementa da disciplina, a literatura ou apostila de
            referência, e outros materiais sobre o assunto.
          </p>
          <SeletorDocumentos
            blocoId={bloco.id}
            fluxo="tabela_conteudos"
            selecionados={documentosIds}
            aoMudarSelecao={setDocumentosIds}
          />
          <button
            className="btn-primario w-full"
            onClick={() => void gerarDosDocumentos()}
            disabled={documentosIds.length === 0 || Boolean(ocupado)}
          >
            Gerar a partir dos documentos
          </button>
        </Opcao>

        {/* 2. Manual */}
        <Opcao icone={<IconeLista className="h-6 w-6" />} titulo="Montar manualmente">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Abre o editor com a árvore vazia. Você adiciona tópicos e subtópicos na ordem que
            quiser, sem depender da IA.
          </p>
          <div className="flex-1" />
          <button className="btn-primario w-full" onClick={montarManualmente} disabled={Boolean(ocupado)}>
            Abrir editor vazio
          </button>
        </Opcao>

        {/* 3. Roteiro */}
        <Opcao icone={<IconeBussola className="h-6 w-6" />} titulo="Buscar roteiro de estudos">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Informe o tema e a IA propõe uma árvore de tópicos a partir do conhecimento dela.
          </p>
          <input
            className="campo"
            placeholder="Ex.: cálculo integral, redes de computadores…"
            value={tema}
            onChange={(e) => setTema(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void buscarRoteiro()}
          />
          <div className="flex-1" />
          <button
            className="btn-primario w-full"
            onClick={() => void buscarRoteiro()}
            disabled={!tema.trim() || Boolean(ocupado)}
          >
            Buscar roteiro
          </button>
        </Opcao>
      </div>
    </div>
  );
}

function Opcao({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cartao flex flex-col gap-3 p-5">
      <span className="text-indigo-600 dark:text-indigo-400">{icone}</span>
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {children}
    </div>
  );
}
