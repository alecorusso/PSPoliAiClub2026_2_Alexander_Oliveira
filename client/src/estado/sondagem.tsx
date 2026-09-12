import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Topico } from '../tipos';

interface SondagemAtiva {
  blocoId: string;
  blocoNome: string;
  topico: Topico;
}

interface ContextoSondagem {
  ativa: SondagemAtiva | null;
  minimizada: boolean;
  /** Incrementa sempre que um check é marcado — as telas usam para recarregar. */
  versao: number;
  /** Bloco cujo aviso "revisar a tabela de conteúdos?" está pendente. */
  sugestaoTabela: string | null;
  abrir: (ativa: SondagemAtiva) => void;
  minimizar: () => void;
  restaurar: () => void;
  encerrar: () => void;
  /** Chamado após marcar o check no fim da sondagem. */
  registrarCheck: (blocoId: string) => void;
  dispensarSugestao: () => void;
}

const Contexto = createContext<ContextoSondagem | null>(null);

export function ProvedorSondagem({ children }: { children: ReactNode }) {
  const [ativa, setAtiva] = useState<SondagemAtiva | null>(null);
  const [minimizada, setMinimizada] = useState(false);
  const [versao, setVersao] = useState(0);
  const [sugestaoTabela, setSugestaoTabela] = useState<string | null>(null);

  const abrir = useCallback((nova: SondagemAtiva) => {
    setAtiva(nova);
    setMinimizada(false);
  }, []);

  // Minimizar não perde a conversa nem marca nenhum check: apenas esconde o painel.
  const minimizar = useCallback(() => setMinimizada(true), []);
  const restaurar = useCallback(() => setMinimizada(false), []);

  const encerrar = useCallback(() => {
    setAtiva(null);
    setMinimizada(false);
  }, []);

  const registrarCheck = useCallback((blocoId: string) => {
    setVersao((v) => v + 1);
    setSugestaoTabela(blocoId);
  }, []);

  const dispensarSugestao = useCallback(() => setSugestaoTabela(null), []);

  const valor = useMemo(
    () => ({
      ativa,
      minimizada,
      versao,
      sugestaoTabela,
      abrir,
      minimizar,
      restaurar,
      encerrar,
      registrarCheck,
      dispensarSugestao,
    }),
    [ativa, minimizada, versao, sugestaoTabela, abrir, minimizar, restaurar, encerrar, registrarCheck, dispensarSugestao]
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSondagem() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useSondagem precisa estar dentro de ProvedorSondagem.');
  return ctx;
}
