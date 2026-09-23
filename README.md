# Plataforma de Estudos

Plataforma de estudos pessoal, de usuário único.

## Resumo da plataforma e UI:

A ideia central da plataforma é dividir o estudo em 3 métodos, baseados em objetivos: Modo de estudo para prova, que consiste no estudo baseado
na realização de questões nos temas e nos formatos das provas; Modo de estudo para projeto, que consiste no estudo baseado na realização de entregáveis
e teste contínuo do conhecimento; Modo de estudo para aprendizagem, que consiste no estudo baseado em revisão e sondagem por um agente externo baseado no
método Feynman.

A plataforma é organizada em blocos de estudo, que representam disciplinas. Eles podem estar associados a disciplinas reais da faculdade ou serem simplesmente assuntos de estudos pessoais. Cada bloco possui uma tabela hierarquizada de tópicos que compõem o bloco de estudo. Existe um opcional para categorizar cada bloco como acadêmico, abrindo funcionalidades como contador de faltas e calculador de média. 

A experiência se organiza em quatro páginas: uma página inicial, que reúne os blocos acessados recentemente, as revisões pendentes do dia e os compromissos diários; a página de blocos, onde eles aparecem no estilo de um explorador de arquivos, podendo ser arrastados entre elas, favoritados, ocultados ou buscados por nome; o calendário, com visão mensal dos eventos, provas, entregas e revisões; e a página de desempenho, que reúne o panorama geral das disciplinas (Não houve tempo para implementar as páginas calendário e acompanhamento de desempenho, portanto estas não estão funcionais).

Dentro de um bloco de estudos, a interface é dominada por um toggle entre os três modos, sempre visível. Um painel lateral mantém o chat com o Gemini (precisa implementar manualmente a chave da API, orientação descrita abaixo), e uma engrenagem dá acesso às configurações, onde ficam as relações com outros blocos, o wrapper acadêmico e a tabela de conteúdos. A sondagem do modo aprendizagem acontece em uma janela flutuante e minimizável, de modo que o usuário possa continuar navegando pela plataforma sem encerrar a sessão nem perder a conversa.

A plataforma registra e organiza, mas nunca avalia. Todo progresso é
marcado pelo próprio usuário. A IA conduz a conversa de sondagem,
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
| Leitura de documentos | `pdfjs-dist` (PDF) e `mammoth` (.docx), no servidor, num processo filho |
| Envio de arquivos | `multer` (multipart/form-data) |
| Busca nos documentos | embeddings do Gemini (`gemini-embedding-001`) ou BM25 próprio, sem dependência |
| Arrastar e soltar | `@dnd-kit/core` |
| Gráficos | `recharts` |
| Mapa de blocos | `@xyflow/react` (react-flow) + `dagre` para o layout |

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

### Sem terminal (Windows)

Dê duplo clique em **`Iniciar plataforma.bat`**. Ele confere o Node, instala as dependências na
primeira vez, sobe servidor e cliente e abre o navegador sozinho quando tudo estiver pronto.
A janela que abre **é** a plataforma: deixe-a aberta enquanto estiver usando e feche-a para
encerrar. Se algum processo ficar preso nas portas 3333 ou 5173, use **`Parar plataforma.bat`**.

Para fixar na barra de tarefas, rode **`Criar atalho.bat`** — o Windows não fixa um `.bat`
diretamente, só `.exe` ou atalhos para `.exe`, então o atalho gerado aponta para o `cmd.exe`.
Depois, botão direito no atalho → "Mostrar mais opções" (Windows 11) → "Fixar na barra de tarefas".
O atalho guarda o caminho completo: se mover a pasta do projeto, rode o `Criar atalho.bat` de novo.

### Pelo terminal

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
GEMINI_MODELO=gemini-flash-latest              # opcional
GEMINI_MODELO_EMBEDDING=gemini-embedding-001   # opcional
PORT=3333                                      # opcional
```

Para testes, `PLATAFORMA_BANCO=<caminho>/dados.db` sobe o servidor com outro banco (os arquivos
enviados ficam numa pasta `arquivos/` ao lado dele), e `API_ALVO=http://localhost:3334` faz o Vite
apontar para essa outra instância.

4. Reinicie o `npm run dev`.

A chave **nunca chega ao cliente**: todas as chamadas passam por `server/gemini.js`.
`GET /api/status` e o log de inicialização mostram qual modelo está em uso.

**Sobre o modelo:** versões fixas são aposentadas com o tempo e passam a responder `404 — no longer
available`. Por isso o padrão é `gemini-flash-latest`, que acompanha a versão atual. Os modelos mais
recentes costumam ser os mais disputados no nível gratuito: se aparecerem muitos erros `503`
(sobrecarga) ou `429` (cota), vale apontar `GEMINI_MODELO` para um modelo mais leve, como
`gemini-3.1-flash-lite`. Chamadas que falham com erro transitório (`500`, `502`, `503`, `504`) são
repetidas automaticamente até 3 vezes; `429` não é repetido, porque insistir não devolve cota. A
exceção são os embeddings da indexação de documentos: ali o `429` costuma ser o limite por minuto, e
é repetido com espera crescente (veja "Trechos e índice").

Uma assinatura do aplicativo Gemini (Google AI Pro/Ultra, incluindo a oferta para estudantes) **não**
vale como cota desta API: são produtos separados, e o acesso aqui é sempre pela chave do AI Studio.

**Sem a chave, a aplicação continua funcionando normalmente.** Todas as funções de IA entram em
modo simulado, devolvendo dados mock com atraso artificial — as respostas de sondagem vêm marcadas
com `(modo simulado — sem GEMINI_API_KEY)` e as árvores de tópicos vêm com uma estrutura de exemplo.
O rodapé do log do servidor diz qual modo está ativo na subida.

Se a chave existir mas a chamada falhar (chave inválida, rede fora, JSON malformado), a falha
**nunca bloqueia a tela**: as funções de árvore caem para árvore vazia com uma mensagem de erro
na interface, e o caminho manual continua disponível.

### Erros sempre em JSON
Nenhuma rota `/api` responde a página de erro HTML do Express. O último middleware do servidor
traduz qualquer erro para `{ erro, codigo }`, com mensagem em português, e registra o erro completo
no console para diagnóstico. Corpo grande demais (413) vira *"O arquivo é grande demais para o envio
atual."* (`arquivo_grande_demais`); JSON malformado, rota inexistente e erros de programação também
ganham mensagem e código próprios — a mensagem técnica de um erro do banco, por exemplo, nunca chega à
tela. As respostas de erro montadas à mão pelas rotas ganham o `codigo` automaticamente.

No cliente, `lerResposta()` ([`client/src/api.ts`](client/src/api.ts)) lê toda resposta da API: se o
conteúdo não for JSON, a tela mostra *"O servidor não respondeu como esperado."* — nunca
`Unexpected token '<'`. Servidor desligado vira *"Não foi possível falar com o servidor."*

---

## Implementado

### Barra lateral
`Início`, `Blocos`, `Calendário` e `Desempenho` — todas funcionais. Tema claro e escuro, com
alternador no rodapé.

O cronograma deixou de ser uma aba própria: agora é a coluna direita do Calendário. A rota
`/cronograma` continua funcionando e redireciona para lá.

Também traz **"Iniciar foco"** e, enquanto há sessão aberta, o indicador discreto com o tempo
corrido, visível em qualquer página.

### Página Início
Um card **"Sugestões do dia"** no topo, alimentado pelo cronograma dinâmico: o que vale a pena hoje,
cada item com nome, bloco, modo, tempo estimado e o motivo em texto. Ao lado da lista fica o
**orçamento diário** em minutos, editável em um clique e gravado em `config` — a plataforma não
pergunta de novo a cada visita. O tempo planejado aqui **nunca** é comparado com o tempo das sessões
de foco. Sem nada com prazo ou tempo estimado, o card apenas diz isso, sem cobrança.

Blocos acessados recentemente e um card "Revisões pendentes hoje", que consulta diretamente as
revisões com `data_prevista <= hoje` e status diferente de `concluida`.

Um card **"Compromissos de hoje"** com campo de texto livre, checkboxes, edição e exclusão. Itens
em aberto de dias anteriores **não** são trazidos para hoje nem geram alerta ou contagem de falhas;
"Ver outro dia" abre a consulta a um dia anterior, apenas para leitura.

### Página Blocos
Duas visões da mesma coleção, no alternador **Pastas / Grafo** do cabeçalho. O modo fica na URL
(`/blocos?vista=grafo`), então sobrevive a recarregar e ao botão "voltar".

#### Visão de pastas
Explorador de arquivos, com blocos e pastas como cards quadrados.

- Botão "Novo" com duas opções: **Novo bloco** e **Nova pasta**
- Navegação por breadcrumb, com pastas dentro de pastas. A pasta aberta fica na URL
  (`/blocos?pasta=<id>`), então sobrevive a recarregar e ao botão "voltar" do navegador
  (`?pasta=` sem valor força a raiz)
- O item **"Blocos"** da barra lateral devolve você exatamente onde parou — a pasta que estava
  aberta **ou o bloco que estava aberto**. Um bloco só deixa de ser o destino quando você sai dele
  pelo caminho no topo, ou se ele for excluído
- **Arrastar e soltar** (dnd-kit) pela faixa que ocupa todo o topo do card — o resto do card segue
  clicável. A pasta sob o cursor fica destacada; soltar em área vazia deixa o item no nível atual.
  **Os itens do breadcrumb também recebem o que é solto**, e é assim que um bloco ou uma pasta sai
  de dentro de uma pasta. Uma pasta nunca entra em si mesma nem numa descendente
- Menu de contexto (clique direito ou botão `⋯`): favoritar, ocultar, renomear, **mover para…**,
  excluir — mantido como caminho equivalente e acessível pelo teclado
- Busca por nome (global) e filtros "Só favoritos" / "Só ocultos"
- Ocultar uma pasta esconde seu conteúdo na visualização, mas **não altera** a flag `oculto`
  individual dos blocos de dentro
- Excluir uma pasta não apaga os blocos: eles voltam para a raiz

O modal "Novo bloco" tem nome, descrição e o toggle "É uma disciplina cursada?", que revela limite
de faltas e média para aprovação. Esses valores são apenas armazenados nesta etapa.

### Fusão de blocos
Um bloco **resultado** é a fusão de **duas ou mais origens** — é direcional e tem mais de dois
participantes, então não cabia no seletor de tipos junto das outras relações.

No modelo, continua sendo `bloco_relacoes` com tipo `fusao_com`, agora sempre da **origem** para o
**resultado**. O conjunto de arestas que aponta para o mesmo resultado **é** a fusão, e é por isso
que um bloco é resultado de no máximo uma fusão: por construção, não por validação. O servidor exige
pelo menos duas origens e recusa um bloco como origem da fusão que resulta nele mesmo.

Os rótulos mudam conforme o lado:

- no resultado: **"É fusão de A + B"**;
- em cada origem: **"Funde com B para formar C"**, listando as outras origens da mesma fusão.

A opção vira **"Editar fusão"** quando o bloco já é resultado de uma. Remover origens até sobrar
menos de duas desfaz a fusão inteira, com confirmação — uma fusão de um participante só não
descreveria nada.

As arestas `fusao_com` antigas foram gravadas como relação simétrica, sem direção confiável: a
migração as lista no console e as remove, para serem recriadas pela nova interface.

### Mapa dos blocos
Uma tela contínua com todos os blocos, navegável por arraste e zoom. O que aparece depende só de
onde você está e de quanto zoom deu — não há renderização por vizinhança limitada.

#### Layout estável
O layout é calculado **uma vez** com dagre, orientado pelos pré-requisitos (base embaixo, quem
depende acima), e a posição de cada bloco é gravada em `blocos.pos_x` / `pos_y`. Nas aberturas
seguintes valem as posições salvas: o mapa não se reorganiza sozinho, porque lembrar onde as coisas
estão é metade da utilidade dele.

Um bloco novo entra **sem mover os que já estão** — perto dos blocos com que se relaciona, ou numa
área livre quando ainda não tem relações. Arrastar um nó o reposiciona e grava a nova posição, e
**nunca cria relação**: relações continuam sendo editadas só pelo modal. O botão discreto
**"Reorganizar mapa"**, com confirmação, recalcula tudo.

#### Nós e arestas
O nó traz o nome, uma estrela discreta quando é favorito e um marcador quando o wrapper acadêmico
está ativo. **Nada de progresso, urgência ou contagem**: o mapa mostra estrutura, não desempenho.

As arestas têm estilo próprio por tipo, com legenda fixa no canto: seta contínua para
`pre_requisito`, tracejada para `deriva_de` e pontilhada para `fusao_com` — cujas arestas convergem
das origens para o resultado, o que torna cada fusão reconhecível de relance.

O nível de detalhe acompanha o zoom, por constantes nomeadas em
[`lib/layoutGrafo.ts`](client/src/lib/layoutGrafo.ts): abaixo de `ZOOM_MOSTRAR_NOMES` os nós viram
pontos, e os rótulos das arestas só aparecem a partir de `ZOOM_MOSTRAR_ROTULOS_ARESTA`.

#### Enquadramento
Aberto a partir de um bloco, o mapa centraliza nele no `ZOOM_PADRAO` — quem mais aparece depende só
da distância no mapa, nada é forçado a aparecer. Aberto pela visão de pastas, restaura exatamente o
último enquadramento, guardado em `config`. O botão **"Centralizar"** fica sempre visível e vai para
o bloco em foco ou, na falta de um, para o último bloco aberto.

Clicar num nó seleciona; duplo clique (ou "Abrir" no destaque) abre a janela do bloco. A **busca**
centraliza no resultado escolhido, e a barra de **favoritos**, fixa dentro do mapa, faz o mesmo.

#### Ocultos e filtros
Blocos ocultos não são renderizados, mas **mantêm suas posições**: o espaço deles não é
reaproveitado. O toggle **"Mostrar ocultos"** os traz de volta com contorno tracejado, sem mexer nos
demais nem no enquadramento. O filtro **"Só ocultos"** os mostra normalmente e esmaece os outros,
pelo mesmo critério de "Só favoritos" — nenhum filtro remove blocos do mapa, para não quebrá-lo.

#### Caminho de pré-requisitos
Com um bloco em foco, o toggle **"Caminho de pré-requisitos"** usa `getPreRequisitosTransitivos()`
para pegar toda a cadeia ascendente, sem limite de profundidade. Os blocos e arestas do caminho
recebem realce; os demais, um esmaecimento leve — nunca são ocultados. Se a cadeia passar por um
bloco oculto, ele aparece no estilo de oculto, para que ela nunca surja partida. Ligar ou desligar o
toggle **não altera o enquadramento**: só os estilos mudam.

#### Uma travessia só
[`client/src/lib/grafo.js`](client/src/lib/grafo.js) é JavaScript de propósito: o servidor (ESM, sem
etapa de build) importa **o mesmo arquivo**. A regra de ciclo, a cadeia de pré-requisitos e a
definição de fusão existem numa implementação só, em vez de duas que divergem com o tempo. O preço é
o servidor depender de um caminho dentro de `client/` — aceitável num monorepo que sempre sobe junto.

### Janela do bloco
Cabeçalho com o nome e o alternador de três modos — **Modo Prova**, **Modo Projeto**,
**Modo Aprendizagem**. Os três estão implementados. Os modos são lentes sobre o mesmo bloco, não
etapas: nenhum é bloqueado por falta de progresso em outro. Aprendizagem é o modo padrão ao abrir.

À direita fica o **chat lateral do bloco**, recolhível e presente nos três modos. A conversa é
única por bloco, persistida em `mensagens_chat` (com `topico_id` nulo, o que a separa das conversas
de sondagem). O único contexto enviado ao modelo, além do histórico, é o rótulo do modo ativo —
cada mensagem guarda o modo em que foi escrita. Erros da IA aparecem na conversa sem bloquear a
tela, e a mensagem do usuário permanece salva.

O caminho no topo mostra a pasta em que o bloco está, nível a nível — clicar em qualquer um leva
direto àquela pasta, em vez de voltar para a raiz.

Quando o bloco é uma disciplina cursada, um botão **Acadêmico** abre um **painel retrátil na
própria janela do bloco**, acima do modo ativo — não é modal e não passa pelas configurações.
Trocar de modo não o fecha; "Recolher" ou o próprio botão do cabeçalho o fecham.
A engrenagem abre as configurações, com as abas:

- **Bloco** — nome, descrição e o toggle "É uma disciplina cursada?", que pode ser ligado ou
  desligado a qualquer momento, junto do limite de faltas e da média para aprovação. Desligar não
  apaga os valores já informados.
- **Relações** — busca de bloco e seletor de tipo (é pré-requisito de / deriva de). A aresta é
  gravada uma única vez, e o rótulo é invertido conforme a perspectiva: quem é origem de
  `pre_requisito` vê "é pré-requisito de X"; quem é destino vê "depende de X". A **fusão** tem seção
  própria, logo abaixo, porque não é uma relação entre dois blocos. Uma relação que criaria
  dependência circular é recusada com a explicação: *"Isso criaria um ciclo: B já depende de A por
  outro caminho."*
- **Tabela de conteúdos** — abre o editor da árvore.
(O painel **Acadêmico** não fica aqui: é um painel retrátil na janela do bloco.)

### Materiais: o repositório de documentos do bloco
Painel retrátil na janela do bloco, no mesmo padrão do Acadêmico, acessível nos três modos. É a
**origem única** dos documentos: todos os fluxos que usam material do bloco leem daqui.

Aceita **vários arquivos de uma vez** — escolhidos ou arrastados para a área —, com progresso por
arquivo, e também texto colado. Cada documento tem nome, categoria, data, tamanho, número de páginas
e **onde já foi usado** ("usado em 3 listas · 1 tabela de conteúdos"). Dá para renomear, mudar a
categoria, abrir o arquivo original e excluir, com busca por nome e filtro por categoria.

#### Envio de arquivos grandes
Arquivos vão como **multipart/form-data** (`multer`), nunca em base64 dentro de JSON — era o que
fazia um livro inteiro estourar o limite do corpo e o Express responder uma página HTML. O limite é
de **100 MB por arquivo** (`LIMITE_ARQUIVO_MB`, em [`server/index.js`](server/index.js); o cliente
avisa antes de enviar). O arquivo é gravado em disco, o hash é calculado em partes, e **a resposta
sai assim que o arquivo chega** — a leitura acontece depois.

A extração do texto é feita **no servidor**, num **processo filho**
([`server/extrator.js`](server/extrator.js)), para um PDF de centenas de páginas não travar nem a
interface nem o servidor. Processo, e não *worker thread*, por um motivo medido: o `pdfjs-dist`
carrega no Node um módulo nativo (`@napi-rs/canvas`), e um crash nativo numa worker thread derrubava
o servidor inteiro (saída 139 em teste). Num processo filho, só ele cai, e o documento fica
"falhou".

Cada documento passa por um status visível na lista e no seletor:

| Status | O que aparece |
| --- | --- |
| processando | "na fila de processamento", "lendo o arquivo: 120 de 557 páginas", "dividindo em trechos…" (com barra) |
| pronto, indexando | "indexando: 120 de 400 trechos — já pode ser usado" (com barra) |
| pronto | nada — o documento pode ser usado |
| falhou | "não foi possível processar", com o motivo |

Motivos de falha comuns: PDF digitalizado, só com imagem (*"O PDF não tem texto selecionável —
parece ser digitalizado"*; não há OCR), arquivo protegido por senha, arquivo que não é PDF válido.
O documento fica **pronto assim que tem texto e trechos** — num livro de 557 páginas, poucos
segundos. A indexação por embeddings, que pode levar minutos por causa do limite da API, continua
depois **sem bloquear**: até terminar, a busca por tópico usa palavras-chave.

**O tamanho nunca desabilita nada** — nem a caixa de um documento, nem o botão de gerar. A caixa só
fica desabilitada quando o documento não tem texto para enviar (ainda lendo ou dividindo, ou
falhou), e sempre com o motivo visível: numa linha própria abaixo do nome (que num nome longo não
some no truncamento) e ao passar o mouse. Enviado pelo seletor, o documento entra na seleção
sozinho assim que fica pronto. A lista se atualiza a cada 2 s enquanto houver algo em andamento.

A **categoria** é opcional e nunca automática — padrão `outro`, definida no envio ou depois:
ementa, livro ou apostila, lista de exercícios, prova antiga, roteiro de projeto, calendário, outro.

#### Um documento existe uma vez só
O servidor calcula o **SHA-256** do arquivo original (ou do texto, quando é colado) antes de gravar:

- **mesmo hash já no bloco** → nenhum registro novo; o existente é reaproveitado, com a linha
  discreta *"Este documento já estava no repositório."*;
- **mesmo nome, hash diferente** → a tela pergunta: **substituir o anterior** (as referências de uso
  passam para o novo) ou **manter os dois** (o segundo ganha um sufixo de versão).

Um índice único em `(bloco_id, hash)` garante a regra no banco, não só no código. A deduplicação é
**por bloco**: o mesmo PDF em duas disciplinas são dois documentos, porque são dois contextos.

Os arquivos originais ficam em `server/arquivos/<bloco_id>/` (fora do git). O texto extraído vai
para `documentos_fonte`, e os trechos, para `documento_trechos`.

#### Migração dos duplicados que já existiam
Na subida do servidor, `deduplicarDocumentos()` preenche o hash do que já estava gravado, agrupa por
`(bloco_id, hash)`, mantém o registro mais antigo de cada grupo, **aponta para ele as referências
dos demais** e remove os duplicados — registrando no console quantos saíram de cada bloco. O índice
único é solto antes e recriado depois, para a migração poder rodar também num banco que já o tem.

#### O mesmo seletor nos quatro fluxos
Construção da tabela de conteúdos, criação de listas de questões, montagem de entregáveis a partir
do roteiro e importação de eventos usam o **mesmo componente**
([`SeletorDocumentos`](client/src/componentes/SeletorDocumentos.tsx)), com duas abas:

- **Do repositório** — checkboxes, busca e filtro, **pré-filtrado pela categoria mais provável do
  fluxo** (lista de questões sugere listas e provas antigas; roteiro sugere roteiro de projeto;
  calendário sugere calendário), sem esconder as demais: "Todas as categorias" está a um clique.
- **Enviar novo** — grava no repositório, com deduplicação, e seleciona o documento quando ele
  fica pronto.

Abaixo da seleção, uma linha diz **o que vai de fato para a IA** — calculado pelo servidor
(`POST /api/documentos/material`, em [`server/material.js`](server/material.js)) pelo que o fluxo
envia, nunca pelo tamanho bruto do documento:

| Fluxo | O que vai | Linha |
| --- | --- | --- |
| Tabela de conteúdos | ementa + documentos curtos inteiros + sumário e inícios de capítulo dos longos | "~29 mil caracteres vão para a IA" |
| Lista de questões | só os trechos recuperados do tópico | "só os trechos relevantes do tópico vão para a IA (até 8)" |
| Roteiro de projeto, importação de calendário | o texto dos documentos | "~N mil caracteres vão para a IA" |

O tamanho do livro inteiro é irrelevante e não gera aviso. O aviso neutro só aparece quando o que
**seria enviado** passa do teto (120 mil caracteres) — e nesse caso o próprio fluxo já reduz e diz
como, em uma linha: documentos longos passam a ir só com sumário e início de cada capítulo, ou vão
só parte dos inícios; em último caso, o texto é cortado no teto. Nunca bloqueia. O mesmo cálculo é o
que as rotas de geração usam, então a linha mostra exatamente o que será enviado.

Nenhum fluxo grava mais em `documentos_fonte` por fora.

#### Trechos e índice
Feito **uma única vez**, quando o documento entra no repositório
([`server/indexacao.js`](server/indexacao.js)), numa fila em segundo plano:

1. **Divisão em trechos** ([`server/trechos.js`](server/trechos.js)) de ~1.500 palavras, com ~150
   de sobreposição entre vizinhos, respeitando parágrafos e cortando nas trocas de seção quando o
   trecho já tem corpo (trocas de capítulo cortam mais cedo, para um trecho não atravessar dois
   capítulos). Cada trecho guarda as páginas de início e fim e o título da seção.
2. **Sumário do PDF**, quando existe: os marcadores (outline) do arquivo, com a página de cada
   capítulo e seção — lidos pelo pdfjs, sem IA. É dele que vem o título de seção dos trechos; sem
   sumário, os títulos são detectados no texto ("Capítulo 3", "2.4 Variância", `# Integrais`).
3. **Embeddings**, se houver `GEMINI_API_KEY`: `gemini-embedding-001`, 768 dimensões, em lotes de
   6 trechos, guardados como JSON no próprio trecho. Nunca recalculados a cada lista — na geração, só
   a consulta ganha um embedding.

A API limita tokens por minuto. Erros `429` e `5xx` são repetidos com **espera crescente**
(2 s, 4 s, 8 s… até ~1 min, ou o `retryDelay` sugerido pelo Google), e cada lote é gravado assim que
volta: **o progresso nunca se perde**. Se as tentativas se esgotarem, o documento fica "pronto" pela
**busca por palavras-chave**, com a observação de onde a indexação parou; a cota diária esgotada pausa
os embeddings por uma hora em vez de insistir. Um livro longo não segura a fila: entre um lote e
outro, se há outro documento esperando, ele volta para o fim da fila.

**Documentos que já estavam no repositório** são processados na subida do servidor (os que
tinham arquivo original são relidos no servidor, para ganhar páginas e sumário). O botão **"Indexar
documentos"**, nos Materiais, processa de novo o que falhou e completa as indexações que pararam no
meio. Documentos enviados antes de o repositório guardar o arquivo original só têm o texto: viram
trechos, mas sem páginas.


#### Procedência
Ao gerar qualquer item a partir de documentos, fica registrado em `documento_usos` quais foram. O
item gerado — lista, tabela de conteúdos, entregáveis — mostra discretamente **"Gerado a partir
de: …"**, com link para o repositório.

**Excluir um documento nunca apaga o que ele gerou.** A exclusão é permitida mesmo com usos
registrados, a confirmação diz isso, e a referência passa a aparecer como *"documento removido"* —
o conteúdo gerado já está salvo no item. Excluir a **lista**, por outro lado, leva os usos dela
junto: eles descrevem a lista, não o documento.

### Primeira entrada num bloco
Enquanto `tabela_conteudos_construida = 0`, o modo Aprendizagem mostra três opções com peso visual
igual:

1. **Enviar documentos** — `.pdf`, `.txt`, `.md` e `.docx`, pelo repositório do bloco. Dos livros, a
   IA recebe a ementa, o sumário e o começo de cada capítulo — veja "Tabela de conteúdos a partir de
   livros".
2. **Montar manualmente** — abre o editor com a árvore vazia.
3. **Buscar roteiro de estudos** — campo de tema, com a árvore vinda do conhecimento do modelo.

Qualquer uma das três termina na mesma **tela de revisão**, totalmente editável. A tabela só é
marcada como construída ao confirmar.

### Editor da tabela de conteúdos
Árvore com indentação visual. Adicionar tópico, adicionar subtópico, excluir e reordenar por botões
de seta (`↑ ↓` para ordem, `← →` para nível) — sem arrastar e soltar. Cada tópico tem título,
natureza (declarativo / procedimental / relacional) e peso (baixo / médio / alto).

O **peso mede esforço, não importância**: quanto tempo de estudo o tópico costuma exigir. Baixo é o
que se resolve com uma leitura atenta ou um exemplo; médio pede alguns exercícios; alto pede várias
sessões ou articula muitos outros conceitos. Um tópico pode ser fundamental e ainda assim ter peso
baixo. É esse número que alimenta o tempo estimado das revisões no cronograma dinâmico, então o
prompt da IA pede explicitamente uma distribuição próxima de 25 % alto / 50 % médio / 25 % baixo —
descrito só como "importância relativa", o modelo classificava quase tudo como alto e nunca usava
baixo, o que deixava a informação inútil.
Editar preserva os checks, revisões e evidências já registrados.

#### Tabela de conteúdos a partir de livros
O livro inteiro **não** vai para o modelo ([`server/material.js`](server/material.js)).
Vão, dentro de um teto de 120 mil caracteres:

- a **ementa completa**, se selecionada — é ela que define o escopo da disciplina. (Uma "ementa" com
  mais de 60 mil caracteres é, na prática, um livro enviado com a categoria sugerida pelo fluxo: vai
  como livro, resumida — nunca cortada no meio.);
- os documentos curtos (até 40 mil caracteres), inteiros;
- de cada documento longo, o **sumário** extraído do PDF e os **primeiros ~250 palavras de cada
  capítulo** (até 40 capítulos por livro; mais do que isso vira amostra espaçada).

Sem sumário extraível, entram os **títulos de seção** identificados na divisão em trechos. As
páginas de sumário impresso, tabelas numéricas e listas de respostas ficam de fora dos inícios. O
prompt diz ao modelo que só vieram sumário e inícios, que a ementa manda no escopo e que prefácio,
apêndices e respostas não são tópicos. A deduplicação de conceitos e a distribuição de pesos
continuam as mesmas. Num livro de 557 páginas (990 mil caracteres), o material enviado fica perto
de 30 mil caracteres.

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

1. **Usar documentos do bloco** — o seletor do repositório (escolher ou enviar novo). Só
   documentos prontos podem ser marcados.
2. **Buscar na internet** — exige confirmação explícita: o botão só libera depois de marcar a
   caixa ao lado do aviso *"Questões da internet podem não refletir o estilo de cobrança da sua
   disciplina."*

A lista é gravada em `listas_questoes` com a origem correta (`gerada_fontes`, `gerada_internet` ou
`gerada_geral`).

#### Só os trechos do tópico
Com documentos como fonte, a lista **nunca** é gerada a partir do documento inteiro:

1. A **consulta** é o tópico: título + títulos dos subtópicos + título do tópico pai.
2. **Recuperação** ([`server/recuperacao.js`](server/recuperacao.js)) nos documentos escolhidos:
   com todos os trechos indexados e a IA disponível, **similaridade de cosseno** entre a consulta e
   os trechos; sem chave ou com a indexação incompleta, **BM25** (termos sem acento e sem palavras
   vazias, com um radical grosseiro; os termos do título valem o dobro).
3. Entram os **8 melhores trechos**, até 70 mil caracteres. Quando o sumário indica o capítulo do
   tópico, os trechos daquelas páginas ganham prioridade. Páginas de sumário impresso, tabelas
   numéricas e listas de respostas (que mencionam todos os termos e não ensinam nada) ficam de fora.
4. O modelo recebe **só esses trechos**, rotulados (T1, T2…) com documento, páginas e seção, e a
   instrução de que todas as questões avaliam **este tópico**, de usar os trechos como referência de
   conteúdo, notação e nível, de **não** gerar questões sobre outros assuntos que apareçam neles e
   de dizer em qual trecho cada questão se apoia.

**Relevância mínima.** Com embeddings, um trecho conta como sobre o tópico com cosseno ≥ 0,67 — valor
calibrado com trechos reais: os 20 tópicos de um bloco de Eletromagnetismo tiveram a melhor
similaridade entre 0,68 e 0,81; assuntos de fora (fotossíntese, distribuição binomial, regra da
cadeia), entre 0,61 e 0,66. As palavras-chave só resgatam o que está logo abaixo do limiar: um livro
que cita "amostragem" de passagem não faz uma lista de Estatística parecer tratada por ele. Sem
embeddings, o trecho precisa conter ao menos metade dos termos do título do tópico.

**Nenhum trecho relevante: nada é gerado.** A tela mostra *"Os documentos selecionados não parecem
tratar deste tópico"* e oferece **gerar mesmo assim, pelo conhecimento geral**, com confirmação — a
lista fica marcada como "Gerada por conhecimento geral".

**Origem visível.** A lista guarda as páginas de onde saiu (`origem_paginas`) e o visualizador mostra,
discretamente, *"Baseada nas páginas 327–336 e 479–483 de Estatística Básica.pdf"*; cada questão
mostra embaixo o trecho em que se apoia (documento, páginas, seção).

**"Enviar lista"** — upload de arquivo ou colagem de texto, com o checkbox *"Esta lista já vem com
gabarito"*. Marcado, você informa o gabarito; desmarcado, a IA resolve as questões e o gabarito é
salvo junto. Se a geração do gabarito falhar, a lista é salva do mesmo jeito. Origem `enviada`.

#### Visualizador de lista
Usado tanto no Modo Prova quanto nos testes teóricos do Modo Projeto.

- Questões em área de leitura confortável.
- Gabarito em seção separada e **recolhida por padrão**, atrás de "Mostrar gabarito".
- Seletor de status sempre visível: **Não feita / Incompleta / Completa**, marcado apenas pelo
  usuário — a IA nunca altera esse status.
- Tag de origem visível (Enviada / Gerada de documentos / Gerada da internet / Gerada por
  conhecimento geral) e, nas geradas de documentos, as páginas de origem e o apoio de cada questão.
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
  árvore de tópicos), ferramentas, data de entrega e o campo de estimativa de tempo descrito em
  "Cronograma dinâmico". As associações vão para `entregavel_topicos`.
- **"Sugerir entregáveis"** — campo para descrever a expectativa do projeto. As sugestões aparecem
  como **cartões de proposta**, com "Adicionar" e "Descartar". Nada é gravado sem ação explícita.
- **"Montar a partir do roteiro"** — o roteiro do projeto vira uma sequência de entregáveis com
  datas distribuídas até a entrega final. Descrito abaixo.
- Concluir um entregável insere uma evidência para **cada** tópico associado (modo `projeto`,
  descrição "Entregável ⟨nome⟩ concluído").

#### Vínculo com avaliações
Entregáveis e listas de questões podem **valer para uma avaliação** do painel Acadêmico
(tabela `avaliacao_itens`). O campo **"Vale para a avaliação"** aparece no formulário do entregável,
no visualizador de lista e na criação de lista; em **"Montar a partir do roteiro"**, o campo **"Esta
entrega corresponde à avaliação"** sugere a data dela como entrega final e vincula todos os
entregáveis criados. O servidor recusa vínculo entre blocos diferentes e item que já pertença a
outra avaliação.

Com vínculos, **o trabalho está nos itens**: a avaliação sai da fila do cronograma como item próprio
(nada é contado duas vezes), e cada item mantém sua data e estimativa. Item vinculado **sem data
herda a data da avaliação** para fins de prazo.

#### Montar a partir do roteiro
O roteiro do projeto — `.pdf`, `.txt`, `.md`, `.docx` ou texto colado — vira uma sequência de
entregáveis com tópicos, tipo de tarefa, tempo estimado e datas. Pede a **data da entrega final**
(obrigatória), a data de **início** (padrão: hoje) e uma **margem** antes da entrega final (padrão:
10 % da janela, editável), para o último entregável não cair no mesmo dia da entrega. O texto fica
guardado em `documentos_fonte` do bloco.

**A IA decompõe e estima; o código calcula as datas.** `decomporRoteiro()` em
[`server/gemini.js`](server/gemini.js) devolve a lista **ordenada pela sequência de execução**, com
nome, descrição, tipo de tarefa, tempo estimado, tópicos e o trecho do roteiro que originou cada
item. Duas restrições no prompt:

- **tópicos**: escolhidos apenas entre os da tabela de conteúdos do bloco. O que o roteiro exige e a
  tabela não tem vai para `topicos_sugeridos`, sem ser associado a nada. (Os tópicos são oferecidos
  ao modelo com apelidos curtos — `t1`, `t2` — em vez dos UUIDs, que ele erra ao copiar; ids que não
  existem são descartados no servidor de qualquer forma.)
- **datas**: só vêm preenchidas quando o **roteiro determina** uma — entrega parcial, apresentação,
  checkpoint. Nunca inventadas, nunca calculadas pelo modelo.

#### Distribuição das datas
[`lib/distribuicaoDatas.ts`](client/src/lib/distribuicaoDatas.ts) é uma função pura, testável e
chamada de novo a cada edição na revisão — sem nova ida à IA:

1. aplica a **calibração** do usuário ao tempo de cada entregável, pelo mesmo `fatorCalibracao()` do
   cronograma;
2. os entregáveis com data travada são **marcos** que partem a linha do tempo em segmentos;
3. dentro de cada segmento, a data de cada um sai da **proporção do tempo acumulado** sobre o tempo
   do segmento — entregável maior ganha mais dias de calendário;
4. arredonda para dias inteiros, nunca antes do início e nunca fora de ordem na sequência;
5. o último sem data travada fica em **entrega final − margem**.

#### Revisão
**Nada é gravado sem passar pela revisão.** Uma linha do tempo compacta mostra a distribuição, com
os marcos travados destacados. A lista é editável e reordenável: nome, descrição, tipo de tarefa
(com autocomplete), tempo estimado, tópicos associados e o trecho de origem, que abre para
conferência. Cada data diz se é **calculada** ou **fixa do roteiro**, e pode ser travada ou
destravada à mão. Mexer em tempo, ordem ou travamento **redistribui as datas na hora**.

Entregáveis com nome semelhante a um que já existe no bloco vêm **desmarcados**, dizendo qual é. Se
o roteiro mencionar conhecimentos fora da tabela de conteúdos, aparece uma seção discreta com um
botão para abrir o editor da tabela — nunca são adicionados sozinhos.

Quando o tempo estimado total passa do que cabe na janela pelo orçamento diário, aparece uma linha
neutra dizendo isso. É **informação, não impedimento**: sem cor de alerta e sem bloquear a
confirmação.

#### O que é gravado
Cada entregável confirmado entra com nome, descrição, tipo de tarefa, tempo estimado, data calculada
e as associações em `entregavel_topicos`. A `origem_estimativa` registra de quem é o julgamento:
**`llm`** quando o usuário manteve a sugestão da IA e **`exata`** quando a editou — só a segunda
alimenta a calibração, porque só ela é estimativa dele. A data da entrega final vira um evento de
entrega do bloco, se ainda não houver um. Ao fim, um resumo curto: *"7 entregáveis criados até a
entrega final em 12/12."*

#### Testes teóricos
Ficam nesta mesma tela — nunca redirecionam para o Modo Prova.

- **"Pedir teste de um tópico"** abre o mesmo fluxo de três fontes do Modo Prova.
- Toggle **"Sugerir testes automaticamente"**: ligado, concluir um entregável gera testes para os
  tópicos associados. O **limite rígido de 3 testes por vez** está escrito ao lado do toggle;
  havendo mais tópicos, os de maior peso têm prioridade. Usa os documentos do bloco com a mesma
  recuperação por tópico das listas — só os trechos de cada tópico vão para o modelo, e o teste
  guarda as páginas de origem. Sem documentos, ou quando eles não tratam de um tópico, o entregável é
  concluído normalmente e a interface explica por que aquele teste não foi gerado.
- Os testes aparecem aqui com o mesmo visualizador do Modo Prova (gabarito recolhido + seletor de
  status) e não se misturam com as listas do Modo Prova.

### Acadêmico
Botão próprio no topo do bloco, ao lado da engrenagem, visível quando o bloco é uma disciplina
cursada — o que pode ser ligado a qualquer momento na aba "Bloco" das configurações, inclusive em
blocos criados sem disciplina. Abre um painel retrátil dentro da janela do bloco.

**Faltas** — `faltas_registradas / limite_faltas` com barra, botões "+1 falta" e "−1 falta" (nunca
abaixo de zero) e campo de edição direta. Sem limite registrado, a contagem continua funcionando e
um aviso neutro leva à aba "Bloco" para defini-lo (o mesmo vale para a média de aprovação). O texto do que resta é neutro ("Restam 4 faltas"); ao se
aproximar do limite fica âmbar, e ao atingir informa o fato ("O limite de faltas foi atingido").
Nunca vermelho alarmante nem linguagem de cobrança.

No topo, uma linha de nota lembra o que significa cada **natureza de tópico** — declarativo
(o quê), procedimental (como) e relacional (por quê) —, que é o que define o protocolo da sondagem.

**Média e simulação** — grade editável de avaliações (nome, peso, nota; a nota pode ficar vazia),
gravada em `avaliacoes`. Um botão de calendário em cada linha abre **data prevista**, **tempo
estimado** (os três caminhos), **tipo de tarefa**, a caixa **"Realizada"** e as **atividades
vinculadas** — todos opcionais: uma avaliação registrada só para a média continua valendo e apenas
não entra no cronograma.

**Gravação automática.** Não há botão de salvar: texto e número são gravados após uma pausa curta
(~600 ms) e ao sair do campo; data, seleção e caixas, na hora. Cada linha mostra "Salvando…",
"Salvo" ou nada. Entrada inválida (nota ou peso não numérico ou negativo) não é gravada: o campo
fica contornado, uma explicação curta aparece e o último valor válido continua no banco. Se a
gravação falhar, o valor digitado fica na tela com "Não foi possível salvar" e "Tentar novamente".
Uma linha nova só é gravada quando o primeiro campo é preenchido; linhas vazias são descartadas.
Notas simuladas nunca são gravadas, e excluir continua pedindo confirmação.

**Nota e "Realizada".** Com nota, não há caixa nem "Concluir" em lugar nenhum — mostra-se a nota,
que já diz que a avaliação aconteceu. Sem nota, a caixa **"Realizada"** tira a avaliação da fila e
a mostra concluída no calendário, "aguardando nota". Registrar a nota liga "Realizada" sozinha;
apagar a nota não desliga. O "Concluir" do cronograma e o "Marcar como realizada" do calendário
são o mesmo estado, e desmarcar desfaz.

**Atividades vinculadas.** Uma avaliação pode ser realizada por entregáveis e listas de questões
do mesmo bloco — um trabalho entregue em partes, uma lista que vale ponto. A multi-seleção
"Atividades vinculadas" lista as atividades do bloco; as que já pertencem a outra avaliação aparecem
desabilitadas, dizendo de qual (uma atividade vale para **no máximo uma** avaliação). O vínculo
também pode ser feito do lado da atividade — veja "Vínculo com avaliações" no Modo Projeto. Quando
todas as vinculadas estão concluídas e ainda não há nota, aparece só uma linha discreta: *"Todas as
atividades vinculadas foram concluídas."* Quem conclui a avaliação continua sendo a nota.

Três resultados ao vivo:

1. **Média atual** — só as avaliações com nota, ponderada por peso.
2. **Média final projetada** — as restantes assumem a média atual.
3. **Nota necessária** — a média exigida nas restantes para fechar `media_aprovacao`. Quando a
   aprovação já está garantida, ou já não é alcançável, o texto diz isso de forma factual.

O toggle **"Simular notas"** preenche notas hipotéticas nas avaliações sem nota, em itálico e com
fundo distinto; elas recalculam a projeção ao vivo, **nunca** são salvas e não afetam a média atual
nem a nota necessária. Há botão "Limpar simulação". Um seletor declara a soma esperada dos pesos
(livre, 10 ou 100) e, quando ela não fecha, aparece um aviso informativo que não impede o uso.

A caixa **"Calcular por fórmula"** escolhe entre os dois modos, e a escolha é gravada no bloco.
No modo ponderado aparecem a coluna de peso e os três resultados acima; no modo fórmula, a coluna
de peso e esses resultados somem — dão lugar à fórmula. Trocar de modo não apaga nada: os pesos e a
fórmula continuam guardados.

Listas longas nascem recolhidas, mostrando as primeiras avaliações com um degradê e uma seta que
expande o restante. Mesmo recolhidas, todas as avaliações continuam valendo no cálculo e disponíveis
como variáveis.

**Fórmula da média** — quando a regra da disciplina não é uma simples ponderação, dá
para escrevê-la usando as próprias avaliações como variáveis. Cada avaliação vira um identificador
a partir do nome (`Trabalho final` → `TRABALHO_FINAL`), mostrado em botões que inserem no campo.

A fórmula aceita `+ − * / ^`, parênteses, comparações (`> >= < <= = <>`) e as funções `min`, `max`,
`media`, `soma`, `arred`, `abs`, `se(condição; então; senão)` e
`soma_maiores` / `soma_menores`. Exemplo de regra com substitutiva:

```
se((P1+P2)/2 >= 5; (P1+P2)/2; (max(P1;P2) + SUBSTITUTIVA)/2)
```

**`soma_maiores(quantidade; ...)`** soma as N maiores notas da lista, e `soma_menores` as N menores
— útil quando a disciplina aproveita só as melhores de um conjunto grande de atividades, sem
precisar escrever todas as combinações à mão:

```
soma_maiores(3; A1; A2; A3; A4; A5; A6; A7; A8) / 3
```

Pedir mais do que existe soma tudo; pedir zero soma nada; a quantidade pode ser uma expressão.
Os apelidos `soma_max` e `soma_min` também funcionam. Para descartar só a pior nota, continua mais
curto usar `soma(...) - min(...)`.

O `se` avalia **só o ramo escolhido**, então uma nota que ainda não existe no ramo não usado não
atrapalha o cálculo. Notas que faltam no ramo em uso nunca são chutadas: a interface diz quais são,
pelo nome da avaliação. Erros de escrita aparecem enquanto se digita e impedem o salvamento.
Ligado o simulador, um segundo resultado mostra a média com as notas hipotéticas.

A expressão é interpretada por um analisador próprio ([`client/src/formula.ts`](client/src/formula.ts)),
sem `eval` e sem acesso a nada fora da fórmula.

As notas são dado acadêmico informado pelo usuário — a plataforma não gera, infere nem atribui nota.

### Cronograma dinâmico
Decide o que fazer primeiro a partir de prazo, tamanho da tarefa e histórico do próprio usuário.
**A prioridade nunca é exibida como número**: o que aparece é o motivo em texto ("Prazo em 3 dias",
"Pouco tempo para o trabalho restante").

#### Estimativa de tempo
Todo item agendável — entregável, lista de questões e avaliação — tem um campo de tempo com **três
caminhos de peso visual igual**, nenhum pré-selecionado:

1. **Sugerir com IA** — o resultado vem editável, com a linha discreta
   *"Estimativa aproximada, ajuste se necessário."* Se a IA falhar, os outros dois continuam ali.
2. **Escolher faixa** — menos de 1 h / 1 a 3 h / 3 a 8 h / mais de um dia.
3. **Informar tempo exato** — em minutos.

A origem é sempre gravada em `origem_estimativa` (`llm`, `faixa` ou `exata`). **Só `faixa` e `exata`
alimentam a calibração:** usar a estimativa da IA mediria o erro do modelo, não o de quem estuda.
O **tipo de tarefa** é texto livre com autocomplete a partir dos tipos já usados, para que variações
de escrita não virem tipos diferentes.

#### Calibração
[`client/src/lib/calibracao.ts`](client/src/lib/calibracao.ts) expõe uma única função,
`fatorCalibracao(tipo, historico)`, que devolve o fator e o motivo em texto. Usa a **mediana** das
razões entre tempo real e estimado — nunca a média, para que uma semana ruim não distorça tudo.
Com casos suficientes do mesmo tipo, calibra por tipo; senão, pelo histórico geral; sem histórico,
fator 1. Um tipo que já existe mas nunca foi concluído recebe o acréscimo de novidade — só quando já
há algum histórico, porque sem nenhum dado dizer "primeira tarefa deste tipo" afirmaria mais do que
se sabe. O motivo aparece como nota discreta, em texto pequeno, sem ícone de alerta nem caixa
destacada.

#### Pipeline de prioridade
[`client/src/lib/cronograma.ts`](client/src/lib/cronograma.ts), nesta ordem: estimativa →
calibração → trabalho restante → folga → urgência absoluta → combinação → peso da classe → ajuste
manual → ordenação e agrupamento. Devolve a fila **completa e pontuada**; o corte é decisão de tela.
Empates (comuns quando nada mais cabe no prazo) são desfeitos pelo prazo mais próximo, nunca pela
ordem em que os itens saíram do banco.

Trabalho restante por tipo: entregável entra inteiro ou sai; lista conta 100 % se não feita, 50 % se
incompleta e sai se completa; avaliação com nota, marcada como realizada ou com atividades
vinculadas sai da fila (no último caso o trabalho está nos itens, que herdam a data dela quando não
têm a própria); revisão usa o tempo por peso do tópico.

#### Constantes calibráveis
Estão todas reunidas no topo de `cronograma.ts` (as da calibração vivem em `calibracao.ts` e são
reexportadas de lá), porque devem ser ajustadas com uso real:

| Constante | Valor | O que faz |
| --- | --- | --- |
| `PESO_CLASSE_APRENDIZAGEM` | 0,65 | Estudo pessoal pesa menos que entrega concreta, sem sumir |
| `MEIA_VIDA_DIAS` | 7 | Meia-vida do decaimento da urgência absoluta |
| `DIAS_SATURACAO` | 3 | A partir daqui a urgência satura em 1 |
| `PESO_FOLGA` | 0,65 | Peso da folga (tempo disponível ÷ trabalho restante) |
| `PESO_URGENCIA_ABSOLUTA` | 0,35 | Peso do prazo puro, independente do tamanho |
| `MULTIPLO_HORIZONTE` | 3 | Item grande entra cedo se o tempo restante for menor que este múltiplo do trabalho |
| `HORIZONTE_DIAS` | 14 | Janela do cronograma; além disso o item é agrupado à parte |
| `PENALIDADE_REPETICAO` | 0,15 | Desconto por item repetido do mesmo bloco ou modo, nas sugestões do dia |
| `ORCAMENTO_PADRAO_MIN` | 240 | Orçamento diário padrão, em minutos |
| `PASSO_AJUSTE_MANUAL` | 0,08 | Quanto um ajuste manual desloca a pontuação, por posição arrastada |
| `TEMPO_REVISAO_POR_PESO` | 15 / 25 / 40 | Minutos de uma revisão, por peso do tópico |
| `MIN_CASOS_TIPO` | 4 | Casos do mesmo tipo para calibrar por tipo |
| `MIN_CASOS_GLOBAL` | 6 | Casos de qualquer tipo para calibrar pelo histórico geral |
| `FATOR_NOVIDADE` | 1,3 | Acréscimo quando o tipo nunca foi concluído antes |
| `CALIB_MIN` / `CALIB_MAX` | 0,8 / 1,3 | Faixa em que o fator final é sempre contido |

#### Sugestões do dia
Sobre a fila ordenada, itens repetidos do mesmo bloco e do mesmo modo perdem pontos de forma
acumulativa, para que o dia varie de assunto — mas os realmente urgentes sobrevivem ao desconto. A
escolha é gulosa: o desconto é recalculado sobre o que já foi escolhido, senão a penalidade viraria
penalidade de posição (o terceiro item seria descontado por ser o terceiro, viesse de que bloco
viesse). Depois vem o corte por orçamento: **o primeiro item entra mesmo estourando** — é o mais
prioritário, e escondê-lo não o faria sumir; do segundo em diante, só o que cabe.

#### Onde o cronograma vive
Na **coluna direita da página Calendário**. Uma lista só, agrupada em **Hoje**, **Esta semana**,
**Depois** e **Além do horizonte** (este último recolhido por padrão). Filtros por bloco e por modo.
Cada item traz **Concluir** e **Reagendar** — reagendar apenas move a data e nunca conta como
atraso.

Em avaliações, **"Concluir" marca que você já a fez** e não inventa nota nenhuma: quem prestou a
prova já a fez, mesmo que o resultado só saia semanas depois. A avaliação sai do cronograma na hora,
e a nota continua sendo registrada — ou não — no painel Acadêmico, para onde leva o botão
**"Registrar nota"** ao lado. Registrar a nota também conclui, sem precisar marcar nada.
Qualquer um dos dois caminhos grava a data de conclusão, que é o que alimenta a calibração.

#### Ajuste manual
Arrastar um item para cima ou para baixo grava a intenção em `ajustes_prioridade` e **a fila é
remontada com ela aplicada** — nada é reordenado visualmente à força. A magnitude vem das posições
andadas e o usuário nunca a vê nem a digita. Um item ajustado ganha **"Restaurar posição
calculada"**.

O ajuste do usuário só cede diante de um fato novo: **o rebaixamento expira sozinho** quando o prazo
entra na saturação, com a linha discreta *"Ajuste desfeito: o prazo está próximo."* A **promoção não
expira com o tempo**, e ajustar um item que já está urgente continua permitido.

### Calendário
Duas áreas na mesma página: o **calendário** à esquerda e o **cronograma** na coluna direita. Elas
são separadas por borda e fundo próprios de propósito, porque o arraste significa coisas diferentes
em cada uma — **no calendário não existe arraste** (mudar data é decisão consciente, feita pelo
modal) e **no cronograma arrastar ajusta a prioridade**. Em telas estreitas a coluna vira um painel
recolhível abaixo do calendário.

#### O calendário
Alternância **Mês** / **Semana**, navegação entre períodos e botão **Hoje**. As semanas começam no
domingo. Cada item é uma pílula compacta; quando não cabem todos num dia, aparece **"+N"**, que
expande aquele dia.

Aparecem **cinco origens**, cada uma com cor própria e legenda fixa no rodapé da grade:

| Origem | Tabela | De onde vem |
| --- | --- | --- |
| Evento | `eventos` | criado à mão no calendário |
| Avaliação | `avaliacoes` | painel Acadêmico, com `data_prevista` |
| Entregável | `entregaveis` | Modo Projeto, com `data_entrega` |
| Lista de questões | `listas_questoes` | Modo Prova/Projeto, com `data_prevista` |
| Revisão | `revisoes` | repetição espaçada do Modo Aprendizagem |

Clicar num **dia com itens** filtra o cronograma ao lado para os prazos daquele dia, com indicador e
botão para limpar. Clicar num **dia vazio** abre o novo evento com a data preenchida — o botão
"Novo evento" faz o mesmo a qualquer momento. Clicar num item abre seus detalhes.

#### Excluir pelo calendário
Todo item pode ser **reagendado**, **concluído** e **excluído** pelo modal. Excluir aqui é o mesmo
que excluir na origem, e a confirmação diz o que acontece, conforme o tipo:

- **evento** — só ele é removido;
- **avaliação** — sai do painel Acadêmico e da média; *"As atividades vinculadas serão mantidas,
  sem vínculo."*;
- **entregável** — sai do Modo Projeto; se valia para uma avaliação, *"Ele deixará de fazer parte
  da avaliação ⟨nome⟩."*;
- **lista de questões** — sai do modo de origem, com o mesmo aviso de vínculo;
- **revisão** — *"O ciclo de revisões deste tópico será encerrado."*

As **evidências são sempre mantidas**. Vínculos com avaliação (`avaliacao_itens`), registros de
procedência (`documento_usos`) e ajustes manuais do item são removidos, e o cronograma é recalculado.
Reagendar uma revisão move a data **sem avançar o número** da revisão.

Avaliação com nota mostra a nota em vez de "Concluir"; sem nota, o botão é **"Marcar como
realizada"**, e ela passa a aparecer concluída, "aguardando nota". Entregáveis e listas vinculados
dizem para qual avaliação valem.

#### Importar de documento
O botão **"Importar de documento"** lê um calendário de disciplina, um cronograma de curso ou uma
programação e propõe os eventos que encontrar. Aceita `.pdf`, `.txt`, `.md` e `.docx`, ou texto
colado. O bloco é **obrigatório** (com a opção "Sem bloco" para programações gerais) e há um campo
opcional de **início do período letivo**, usado para resolver datas relativas como "semana 5" ou
"aula 12". O texto extraído fica guardado em `documentos_fonte` do bloco, como na construção da
tabela de conteúdos.

`extrairEventos()` em [`server/gemini.js`](server/gemini.js) devolve, para cada item, título, data,
hora, tipo, o **trecho do documento** de onde a data saiu e um grau de **confiança**:

- **alta** — a data está explícita e completa no documento;
- **baixa** — o modelo inferiu o ano, converteu uma data relativa ou o formato era ambíguo
  (`03/04` pode ser 3 de abril ou 4 de março).

O prompt proíbe inventar data: um evento mencionado sem data identificável entra com data nula e
confiança baixa. Aulas regulares recorrentes **não** são extraídas, a menos que o toggle "Incluir
aulas regulares" seja ligado — aí a leitura é refeita.

#### Revisão: a IA propõe, você confirma
**Nada é gravado sem passar pela tela de revisão.** Ela é uma tabela editável: dá para mudar
qualquer campo, excluir linhas e adicionar linhas à mão. Cada item mostra o trecho de origem, que
abre para conferência.

Vem **desmarcado** o que precisa de atenção — item sem data (não há o que gravar) e provável
duplicata. Datas incertas vêm **marcadas**, mas sinalizadas com um "confira a data" discreto: data
incerta é avisada, nunca escondida nem apresentada como certa.

A **detecção de duplicatas** compara cada item com o que já existe no calendário do mesmo bloco —
eventos, avaliações e entregáveis — por mesma data e título semelhante (comparação por palavras, em
[`lib/importacao.ts`](client/src/lib/importacao.ts), para que "Prova 1" e "Prova 1 — Termodinâmica"
sejam o mesmo compromisso). A linha aparece desmarcada, dizendo qual item já existe.

#### O que cada item vira
Vale a mesma regra de unificação do calendário — a gravação passa por `POST /api/eventos`, que já
decide entre evento e avaliação, então a regra existe num lugar só:

| Item | Bloco | Vira |
| --- | --- | --- |
| prova | com wrapper acadêmico | **avaliação** do bloco, com nome e data prevista |
| prova | sem wrapper, ou sem bloco | evento comum do tipo prova |
| entrega | qualquer | evento; a linha oferece **"Criar como entregável do modo projeto"** |
| aula, outro | qualquer | evento comum |

A avaliação nasce sem peso, tempo estimado e tipo de tarefa — a preencher depois no painel
Acadêmico. Enquanto não tiver tempo estimado, ela **aparece no calendário mas não entra no
cronograma**, que é o comportamento normal de uma avaliação sem estimativa.

Quando há provas indo para evento só porque o bloco não tem wrapper, aparece uma sugestão discreta —
*"Este bloco tem provas; ativar o wrapper acadêmico?"* — com um botão que ativa o wrapper e
reclassifica aquelas linhas como avaliações, ali mesmo.

Ao final, um resumo curto e nada mais: *"12 itens importados: 3 avaliações, 2 entregáveis, 7
eventos."*

#### Uma prova, um registro só
Tipo **"prova"** associado a um bloco com wrapper acadêmico **vira uma avaliação daquele bloco**, e
o formulário muda para os campos da avaliação: nome, peso, data prevista, tempo estimado (os três
caminhos) e tipo de tarefa. O mesmo registro aparece no painel Acadêmico, no calendário e no
cronograma — e o que é cadastrado pelo wrapper aparece no calendário. Nunca duas entradas para a
mesma prova.

Prova **sem** disciplina associada (bloco sem wrapper, ou sem bloco) continua sendo um evento comum:
aparece no calendário e não entra no cronograma, porque não há o que priorizar.

Eventos de prova que já existissem ligados a blocos com wrapper são convertidos em avaliação na
subida do servidor, preservando id, data e observação — `unificarProvasDuplicadas()` em
[`server/db.js`](server/db.js), idempotente.

#### Ligação entre as duas áreas
As duas conversam só por **realce**, nunca misturando o que cada uma faz:

- passar o mouse ou clicar num item do cronograma realça a data dele no calendário, navegando até o
  mês ou a semana certa se ela estiver fora da vista;
- clicar num dia do calendário filtra o cronograma para aquele prazo;
- clicar num item do calendário realça a mesma linha no cronograma e rola até ela;
- passar o mouse ou clicar numa avaliação realça as atividades vinculadas a ela, e vice-versa.

Nada desse realce reordena a fila nem altera prioridade.

### Desempenho
Descreve o que foi registrado; **não avalia quem estudou**. Não há score, percentual de domínio,
tendência, comparação entre períodos nem gamificação, e as evidências de aprendizagem não entram em
conta nenhuma — são log qualitativo. Todo número aparece junto do que o sustenta: quantas tarefas,
quantas sessões, quantas notas.

A agregação mora em [`client/src/lib/desempenho.ts`](client/src/lib/desempenho.ts), separada da
tela para poder ser testada sem navegador; o servidor devolve os dados crus em `/api/desempenho`.

#### Filtros
Multi-seleção de blocos, **todos marcados por padrão** (a visão nasce agregada), com "Marcar todos"
e "Desmarcar todos". Desmarcar recalcula todas as seções. Um segundo filtro escolhe quais tipos de
item entram no gráfico de metas — avaliações, entregáveis e listas —, em qualquer combinação.

#### Cumprimento do plano atual
Barras por mês: **concluídos na data** contra **concluídos após a data**. "Na data" significa que a
conclusão aconteceu até a **data vigente** do item — a data atual, já com qualquer reagendamento
aplicado. É por isso que reagendar nunca aparece como atraso, e o subtítulo diz isso na tela.

Revisões de aprendizagem **nunca** entram aqui. As cores são a neutra do tema e um âmbar suave:
vermelho seria linguagem de falha. Com menos de 3 itens concluídos, no lugar do gráfico aparece uma
explicação do que falta, em vez de um gráfico vazio.

#### Situação acadêmica
Só blocos que são disciplina cursada. Por bloco, faltas contra o limite e média atual contra a média
de aprovação, com o número de notas que sustenta a média. Âmbar ao se aproximar do limite — a mesma
margem do painel Acadêmico, nunca vermelho nem cobrança. Limite zero é tratado como "não
registrado", como no painel. Se nenhum bloco selecionado for disciplina, a seção vira uma nota curta.

#### Como suas estimativas se comparam ao tempo real
Uma linha por tipo de tarefa: *"Programação — em mediana, 1,2× o estimado (8 tarefas)"*, sempre com
o número de tarefas. Abaixo de `MIN_CASOS_TIPO`, a linha diz "histórico insuficiente" em vez de um
valor que não se sustenta. Quando a mediana bruta cai fora da faixa `[CALIB_MIN, CALIB_MAX]`, a
linha informa qual fator o cronograma aplica de fato.

O cálculo é o mesmo de [`calibracao.ts`](client/src/lib/calibracao.ts) — `resumoPorTipo()` usa os
mesmos auxiliares de `fatorCalibracao()`, sem conta paralela. Estimativa da IA continua fora:
mediria o acerto do modelo, não o de quem estuda.

É informação sobre as estimativas, **não sobre a pessoa**: sem cores de acerto e erro, sem "você
subestima", sem ranking — os tipos vêm em ordem alfabética justamente para não insinuar um.

#### Tempo de foco acumulado
Total por bloco e um total geral, com quantas sessões sustentam cada número. Sessões sem bloco
aparecem em "Sem bloco". **Só o acumulado**: sem série temporal, sem comparação entre dias ou
semanas, sem tendência e sem meta — e nunca confrontado com o orçamento diário de estudo.

#### Revisões de aprendizagem
Uma linha de texto: *"X em dia · Y atrasadas · Z reagendadas"*, com a nota "Status de organização
das revisões, não uma medida de desempenho". Nunca em percentual, meta ou gráfico comparativo. As
três categorias somam as pendentes, e uma revisão reagendada que passou da nova data conta como
atrasada — a mesma regra do plano vigente.

### Sessão de foco
Registro voluntário de tempo, iniciável pela barra lateral ou pelo cabeçalho do bloco (nesse caso a
sessão fica associada ao `bloco_id`). Ao iniciar, um painel em destaque mostra o cronômetro
crescente, o nome do bloco e os botões "Pausar" e "Encerrar"; o painel pode ser ocultado e a sessão
continua, com o indicador discreto da barra lateral. Uma sessão aberta sobrevive ao recarregamento
da página. Ao encerrar, início e fim vão para `sessoes_foco` e o tempo total é exibido (quando houve
pausas, o resumo mostra também o tempo decorrido e o tempo em pausa).

**Não há bloqueio de sites, abas ou aplicativos** — a própria interface diz isso. Sem meta de tempo,
streak ou comparação entre dias.

---

## Princípios de design

Estes princípios estão refletidos no código e devem ser preservados em etapas futuras:

0. Um documento existe **uma única vez por bloco**, e excluí-lo nunca apaga o que foi gerado a
   partir dele.
1. A plataforma **registra e organiza, nunca avalia**. Nenhuma marcação de progresso depende de
   julgamento da IA — todo check é feito pelo usuário.
2. **Nunca exibir nota, score ou percentual de domínio.** Apenas checklist binário e log qualitativo
   de evidências. Barras de progresso só com contagens objetivas (ex.: "4 de 12 tópicos marcados").
3. Os três modos são **lentes** sobre o mesmo bloco, nunca etapas sequenciais. Nenhuma ação de um
   modo é bloqueada por falta de progresso em outro.
4. **Reagendar nunca aparece como atraso**, falha ou pendência negativa.
5. **Falha da IA nunca bloqueia a tela** — sempre existe o caminho manual equivalente. Onde a IA
   propõe conteúdo, **quem confirma é o usuário**: nada entra no banco sem passar por uma revisão.
6. Linguagem neutra e informativa. Sem gamificação, streaks, cobrança ou mensagens motivacionais.
7. As **evidências são um log qualitativo**: nunca são somadas, contadas ou convertidas em
   percentual.
8. Todo número exibido vem acompanhado **do que o sustenta** — quantas tarefas, quantas sessões,
   quantas notas, qual período.

---

## Banco de dados

Tabelas em uso: `pastas`, `blocos`, `bloco_relacoes`, `topicos`, `revisoes`, `evidencias`,
`mensagens_chat`, `documentos_fonte`, `listas_questoes`, `entregaveis`, `entregavel_topicos`,
`avaliacoes`, `sessoes_foco`, `compromissos_diarios`, `ajustes_prioridade`, `config`, `eventos`,
`documento_usos`, `avaliacao_itens` (vínculo avaliação → entregável/lista, com índice único por
item: cada atividade vale para no máximo uma avaliação), `documento_trechos` (trechos de cada
documento, com páginas, seção e embedding; saem junto com o documento, por `ON DELETE CASCADE`).

Em `documentos_fonte`, o processamento usa `status`, `etapa`, `progresso_feito`/`progresso_total`,
`motivo`, `indice` (`semantico` ou `palavras`; nulo = ainda não indexado), `extraido`, `paginas` e
`sumario` (JSON). Em `listas_questoes`, `origem_paginas` guarda de que páginas a lista saiu.

Nenhuma tabela nova para a fusão: ela é o conjunto de arestas `fusao_com` que apontam para o mesmo
bloco resultado.

As colunas acrescentadas depois da primeira versão (gabarito e contexto das listas, ferramentas,
tempo estimado e conclusão dos entregáveis, preferência de testes automáticos do bloco e, para o
cronograma dinâmico, `data_prevista`, `tempo_estimado_min`, `origem_estimativa`, `tipo_tarefa` e
`concluido_em` em listas e avaliações, mais `feita` e `realizada` em avaliações) entram por uma migration
idempotente em `migrar()`, já que
`CREATE TABLE IF NOT EXISTS` não altera tabelas existentes. As datas de conclusão são o que permite
calibrar a estimativa depois.

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
| GET/POST | `/api/blocos/:id/documentos` | Repositório do bloco; o POST (multipart para arquivo, JSON para texto colado) deduplica pelo hash e responde antes da extração |
| PATCH/DELETE | `/api/documentos/:id` | Renomear, mudar categoria, excluir |
| GET | `/api/documentos/:id/arquivo` | Baixa o arquivo original |
| POST | `/api/documento-usos` | Registra de quais documentos um item foi gerado |
| GET | `/api/documento-usos/:tipo/:id` | Procedência de um item gerado |
| GET | `/api/documentos/:id` | Status do processamento de um documento |
| POST | `/api/blocos/:id/documentos/indexar` | "Indexar documentos": o que falhou ou ficou incompleto |
| POST | `/api/documentos/material` | O que um fluxo enviaria à IA com uma seleção: tamanho, teto e aviso de redução |
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
| GET/PUT | `/api/blocos/:id/avaliacoes` | Grade de avaliações do painel Acadêmico |
| GET/POST | `/api/foco/ativa`, `/api/foco/iniciar` | Sessão de foco aberta e início de sessão |
| POST | `/api/foco/:id/encerrar` | Encerra e devolve a duração |
| GET/POST | `/api/compromissos` | Compromissos de um dia (padrão: hoje) |
| PATCH/DELETE | `/api/compromissos/:id` | Editar, concluir ou excluir |
| GET | `/api/compromissos/datas` | Dias que já têm registro, para a consulta |
| GET | `/api/inicio` | Blocos recentes e revisões pendentes hoje |
| PATCH | `/api/avaliacoes/:id` | Reagendar uma avaliação ou marcá-la como realizada (nunca gera nota) |
| GET | `/api/blocos/:id/vinculos` | Vínculos avaliação → atividade do bloco |
| PUT | `/api/avaliacoes/:id/itens` | Define as atividades de uma avaliação (mesmo bloco, um dono por item) |
| PUT | `/api/vinculos/:tipo/:id` | Define ou remove a avaliação de um entregável ou lista |
| GET | `/api/calendario/:tipo/:id/consequencias` | O que a exclusão de um item do calendário acarreta |
| DELETE | `/api/calendario/:tipo/:id` | Exclui na origem; mantém evidências, remove vínculos e usos |
| GET/PATCH | `/api/config` | Preferências simples, como o orçamento diário |
| GET | `/api/tipos-tarefa` | Tipos já usados, para o autocomplete |
| POST | `/api/ia/estimar-tempo` | Estimativa de tempo pela IA (falha não bloqueia) |
| PUT/DELETE | `/api/ajustes-prioridade` | Gravar e desfazer o ajuste manual de um item |
| GET | `/api/cronograma` | Dados crus da fila: itens, histórico de calibração e ajustes |
| GET | `/api/calendario` | As cinco origens de item num payload só, opcionalmente por intervalo |
| GET | `/api/desempenho` | Dados crus da página de Desempenho (metas, notas, calibração, foco, revisões) |
| GET/PUT/DELETE | `/api/blocos/:id/fusao` | Ler, definir e desfazer a fusão de um bloco resultado |
| GET | `/api/grafo` | Blocos com posição, relações e config, para o mapa |
| PATCH | `/api/blocos/:id/posicao` | Move um bloco no mapa (nunca cria relação) |
| PUT | `/api/grafo/posicoes` | Grava várias posições: primeiro layout e "Reorganizar mapa" |
| POST | `/api/eventos` | Cria evento — ou avaliação, quando é prova de disciplina |
| POST | `/api/ia/extrair-eventos` | Lê um documento e propõe eventos (nada é gravado aqui) |
| POST | `/api/ia/decompor-roteiro` | Decompõe o roteiro de um projeto em entregáveis propostos |
| PATCH/DELETE | `/api/eventos/:id` | Editar/reagendar e excluir um evento criado à mão |

---

## Próximos passos

Ficou fora desta etapa:

- **Eventos com hora e duração** — `eventos` já tem `data_inicio` e `data_fim`, mas o calendário
  trabalha só com o dia: não há grade de horários nem eventos de vários dias.
- **Histórico de sessões de foco** — o Desempenho mostra o acumulado por bloco, mas não há lista
  das sessões uma a uma.
- **Busca na internet com uma chave real** — a geração usa a ferramenta de busca do Gemini
  (`google_search`). O caminho foi exercitado até a resposta da API, mas o resultado com busca
  ativa só pode ser conferido com uma `GEMINI_API_KEY` válida.
- **Anexar respostas por arquivo na correção** — hoje as respostas são coladas no chat.
- **OCR para PDFs digitalizados** — um livro escaneado (só imagem) não tem texto a extrair e fica
  como "falhou"; seria preciso um passo de OCR antes da divisão em trechos.
- **Progresso do envio em si** — o status acompanha a leitura e a indexação, mas não a
  transferência do arquivo; num arquivo grande, os segundos do upload aparecem só como "enviando…".
