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

## Implementado

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
**Modo Aprendizagem**. Os três estão implementados. Os modos são lentes sobre o mesmo bloco, não
etapas: nenhum é bloqueado por falta de progresso em outro. Aprendizagem é o modo padrão ao abrir.

À direita fica o **chat lateral do bloco**, recolhível e presente nos três modos. A conversa é
única por bloco, persistida em `mensagens_chat` (com `topico_id` nulo, o que a separa das conversas
de sondagem). O único contexto enviado ao modelo, além do histórico, é o rótulo do modo ativo —
cada mensagem guarda o modo em que foi escrita. Erros da IA aparecem na conversa sem bloquear a
tela, e a mensagem do usuário permanece salva.

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

### Modo Prova
Cada tópico do bloco é um cartão expansível com o título, a tag de peso e a contagem de listas por
status. Expandir mostra as listas daquele tópico; clicar numa lista abre o visualizador.

Dois botões por tópico:

**"Criar lista de questões"** — modal com três fontes de peso visual igual, mais o campo de
quantidade de questões:

1. **Usar documentos já enviados** — checkboxes com os registros de `documentos_fonte` do bloco.
   Fica desabilitado, com explicação, quando o bloco ainda não tem documentos.
2. **Enviar novos documentos** — upload de `.txt`, `.md` ou `.pdf`. O texto é extraído e também
   guardado em `documentos_fonte`, ficando disponível para as próximas listas.
3. **Buscar na internet** — exige confirmação explícita: o botão só libera depois de marcar a
   caixa ao lado do aviso *"Questões da internet podem não refletir o estilo de cobrança da sua
   disciplina."*

A lista é gravada em `listas_questoes` com a origem correta (`gerada_fontes` ou `gerada_internet`).

**"Enviar lista"** — upload de arquivo ou colagem de texto, com o checkbox *"Esta lista já vem com
gabarito"*. Marcado, você informa o gabarito; desmarcado, a IA resolve as questões e o gabarito é
salvo junto. Se a geração do gabarito falhar, a lista é salva do mesmo jeito. Origem `enviada`.

#### Visualizador de lista
Usado tanto no Modo Prova quanto nos testes teóricos do Modo Projeto.

- Questões em área de leitura confortável.
- Gabarito em seção separada e **recolhida por padrão**, atrás de "Mostrar gabarito".
- Seletor de status sempre visível: **Não feita / Incompleta / Completa**, marcado apenas pelo
  usuário — a IA nunca altera esse status.
- Tag de origem visível (Enviada / Gerada de documentos / Gerada da internet).
- **"Corrigir com a IA"** injeta o contexto da lista no chat lateral como uma mensagem visível, onde
  você cola suas respostas e recebe a correção na conversa. A correção é informativa e **não altera
  o status** da lista.
- Marcar uma lista como **Completa** insere uma evidência em `evidencias` (modo `prova`, descrição
  "Lista ⟨título⟩ concluída"). Só na transição, para não duplicar.

### Modo Projeto
Duas seções na mesma tela.

#### Entregáveis
- Barra de progresso com **contagem pura**: "3 de 7 entregáveis concluídos". Nunca percentual de
  domínio, nota ou nível.
- Cada entregável mostra nome, descrição, data de entrega, tempo estimado, ferramentas e as tags dos
  tópicos associados.
- Checkbox de conclusão, marcado manualmente pelo usuário.
- **"Reagendar"** nos que têm data — apenas move a data, nunca conta como atraso.
- **"Novo entregável"** — modal com nome, descrição, tópicos associados (multi-seleção sobre a
  árvore de tópicos), ferramentas, tempo estimado em horas e data de entrega. As associações vão
  para `entregavel_topicos`.
- **"Sugerir entregáveis"** — campo para descrever a expectativa do projeto. As sugestões aparecem
  como **cartões de proposta**, com "Adicionar" e "Descartar". Nada é gravado sem ação explícita.
- Concluir um entregável insere uma evidência para **cada** tópico associado (modo `projeto`,
  descrição "Entregável ⟨nome⟩ concluído").

#### Testes teóricos
Ficam nesta mesma tela — nunca redirecionam para o Modo Prova.

- **"Pedir teste de um tópico"** abre o mesmo fluxo de três fontes do Modo Prova.
- Toggle **"Sugerir testes automaticamente"**: ligado, concluir um entregável gera testes para os
  tópicos associados. O **limite rígido de 3 testes por vez** está escrito ao lado do toggle;
  havendo mais tópicos, os de maior peso têm prioridade. Usa os documentos-fonte do bloco — sem
  documentos, o entregável é concluído normalmente e a interface explica por que não houve geração.
- Os testes aparecem aqui com o mesmo visualizador do Modo Prova (gabarito recolhido + seletor de
  status) e não se misturam com as listas do Modo Prova.

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

Tabelas em uso: `pastas`, `blocos`, `bloco_relacoes`, `topicos`, `revisoes`, `evidencias`,
`mensagens_chat`, `documentos_fonte`, `listas_questoes`, `entregaveis`, `entregavel_topicos`.

Já criadas no schema, sem telas ainda (para não exigir migration futura): `eventos` e `avaliacoes`.

As colunas acrescentadas depois da primeira versão (gabarito e contexto das listas, ferramentas,
tempo estimado e conclusão dos entregáveis, preferência de testes automáticos do bloco) entram por
uma migration idempotente em `migrar()`, já que `CREATE TABLE IF NOT EXISTS` não altera tabelas
existentes.

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
| GET/POST/DELETE | `/api/blocos/:id/chat` | Chat lateral do bloco |
| GET/POST | `/api/blocos/:id/listas` | Listas do bloco por contexto (`prova` ou `projeto`) |
| GET/PATCH/DELETE | `/api/listas/:id` | Abrir, mudar status ou título, excluir |
| POST | `/api/listas/:id/corrigir` | Leva o contexto da lista para o chat do bloco |
| POST | `/api/ia/lista-questoes`, `/api/ia/gabarito` | Geração de questões e de gabarito |
| GET/POST | `/api/blocos/:id/entregaveis` | Entregáveis do bloco |
| PATCH/DELETE | `/api/entregaveis/:id` | Editar (inclusive as associações) ou excluir |
| POST | `/api/entregaveis/:id/concluir` | Conclui, registra evidências e pode gerar testes |
| POST | `/api/entregaveis/:id/reagendar` | Move a data de entrega |
| POST | `/api/ia/sugerir-entregaveis` | Propostas de entregáveis (nada é salvo) |
| GET | `/api/inicio` | Blocos recentes e revisões pendentes hoje |

---

## Próximos passos

Ficou fora desta etapa:

- **Cronograma dinâmico** — o Início traz só a lista simples de revisões pendentes hoje.
- **Página de Calendário** — entrada desabilitada na barra lateral; a tabela `eventos` já existe.
- **Página de Desempenho** — entrada desabilitada na barra lateral; a tabela `avaliacoes` já existe.
- **Visão de grafo dos blocos** — as relações já são gravadas e exibidas em lista, mas não há
  visualização em grafo.
- **Ferramentas acadêmicas** — controle de faltas e de médias. Os campos `limite_faltas`,
  `faltas_registradas` e `media_aprovacao` já são armazenados, mas não têm tela de uso.
- **Busca na internet com uma chave real** — a geração usa a ferramenta de busca do Gemini
  (`google_search`). O caminho foi exercitado até a resposta da API, mas o resultado com busca
  ativa só pode ser conferido com uma `GEMINI_API_KEY` válida.
- **Anexar respostas por arquivo na correção** — hoje as respostas são coladas no chat.
