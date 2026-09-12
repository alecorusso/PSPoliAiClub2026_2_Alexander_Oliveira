import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { PaginaInicio } from './paginas/Inicio';
import { PaginaBlocos } from './paginas/Blocos';
import { PaginaBloco } from './paginas/Bloco';
import { JanelaSondagem } from './componentes/JanelaSondagem';
import { PainelFoco } from './componentes/PainelFoco';
import { ProvedorSondagem, useSondagem } from './estado/sondagem';
import { ProvedorFoco, useFoco } from './estado/foco';
import { cn, relogio } from './util';
import {
  IconeBlocos,
  IconeCalendario,
  IconeCasa,
  IconeGrafico,
  IconeLua,
  IconeRelogio,
  IconeSol,
} from './componentes/ui';

export default function App() {
  return (
    <ProvedorSondagem>
      <ProvedorFoco>
        <BrowserRouter>
          <Layout />
        </BrowserRouter>
      </ProvedorFoco>
    </ProvedorSondagem>
  );
}

function Layout() {
  const { ativa, minimizada } = useSondagem();

  return (
    <div className="flex h-full">
      <BarraLateral />
      <main
        className={cn(
          'min-w-0 flex-1 overflow-y-auto',
          // Espaço para a barra da sondagem minimizada, fixa no rodapé.
          ativa && minimizada && 'pb-16'
        )}
      >
        <Routes>
          <Route path="/" element={<Navigate to="/inicio" replace />} />
          <Route path="/inicio" element={<PaginaInicio />} />
          <Route path="/blocos" element={<PaginaBlocos />} />
          <Route path="/blocos/:id" element={<PaginaBloco />} />
          <Route path="*" element={<Navigate to="/inicio" replace />} />
        </Routes>
      </main>
      <JanelaSondagem />
      <PainelFoco />
    </div>
  );
}

function BarraLateral() {
  const [escuro, setEscuro] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', escuro);
    try {
      localStorage.setItem('tema', escuro ? 'escuro' : 'claro');
    } catch {
      // armazenamento indisponível — o tema vale só para esta sessão
    }
  }, [escuro]);

  const classe = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
      isActive
        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
        : 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
    );

  return (
    <aside
      aria-label="Navegação principal"
      className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/60 px-3 py-4 dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      <div className="mb-5 px-2">
        <p className="text-sm font-semibold">Plataforma de Estudos</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">Registra e organiza</p>
      </div>

      <nav className="space-y-1">
        <NavLink to="/inicio" className={classe}>
          <IconeCasa />
          Início
        </NavLink>
        <NavLink to="/blocos" className={classe}>
          <IconeBlocos />
          Blocos
        </NavLink>

        {/* Entradas desabilitadas — páginas fora desta etapa. */}
        <ItemDesabilitado icone={<IconeCalendario />} rotulo="Calendário" />
        <ItemDesabilitado icone={<IconeGrafico />} rotulo="Desempenho" />
      </nav>

      <div className="flex-1" />

      <IndicadorFoco />

      <button
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
        onClick={() => setEscuro((v) => !v)}
      >
        {escuro ? <IconeSol /> : <IconeLua />}
        {escuro ? 'Tema claro' : 'Tema escuro'}
      </button>
    </aside>
  );
}

function ItemDesabilitado({ icone, rotulo }: { icone: React.ReactNode; rotulo: string }) {
  return (
    <span
      title="Em desenvolvimento"
      aria-disabled="true"
      className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 dark:text-zinc-600"
    >
      {icone}
      {rotulo}
    </span>
  );
}

/**
 * Indicador discreto e persistente da sessão de foco, visível em qualquer
 * página. Quando não há sessão, vira o botão de iniciar.
 */
function IndicadorFoco() {
  const { sessao, pausado, focadoMs, iniciar, mostrarPainel } = useFoco();

  if (!sessao) {
    return (
      <button
        className="mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
        onClick={() => void iniciar(null)}
      >
        <IconeRelogio />
        Iniciar foco
      </button>
    );
  }

  return (
    <button
      className="mb-1 flex w-full items-center gap-2.5 rounded-lg bg-zinc-200/70 px-3 py-2 text-left text-sm transition hover:bg-zinc-200 dark:bg-zinc-800/70 dark:hover:bg-zinc-800"
      onClick={mostrarPainel}
      title="Abrir o painel da sessão de foco"
    >
      <IconeRelogio className={cn('h-4 w-4 shrink-0', !pausado && 'text-indigo-600 dark:text-indigo-400')} />
      <span className="min-w-0 flex-1">
        <span className="block font-medium tabular-nums">{relogio(focadoMs)}</span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
          {pausado ? 'Em pausa' : (sessao.bloco_nome ?? 'Sessão de foco')}
        </span>
      </span>
    </button>
  );
}
