import { useCallback, useEffect, useRef, useState } from 'react';
import { apiChat } from '../api';
import type { Mensagem, Modo } from '../tipos';
import { cn } from '../util';
import { Aviso, Etiqueta, IconeChevron, IconeConversa, IconeLixeira } from './ui';

const ROTULO_MODO: Record<Modo, string> = {
  prova: 'Prova',
  projeto: 'Projeto',
  aprendizagem: 'Aprendizagem',
};

/**
 * Chat lateral do bloco, presente nos três modos.
 * A conversa é escopada ao bloco (mensagens com topico_id nulo) e o único
 * contexto enviado ao modelo, além do histórico, é o rótulo do modo ativo.
 */
export function ChatBloco({
  blocoId,
  modo,
  aberto,
  aoAlternar,
  versao,
}: {
  blocoId: string;
  modo: Modo;
  aberto: boolean;
  aoAlternar: (aberto: boolean) => void;
  /** Incrementado de fora (ex.: "Corrigir com a IA") para recarregar o histórico. */
  versao: number;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rascunho, setRascunho] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [limpando, setLimpando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  const recarregar = useCallback(() => {
    apiChat
      .historico(blocoId)
      .then(setMensagens)
      .catch((e: Error) => setErro(e.message));
  }, [blocoId]);

  useEffect(() => {
    recarregar();
  }, [recarregar, versao]);

  useEffect(() => {
    if (aberto) fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensagens.length, carregando, aberto]);

  const enviar = async () => {
    const texto = rascunho.trim();
    if (!texto || carregando) return;
    setRascunho('');
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiChat.enviar(blocoId, texto, modo);
      setMensagens((atuais) => [...atuais, ...r.mensagens]);
      setErro(r.erro);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  const limpar = async () => {
    await apiChat.limpar(blocoId);
    setMensagens([]);
    setLimpando(false);
  };

  // Recolhido: faixa estreita, sempre acessível em qualquer modo.
  if (!aberto) {
    return (
      <div className="flex w-11 shrink-0 flex-col items-center gap-2 border-l border-zinc-200 bg-zinc-100/60 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        <button
          className="btn-sutil px-2"
          onClick={() => aoAlternar(true)}
          title="Abrir o chat do bloco"
          aria-label="Abrir o chat do bloco"
        >
          <IconeConversa />
        </button>
        {mensagens.length > 0 && (
          <span className="rounded bg-zinc-200 px-1 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {mensagens.length}
          </span>
        )}
      </div>
    );
  }

  return (
    <aside
      aria-label="Chat do bloco"
      className="flex w-80 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 xl:w-96"
    >
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <IconeConversa className="h-4 w-4 shrink-0 text-zinc-400" />
        <h2 className="flex-1 text-sm font-semibold">Chat do bloco</h2>
        <Etiqueta>{ROTULO_MODO[modo]}</Etiqueta>
        {mensagens.length > 0 && (
          <button
            className="btn-sutil px-1.5 py-1"
            onClick={() => setLimpando(true)}
            title="Limpar a conversa"
            aria-label="Limpar a conversa"
          >
            <IconeLixeira className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          className="btn-sutil px-1.5 py-1"
          onClick={() => aoAlternar(false)}
          title="Recolher o chat"
          aria-label="Recolher o chat"
        >
          <IconeChevron className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {mensagens.length === 0 && !carregando && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Converse sobre este bloco. O modo ativo ({ROTULO_MODO[modo].toLowerCase()}) é o único
            contexto enviado junto com o histórico.
          </p>
        )}

        {mensagens.map((m) => (
          <div key={m.id} className={cn('flex', m.papel === 'usuario' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed',
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

        {/* Erro visível, nunca bloqueante: a conversa continua utilizável. */}
        {erro && <Aviso tom="atencao">{erro}</Aviso>}

        <div ref={fim} />
      </div>

      <div className="border-t border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <textarea
          className="campo resize-none text-sm"
          rows={2}
          placeholder="Escreva uma mensagem…"
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
          <button
            className="btn-primario py-1.5"
            onClick={() => void enviar()}
            disabled={!rascunho.trim() || carregando}
          >
            Enviar
          </button>
        </div>
      </div>

      {limpando && (
        <div className="border-t border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/40">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Apagar toda a conversa deste bloco?</p>
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn-secundario py-1" onClick={() => setLimpando(false)}>
              Cancelar
            </button>
            <button className="btn bg-red-600 py-1 text-white hover:bg-red-500" onClick={() => void limpar()}>
              Apagar
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
