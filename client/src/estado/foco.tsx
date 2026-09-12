import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiFoco } from '../api';
import type { SessaoFoco } from '../tipos';

export interface ResumoSessao {
  focadoMs: number;
  decorridoMs: number;
  pausadoMs: number;
  blocoNome: string | null;
}

interface ContextoFoco {
  sessao: SessaoFoco | null;
  pausado: boolean;
  /** Tempo focado, já descontadas as pausas. */
  focadoMs: number;
  /** Painel em destaque visível (o indicador da barra lateral é independente). */
  painelVisivel: boolean;
  /** Resumo da última sessão encerrada, para mostrar o tempo total. */
  ultimoResumo: ResumoSessao | null;
  iniciar: (blocoId: string | null, blocoNome?: string | null) => Promise<void>;
  pausar: () => void;
  retomar: () => void;
  encerrar: () => Promise<void>;
  mostrarPainel: () => void;
  ocultarPainel: () => void;
  dispensarResumo: () => void;
}

const Contexto = createContext<ContextoFoco | null>(null);

/**
 * Sessão de foco: registro voluntário de tempo.
 * Não existe bloqueio de sites, abas ou aplicativos — nem meta, streak ou
 * comparação entre dias.
 */
export function ProvedorFoco({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<SessaoFoco | null>(null);
  const [pausado, setPausado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const [painelVisivel, setPainelVisivel] = useState(false);
  const [ultimoResumo, setUltimoResumo] = useState<ResumoSessao | null>(null);

  // Tempo acumulado em pausa, e o instante em que a pausa atual começou.
  const pausadoMs = useRef(0);
  const pausaIniciadaEm = useRef<number | null>(null);

  // Uma sessão aberta sobrevive ao recarregamento da página.
  useEffect(() => {
    apiFoco
      .ativa()
      .then((s) => {
        if (!s) return;
        setSessao(s);
        setPainelVisivel(true);
      })
      .catch(() => {
        /* sem sessão ativa recuperável */
      });
  }, []);

  useEffect(() => {
    if (!sessao) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sessao]);

  const inicioMs = sessao ? new Date(sessao.inicio).getTime() : 0;
  const pausaCorrente = pausaIniciadaEm.current === null ? 0 : agora - pausaIniciadaEm.current;
  const focadoMs = sessao ? Math.max(0, agora - inicioMs - pausadoMs.current - pausaCorrente) : 0;

  const iniciar = useCallback(async (blocoId: string | null, blocoNome?: string | null) => {
    const nova = await apiFoco.iniciar(blocoId);
    pausadoMs.current = 0;
    pausaIniciadaEm.current = null;
    setPausado(false);
    setUltimoResumo(null);
    setAgora(Date.now());
    setSessao({ ...nova, bloco_nome: nova.bloco_nome ?? blocoNome ?? null });
    setPainelVisivel(true);
  }, []);

  const pausar = useCallback(() => {
    if (pausaIniciadaEm.current !== null) return;
    pausaIniciadaEm.current = Date.now();
    setPausado(true);
  }, []);

  const retomar = useCallback(() => {
    if (pausaIniciadaEm.current === null) return;
    pausadoMs.current += Date.now() - pausaIniciadaEm.current;
    pausaIniciadaEm.current = null;
    setPausado(false);
  }, []);

  const encerrar = useCallback(async () => {
    if (!sessao) return;
    if (pausaIniciadaEm.current !== null) {
      pausadoMs.current += Date.now() - pausaIniciadaEm.current;
      pausaIniciadaEm.current = null;
    }
    const pausas = pausadoMs.current;
    try {
      const encerrada = await apiFoco.encerrar(sessao.id);
      setUltimoResumo({
        decorridoMs: encerrada.decorrido_ms,
        pausadoMs: pausas,
        focadoMs: Math.max(0, encerrada.decorrido_ms - pausas),
        blocoNome: sessao.bloco_nome ?? null,
      });
    } finally {
      pausadoMs.current = 0;
      setPausado(false);
      setSessao(null);
      setPainelVisivel(false);
    }
  }, [sessao]);

  const valor = useMemo(
    () => ({
      sessao,
      pausado,
      focadoMs,
      painelVisivel,
      ultimoResumo,
      iniciar,
      pausar,
      retomar,
      encerrar,
      mostrarPainel: () => setPainelVisivel(true),
      ocultarPainel: () => setPainelVisivel(false),
      dispensarResumo: () => setUltimoResumo(null),
    }),
    [sessao, pausado, focadoMs, painelVisivel, ultimoResumo, iniciar, pausar, retomar, encerrar]
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useFoco() {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useFoco precisa estar dentro de ProvedorFoco.');
  return ctx;
}
