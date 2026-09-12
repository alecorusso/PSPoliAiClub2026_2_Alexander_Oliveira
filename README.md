# Plataforma de Estudos

Plataforma de estudos pessoal, de usuário único, com interface inteiramente em português (pt-BR).

A ideia central é que a plataforma **registra e organiza, mas nunca avalia**. Todo progresso é
marcado pelo próprio usuário: não há nota, score nem percentual de domínio — apenas um checklist
binário, um log qualitativo de evidências e revisões espaçadas. A IA conduz a conversa de sondagem,
mas nunca emite veredito nem marca nada.

Como é uma aplicação de usuário único rodando localmente, **não há login, autenticação ou cadastro**.

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| Front-end | React 19 + TypeScript + Vite 6 + Tailwind CSS 4 |
| Back-end | Node.js + Express 4 |
| Banco | SQLite local em arquivo, via `better-sqlite3` (`server/dados.db`) |
| IA | API do Google Gemini (Google AI Studio), chamada apenas pelo servidor |
| Leitura de PDF | `pdfjs-dist` (extração feita no navegador) |

Monorepo simples, sem workspaces:

```
/server   Express + better-sqlite3   → API REST, banco em ./server/dados.db
/client   React + Vite               → interface
```

O cliente **nunca acessa o banco diretamente**: tudo passa pela API REST em `/api`.
Em desenvolvimento, o Vite faz proxy de `/api` para `http://localhost:3333`.

O schema é criado por uma migration executada na inicialização do servidor
(`CREATE TABLE IF NOT EXISTS`), então é seguro subir o servidor quantas vezes quiser.

---

## Como rodar

Requisitos: **Node.js 20 ou superior** (testado no Node 24) e npm.

```bash
npm install     # instala a raiz e, em seguida, /server e /client
npm run dev     # sobe o servidor e o cliente juntos (concurrently)
```

- Interface: <http://localhost:5173>
- API: <http://localhost:3333/api>

> **Nota sobre o npm 12+:** o `better-sqlite3` precisa rodar um script de instalação para compilar
> ou baixar o binário nativo. A aprovação já está registrada em `server/package.json`
> (campo `allowScripts`), então o `npm install` funciona sem intervenção. Se o binário não for
> encontrado, rode `npm --prefix server rebuild better-sqlite3`.

Outros comandos:

```bash
npm run build           # build de produção do cliente
npm --prefix server start   # só o servidor
npm --prefix client dev     # só o cliente
```

O banco fica em `server/dados.db`. Para começar do zero, apague esse arquivo (e os `.db-wal` /
`.db-shm` ao lado) e suba o servidor de novo.

---

## Como configurar a chave do Gemini

1. Gere uma chave no [Google AI Studio](https://aistudio.google.com/apikey).
2. Copie `.env.example` para `.env` na **raiz do projeto** (o servidor também aceita `server/.env`).
3. Preencha:

```env
GEMINI_API_KEY=sua-chave-aqui
GEMINI_MODELO=gemini-2.5-flash   # opcional
PORT=3333                        # opcional
```

4. Reinicie o `npm run dev`.

A chave **nunca chega ao cliente**: todas as chamadas passam por `server/gemini.js`.

**Sem a chave, a aplicação continua funcionando normalmente.** Todas as funções de IA entram em
modo simulado, devolvendo dados mock com atraso artificial — as respostas de sondagem vêm marcadas
com `(modo simulado — sem GEMINI_API_KEY)` e as árvores de tópicos vêm com uma estrutura de exemplo.
O rodapé do log do servidor diz qual modo está ativo na subida.

Se a chave existir mas a chamada falhar (chave inválida, rede fora, JSON malformado), a falha
**nunca bloqueia a tela**: as funções de árvore caem para árvore vazia com uma mensagem de erro
na interface, e o caminho manual continua disponível.

---

## O que existe nesta etapa

### Barra lateral
`Início` e `Blocos` funcionais. `Calendário` e `Desempenho` aparecem desabilitados, com tooltip
"Em desenvolvimento". Tema claro e escuro, com alternador no rodapé.

### Página Início
Blocos acessados recentemente e um card "Revisões pendentes hoje", que consulta diretamente as
revisões com `data_prevista <= hoje` e status diferente de `concluida`.

### Página Blocos
Visão de explorador de arquivos, com blocos e pastas como cards quadrados.

- Botão "Novo" com duas opções: **Novo bloco** e **Nova pasta**
- Navegação por breadcrumb, com pastas dentro de pastas
- Menu de contexto (clique direito ou botão `⋯`): favoritar, ocultar, renomear, **mover para…**,
  excluir — a movimentação é por menu, nunca por arrastar
- Busca por nome (global) e filtros "Só favoritos" / "Só ocultos"
- Ocultar uma pasta esconde seu conteúdo na visualização, mas **não altera** a flag `oculto`
  individual dos blocos de dentro
- Excluir uma pasta não apaga os blocos: eles voltam para a raiz

O modal "Novo bloco" tem nome, descrição e o toggle "É uma disciplina cursada?", que revela limite
de faltas e média para aprovação. Esses valores são apenas armazenados nesta etapa.

### Janela do bloco
Cabeçalho com o nome e o alternador de três modos — **Modo Prova**, **Modo Projeto**,
**Modo Aprendizagem**. Os modos são lentes sobre o mesmo bloco, não etapas: nenhum é bloqueado por
falta de progresso em outro. Prova e Projeto exibem apenas um placeholder.
Aprendizagem é o modo padrão e está completo.

A engrenagem abre as configurações, com duas abas:

- **Relações** — busca de bloco e seletor de tipo (é pré-requisito de / deriva de / é fusão de).
  A aresta é gravada uma única vez, e o rótulo é invertido conforme a perspectiva: quem é origem de
  `pre_requisito` vê "é pré-requisito de X"; quem é destino vê "depende de X".
- **Tabela de conteúdos** — abre o editor da árvore.

### Primeira entrada num bloco
Enquanto `tabela_conteudos_construida = 0`, o modo Aprendizagem mostra três opções com peso visual
igual:

1. **Enviar documentos** — `.txt`, `.md` e `.pdf`. O texto é extraído no navegador, salvo em
   `documentos_fonte` e enviado à IA para gerar a árvore de tópicos.
2. **Montar manualmente** — abre o editor com a árvore vazia.
3. **Buscar roteiro de estudos** — campo de tema, com a árvore vinda do conhecimento do modelo.

Qualquer uma das três termina na mesma **tela de revisão**, totalmente editável. A tabela só é
marcada como construída ao confirmar.

### Editor da tabela de conteúdos
Árvore com indentação visual. Adicionar tópico, adicionar subtópico, excluir e reordenar por botões
de seta (`↑ ↓` para ordem, `← →` para nível) — sem arrastar e soltar. Cada tópico tem título,
natureza (declarativo / procedimental / relacional) e peso (baixo / médio / alto).
Editar preserva os checks, revisões e evidências já registrados.

### Modo Aprendizagem
Três seções empilhadas:

1. Botão grande **Fazer sondagem**.
2. **Tópicos do bloco** — a árvore com checkbox e tag de natureza. Marcar o checkbox manualmente é
   permitido e não exige sondagem; ao marcar, a revisão 1 é agendada para +3 dias. Clicar no tópico
   expande e mostra seu log de evidências (data + modo + descrição).
3. **Revisões** — revisões pendentes com título do tópico, badge "Revisão N/3" e data prevista, mais
   um badge de status: Pendente (neutro), Atrasada (âmbar) ou Reagendada (sempre neutro).
   Botões "Concluir" e "Reagendar".

Repetição espaçada: ao concluir a revisão 1 agenda-se a 2 para +7 dias; ao concluir a 2 agenda-se a
3 para +14 dias. São no máximo 3 revisões por tópico — depois disso ele sai da lista.
**Reagendar apenas move a data:** não avança o número da revisão e nunca conta como atraso.

### Fluxo da sondagem
"Fazer sondagem" abre a seleção de tópico (árvore, seleção única) e em seguida a **janela de
sondagem**: um painel flutuante, arrastável e minimizável.

No topo ficam o nome do tópico, a tag de natureza e o protocolo correspondente:

| Natureza | Protocolo |
| --- | --- |
| declarativo | "Explique o conceito como se eu não soubesse nada sobre o assunto." |
| procedimental | "Resolva um exemplo explicando cada passo e por que ele é necessário." |
| relacional | "Vou fazer perguntas do tipo 'e se...' sobre o comportamento do sistema." |

O corpo é a conversa com o Gemini, persistida em `mensagens_chat`. O rodapé tem dois botões:

- **Minimizar** — vira uma barra fixa no rodapé da aplicação. A conversa não é perdida, nenhum
  check é marcado e o usuário pode navegar por toda a plataforma nesse estado.
- **Finalizar sondagem** — abre a confirmação "Marcar ⟨tópico⟩ como estudado?", com
  **"Sim, marcar"** (marca o check, agenda a revisão e registra a evidência) e **"Só encerrar"**
  (fecha sem marcar nada).

Depois de finalizar, aparece um aviso discreto e dispensável: "Quer revisar a tabela de conteúdos
deste bloco?", com um botão que abre o editor. Esse aviso existe só neste modo.

A IA nunca marca o check, nunca sugere marcar e nunca emite veredito, nota, porcentagem ou
"aprovado/reprovado".

---

## Princípios de design

Estes princípios estão refletidos no código e devem ser preservados em etapas futuras:

1. A plataforma **registra e organiza, nunca avalia**. Nenhuma marcação de progresso depende de
   julgamento da IA — todo check é feito pelo usuário.
2. **Nunca exibir nota, score ou percentual de domínio.** Apenas checklist binário e log qualitativo
   de evidências. Barras de progresso só com contagens objetivas (ex.: "4 de 12 tópicos marcados").
3. Os três modos são **lentes** sobre o mesmo bloco, nunca etapas sequenciais. Nenhuma ação de um
   modo é bloqueada por falta de progresso em outro.
4. **Reagendar nunca aparece como atraso**, falha ou pendência negativa.
5. **Falha da IA nunca bloqueia a tela** — sempre existe o caminho manual equivalente.
6. Linguagem neutra e informativa. Sem gamificação, streaks, cobrança ou mensagens motivacionais.
7. As **evidências são um log qualitativo**: nunca são somadas, contadas ou convertidas em
   percentual.

---

## Banco de dados

Tabelas em uso nesta etapa: `pastas`, `blocos`, `bloco_relacoes`, `topicos`, `revisoes`,
`evidencias`, `mensagens_chat`, `documentos_fonte`.

Já criadas no schema, sem telas ainda (para não exigir migration futura): `listas_questoes`,
`entregaveis`, `entregavel_topicos`, `eventos`, `avaliacoes`.

O schema completo está em [`server/db.js`](server/db.js).

---

## API REST

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/status` | Estado do servidor e se a IA está ativa |
| GET/POST | `/api/pastas` | Listar e criar pastas |
| PATCH/DELETE | `/api/pastas/:id` | Renomear, favoritar, ocultar, mover, excluir |
| GET/POST | `/api/blocos` | Listar e criar blocos |
| GET/PATCH/DELETE | `/api/blocos/:id` | Abrir (registra o acesso), atualizar, excluir |
| GET/POST | `/api/blocos/:id/relacoes` | Relações do bloco (com a perspectiva calculada) |
| DELETE | `/api/relacoes/:id` | Remover relação |
| GET/PUT | `/api/blocos/:id/topicos` | Ler e sincronizar a árvore de tópicos |
| POST | `/api/topicos/:id/check` | Marcar/desmarcar o check e agendar a revisão 1 |
| GET/POST | `/api/blocos/:id/evidencias`, `/api/topicos/:id/evidencias` | Log de evidências |
| GET | `/api/blocos/:id/revisoes` | Revisões não concluídas do bloco |
| POST | `/api/revisoes/:id/concluir` | Concluir e encadear a próxima |
| POST | `/api/revisoes/:id/reagendar` | Mover a data, mantendo o número |
| GET/POST | `/api/blocos/:id/documentos` | Documentos-fonte |
| POST | `/api/ia/extrair-tabela`, `/api/ia/roteiro` | Geração da árvore pela IA |
| GET/POST | `/api/sondagem/...` | Histórico, abertura e mensagens da sondagem |
| GET | `/api/inicio` | Blocos recentes e revisões pendentes hoje |

---

## Próximos passos

Ficou fora desta etapa:

- **Modo Prova** — hoje apenas um placeholder.
- **Modo Projeto** — hoje apenas um placeholder.
- **Cronograma dinâmico** — o Início traz só a lista simples de revisões pendentes hoje.
- **Página de Calendário** — entrada desabilitada na barra lateral; a tabela `eventos` já existe.
- **Página de Desempenho** — entrada desabilitada na barra lateral; a tabela `avaliacoes` já existe.
- **Visão de grafo dos blocos** — as relações já são gravadas e exibidas em lista, mas não há
  visualização em grafo.
- **Ferramentas acadêmicas** — controle de faltas e de médias. Os campos `limite_faltas`,
  `faltas_registradas` e `media_aprovacao` já são armazenados, mas não têm tela de uso.
- **Listas de questões e entregáveis** — tabelas `listas_questoes`, `entregaveis` e
  `entregavel_topicos` criadas, sem interface.
