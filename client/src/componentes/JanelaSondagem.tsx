import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Mensagem } from '../tipos';
import { useSondagem } from '../estado/sondagem';
import { cn, PROTOCOLO } from '../util';
import { Aviso, IconeConversa, IconeExpandir, IconeMinimizar, Modal, TagNatureza } from './ui';

const LARGURA = 440;
const ALTURA = 560;

export function JanelaSondagem() {
  const { ativa, minimizada, minimizar, restaurar, encerrar, registrarCheck } = useSondagem();

  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rascunho, setRascunho] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [posicao, setPosicao] = useState({ x: 0, y: 0 });

  const arrastando = useRef<{ dx: number; dy: number } | null>(null);
  const fimDaLista = useRef<HTMLDivElement>(null);
  const topicoId = ativa?.topico.id ?? null;

  // Posição inicial: canto inferior direito, dentro da janela.
  useEffect(() => {
    if (!ativa) return;
    setPosicao({
      x: Math.max(16, window.innerWidth - LARGURA - 32),
      y: Math.max(16, window.innerHeight - ALTURA - 40),
    });
  }, [ativa?.topico.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega o histórico persistido e, se a conversa estiver vazia, pede a abertura.
  useEffect(() => {
    if (!ativa || !topicoId) return;
    let cancelado = false;
    setMensagens([]);
    setErro(null);
    setCarregando(true);
    api
      .iniciarSondagem(ativa.blocoId, topicoId)
      .then((r) => {
        if (cancelado) return;
        setMensagens(r.mensagens);
        setErro(r.erro);
      })
      .catch((e: Error) => !cancelado && setErro(e.message))
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
  }, [topicoId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensagens.length, carregando]);

  // --- arrastar pela barra de título ---
  const iniciarArraste = (e: React.MouseEvent) => {
    arrastando.current = { dx: e.clientX - posicao.x, dy: e.clientY - posicao.y };
  };

  useEffect(() => {
    const mover = (e: MouseEvent) => {
      if (!arrastando.current) return;
      setPosicao({
        x: Math.min(Math.max(0, e.clientX - arrastando.current.dx), window.innerWidth - 160),
        y: Math.min(Math.max(0, e.clientY - arrastando.current.dy), window.innerHeight - 60),
      });
    };
    const soltar = () => {
      arrastando.current = null;
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
    return () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    };
  }, []);

  const enviar = useCallback(async () => {
    if (!ativa || !topicoId) return;
    const texto = rascunho.trim();
    if (!texto || carregando) return;
    setRascunho('');
    setCarregando(true);
    setErro(null);
    try {
      const r = await api.enviarMensagem(ativa.blocoId, topicoId, texto);
      setMensagens((atuais) => [...atuais, ...r.mensagens]);
      setErro(r.erro);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [ativa, topicoId, rascunho, carregando]);

  // "Sim, marcar": marca o check, agenda a revisão 1 e registra a evidência.
  const finalizarMarcando = async () => {
    if (!ativa) return;
    try {
      await api.marcarCheck(ativa.topico.id, true, {
        modo: 'aprendizagem',
        descricao: `Sondagem realizada (${mensagens.length} mensagens no diálogo).`,
      });
      registrarCheck(ativa.blocoId);
    } catch (e) {
      setErro((e as Error).message);
    }
    setConfirmando(false);
    encerrar();
  };

  // "Só encerrar": fecha sem marcar nada. A conversa segue salva.
  const finalizarSemMarcar = () => {
    setConfirmando(false);
    encerrar();
  };

  if (!ativa) return null;

  // Estado minimizado: barra fixa no rodapé. A conversa não é perdida e
  // o usuário pode navegar por toda a plataforma.
  if (minimizada) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <IconeConversa className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Sondagem: {ativa.topico.titulo}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{ativa.blocoNome}</p>
          </div>
          <button className="btn-secundario" onClick={restaurar}>
            <IconeExpandir />
            Restaurar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="cartao fixed z-40 flex flex-col overflow-hidden shadow-2xl"
        style={{ left: posicao.x, top: posicao.y, width: LARGURA, height: ALTURA }}
      >
        {/* Topo: tópico, natureza e protocolo */}
        <div
          className="cursor-move select-none border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          onMouseDown={iniciarArraste}
        >
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{ativa.topico.titulo}</h3>
            <TagNatureza natureza={ativa.topico.natureza} />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {PROTOCOLO[ativa.topico.natureza]}
          </p>
        </div>

        {/* Corpo: conversa */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {mensagens.map((m) => (
            <div
              key={m.id}
              className={cn('flex', m.papel === 'usuario' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  m.papel === 'usuario'
                    ? 'rounded-br-sm bg-indigo-600 text-white'
                    : 'rounded-bl-sm bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
                )}
              >
                {m.conteudo}
              </div>
            </div>
          ))}

          {carregando && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
                <span className="flex gap-1">
                  {[0, 150, 300].map((atraso) => (
                    <span
                      key={atraso}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"
                      style={{ animationDelay: `${atraso}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}

          {/* Falha da IA nunca bloqueia: a conversa e o caminho manual seguem disponíveis. */}
          {erro && <Aviso tom="atencao">{erro}</Aviso>}

          <div ref={fimDaLista} />
        </div>

        {/* Campo de texto */}
        <div className="border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
          <textarea
            className="campo resize-none text-sm"
            rows={2}
            placeholder="Escreva sua resposta…"
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
          />
          <div className="mt-2 flex justify-end">
            <button className="btn-primario py-1.5" onClick={() => void enviar()} disabled={!rascunho.trim() || carregando}>
              Enviar
            </button>
          </div>
        </div>

        {/* Rodapé: dois botões distintos */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <button className="btn-secundario py-1.5" onClick={minimizar}>
            <IconeMinimizar />
            Minimizar
          </button>
          <button className="btn-primario py-1.5" onClick={() => setConfirmando(true)}>
            Finalizar sondagem
          </button>
        </div>
      </div>

      <Modal
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        titulo={`Marcar "${ativa.topico.titulo}" como estudado?`}
        largura="max-w-md"
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Marcar registra o check, agenda a primeira revisão para daqui a 3 dias e guarda uma
          evidência no log do tópico. A decisão é sua.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-secundario" onClick={finalizarSemMarcar}>
            Só encerrar
          </button>
          <button className="btn-primario" onClick={() => void finalizarMarcando()}>
            Sim, marcar
          </button>
        </div>
      </Modal>
    </>
  );
}
