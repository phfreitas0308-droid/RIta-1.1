# Chatbot – Reforma Tributária

Chatbot que responde dúvidas sobre a Reforma Tributária brasileira (IBS, CBS,
Imposto Seletivo, cronograma de transição, alíquotas e split payment), com
base na EC 132/2023, LC 214/2025, LC 227/2026 e no Decreto 12.955/2026
(regulamento da CBS), além dos documentos técnicos da DeRE (Declaração de
Regimes Específicos — leiautes, mensagens de erro, regras de validação e
manual do usuário).

## Como funciona

- `index.html` — frontend estático (chat), sem nenhuma chave de API exposta.
- `api/chat.js` — função serverless que recebe a pergunta do navegador e
  chama a API da OpenAI **no servidor**, mantendo sua chave protegida.
- `lib/kb.js` — resumo curado da legislação (usado como rede de segurança
  enquanto o índice de busca abaixo não existir).
- `sources/*.txt` — textos brutos da EC 132/2023, LC 214/2025, LC 227/2026, do
  Decreto 12.955/2026 (regulamento da CBS) e do glossário, extraídos dos
  documentos oficiais.
- `scripts/chunk_laws.py` — divide esses textos em ~4.000 blocos por artigo/
  parágrafo/inciso, cada um com sua referência exata (ex.:
  `"Art. 47, § 2º, inciso III, LC 214/2025"`), e grava o resultado em
  `data/chunks_leis_reforma_tributaria.json`. Também separa corretamente os
  "Anexos" de cada lei (tabelas de produtos, códigos NCM/SH etc.) em blocos
  próprios — numa versão anterior esse conteúdo ficava grudado no último
  artigo do texto, virando um bloco gigante e praticamente inútil para busca.
- `sources/dere_*.txt` — textos brutos dos 7 documentos técnicos da DeRE
  (Declaração de Regimes Específicos): mensagens de erro do sistema, Receita
  Integra (API), histórico de versões, leiautes dos eventos, os Anexos I
  (tabelas de códigos) e II (regras de validação), e o manual do usuário.
- `scripts/chunk_dere.py` — divide os 7 documentos da DeRE acima em blocos,
  com uma estratégia diferente para cada tipo de conteúdo (1 bloco por código
  de mensagem de erro, 1 por regra de validação, 1 por seção numerada, e
  blocos por grupo de linhas nas tabelas de código) — e acrescenta esses
  blocos ao mesmo `data/chunks_leis_reforma_tributaria.json` das leis, sem
  apagar os blocos das leis já existentes.
- `data/chunks_leis_reforma_tributaria.json` — o resultado dos dois scripts
  acima, já gerado (leis + documentos da DeRE, ~4.500 blocos no total — você
  só precisa rodar `chunk_laws.py`/`chunk_dere.py` de novo se uma lei ou um
  documento da DeRE for atualizado).
- `scripts/build_index.js` — script que você roda **uma vez, no seu
  computador**, para transformar esses blocos em um índice de busca (embeddings).
- `lib/retrieval.js` — no servidor, a cada pergunta, busca os trechos mais
  parecidos com a pergunta dentro desse índice e os envia ao modelo, no lugar
  do resumo fixo — assim a resposta pode citar o artigo exato em vez de um
  resumo genérico.
- `api/log-access.js` / `api/access-log.js` — registram e mostram quem fez
  login (nome/cargo/empresa/data-hora) — veja "Registro de acessos" abaixo.
- `api/survey.js` / `api/survey-log.js` — recebem e mostram as respostas da
  pesquisa de 8 perguntas que a RITA faz no chat, obrigatoriamente, antes de
  liberar a conversa — veja "Pesquisa de perfil" abaixo.
- `lib/analyze.js` — antes de responder, uma chamada rápida classifica a
  pergunta: se for **ambígua** (depende de algo que só o usuário sabe, ex.:
  o regime tributário da empresa dele), o chatbot pergunta antes de responder;
  se for **complexa** (cruza vários temas), ela é decomposta em sub-perguntas,
  cada uma busca seu próprio conjunto de trechos, e a resposta final usa mais
  "esforço de raciocínio" (`reasoning_effort: high`) — perguntas simples usam
  `low`, para manter a resposta rápida e barata.

## Gerar o índice de busca (RAG) — recomendado, roda uma vez

Sem esse passo, o chatbot continua funcionando normalmente, só que usando o
resumo fixo de `lib/kb.js` (menos preciso). Para ativar a busca nos textos
completos das leis:

1. No seu computador, instale o [Node.js](https://nodejs.org) (versão 18 ou mais recente) se ainda não tiver.
2. Baixe/descompacte esta pasta do projeto no seu computador.
3. Copie `.env.example` para `.env` e preencha `OPENAI_API_KEY` com sua chave.
4. Abra um terminal nesta pasta e rode:
   ```
   node --env-file=.env scripts/build_index.js
   ```
   (se der erro de "unknown option --env-file", seu Node é mais antigo — rode `export OPENAI_API_KEY=sk-...` antes e depois `node scripts/build_index.js`)
5. O script vai demorar alguns minutos (são ~4.500 blocos) e vai custar poucos
   centavos de dólar na sua conta OpenAI. Ao final, ele cria os arquivos:
   - `data/index_ec132.json`
   - `data/index_lc214.json`
   - `data/index_lc227.json`
   - `data/index_glossario.json`
   - `data/index_dere_mensagens_erro.json`
   - `data/index_dere_receita_integra.json`
   - `data/index_dere_historico_versoes.json`
   - `data/index_dere_anexo2_regras.json`
   - `data/index_dere_anexo1_tabelas.json`
   - `data/index_dere_leiautes.json`
   - `data/index_dere_manual_usuario.json`
6. Suba esses arquivos novos para o mesmo repositório do GitHub (mesma pasta
   `data/`), do mesmo jeito que você já fez com o `index.html` — a Vercel
   refaz o deploy sozinha.
7. A partir daí, toda pergunta passa a buscar automaticamente nos textos
   completos das leis, citando o artigo exato.

**Se você já tinha gerado o índice antes** (arquivos `data/index_*.json`) e
agora está atualizando o projeto por causa da correção nos blocos (Anexos), os
blocos mudaram — os índices antigos ficaram desatualizados. Repita os passos
3 a 6 acima para gerar `data/index_*.json` de novo a partir do
`data/chunks_leis_reforma_tributaria.json` atualizado, e suba os novos
arquivos para o GitHub. Sem isso, o site continua funcionando, mas com o
índice de busca antigo (baseado na divisão anterior, com o bloco gigante nos
Anexos).

**Atualização de 31/jul — correção de redação antiga x nova:** o texto da
LC 214/2025 (extraído da página de texto compilado do planalto.gov.br) mostra,
para vários artigos, a redação ORIGINAL seguida da redação NOVA dada pela
LC 227/2026, uma logo depois da outra. Isso fazia alguns artigos ficarem
indexados duas vezes com a mesma referência (uma vigente, outra já superada),
e a busca podia trazer qualquer uma das duas — o que já causou pelo menos uma
resposta citando uma regra desatualizada (art. 32, § 1º, sobre split payment).
`scripts/chunk_laws.py` e `lib/chunker.js` foram corrigidos para reconhecer
esses casos e manter só a redação vigente; `data/chunks_leis_reforma_tributaria.json`
já foi regenerado com a correção (leis + DeRE). **Mas os embeddings em
`data/index_*.json` ainda são os antigos** — para a correção valer no site,
repita os passos 3 a 6 acima (rodar `node scripts/build_index.js` com sua
`OPENAI_API_KEY` e subir os novos `data/index_*.json` para o GitHub).

**Atualização de 05/ago — adicionado o Decreto 12.955/2026 (regulamento da CBS)
e corrigido um bug que perdia os Arts. 1º a 9º de TODAS as leis:**
`scripts/chunk_laws.py` e `lib/chunker.js` reconheciam o início de um artigo
só quando havia um ponto logo após o número (ex.: "Art. 10."). Só que a
convenção de redação legislativa brasileira NÃO usa ponto para os artigos de
1º a 9º (ex.: "Art. 1º", sem ponto) — só a partir do Art. 10 em diante. Isso
fazia com que os Arts. 1º a 9º de EC 132/2023, LC 214/2025 e LC 227/2026
NUNCA fossem reconhecidos como início de artigo e ficassem de fora do índice
de busca desde o início do projeto — incluindo dispositivos centrais, como os
artigos que definem a incidência do IBS/CBS (art. 4º) e o que não incide
(art. 6º) da LC 214/2025. O ponto agora é opcional nesse regex (exige só que
venha um espaço/quebra de linha depois do número). `sources/decreto_12955.txt`
foi adicionado com o mesmo processo dos demais (`LAW_FILES` em
`chunk_laws.py`, `SOURCE_TO_FILE` em `build_index.js`, e uma dica de menção
("Decreto 12.955") em `lib/retrieval.js`, no mesmo padrão de LC/EC).
`data/chunks_leis_reforma_tributaria.json` já foi regenerado com as duas
mudanças (leis + Decreto + DeRE). **Mas, como sempre, os embeddings em
`data/index_*.json` ainda são os antigos — é preciso rodar
`node scripts/build_index.js` de novo (com sua `OPENAI_API_KEY`) para as duas
correções valerem no site**, e dessa vez isso regenera TODOS os
`data/index_*.json` das leis (não só o do Decreto novo), já que o conteúdo de
EC 132/2023, LC 214/2025 e LC 227/2026 também mudou (ganharam os Arts. 1º-9º
que faltavam).

**Efeito colateral encontrado ao corrigir o bug acima:** a limitação abaixo
("trechos de outras leis citados dentro das disposições finais") ficou mais
visível para artigos de número baixo (1 a 9), porque esses trechos citados de
OUTRAS leis também costumam começar do "Art. 1º" e também não tinham ponto —
ou seja, a mesma correção que resgatou os Arts. 1º-9º verdadeiros também
resgatou colisões que antes ficavam escondidas pelo mesmo bug (ex.: hoje
"Art. 1º, LC 214/2025" tem 3 trechos diferentes indexados sob a mesma
referência, sendo só o primeiro o de verdade). Isso não piora a precisão das
respostas para artigos de número mais alto, só aumenta um pouco o ruído
especificamente para perguntas sobre um artigo de 1 a 9 pelo número — ver
detalhes na limitação abaixo.

Limitação conhecida, ainda não corrigida: nas "disposições finais" da
LC 214/2025 e da LC 227/2026 (a parte que altera OUTRAS leis, como o Código
Tributário Nacional ou a lei do Simples Nacional), alguns trechos dessas
outras leis acabam indexados com a referência "LC 214/2025" ou "LC 227/2026",
por reaproveitarem a mesma numeração de artigo. Isso pode ocasionalmente
trazer um trecho irrelevante na busca (ex.: perguntar sobre "art. 26" ou
"art. 33" da LC 214/2025 pode trazer, além do trecho certo, um trecho de outra
lei sendo alterada por ela) — e, desde a correção de 05/ago acima, isso vale
com uma chance maior para artigos de número baixo (1 a 9) especificamente.
Resolver isso direito exige distinguir com segurança quando um artigo altera
a própria LC 214/2025 (caso em que o trecho deveria ficar) de quando altera
uma lei totalmente diferente (caso em que deveria ser descartado ou marcado
à parte) — ainda não implementado.

Se no futuro sair uma nova lei ou regulamentação, adicione o texto extraído
dela em `sources/`, ajuste `LAW_FILES` em `scripts/chunk_laws.py`, rode
`python3 scripts/chunk_laws.py` e depois `node scripts/build_index.js` para
atualizar os blocos e o índice.

Se, em vez disso, for um novo documento técnico no mesmo estilo da DeRE
(tabelas de código, regras de validação, seções numeradas — não Art./§),
adicione o texto extraído em `sources/` (nome `dere_algumacoisa.txt`),
acrescente uma entrada em `DERE_FILES` no topo de `scripts/chunk_dere.py`
indicando qual das 4 estratégias de divisão usar (`"erros"`, `"regras"`,
`"tabela"` ou `"secoes"`), rode `python3 scripts/chunk_dere.py` e depois
`node scripts/build_index.js`.

## Publicar na Vercel (grátis)

1. **Crie uma conta** em [vercel.com](https://vercel.com) (pode usar login do GitHub).
2. **Suba esta pasta para um repositório no GitHub**:
   - Crie um repositório novo (ex.: `chatbot-reforma-tributaria`) em github.com.
   - No terminal, dentro desta pasta:
     ```
     git init
     git add .
     git commit -m "Chatbot reforma tributária"
     git branch -M main
     git remote add origin https://github.com/SEU-USUARIO/chatbot-reforma-tributaria.git
     git push -u origin main
     ```
3. **Importe o repositório na Vercel**:
   - No painel da Vercel, clique em "Add New… > Project".
   - Selecione o repositório que você acabou de criar.
   - Não precisa mudar nenhuma configuração de build (é um projeto estático + funções serverless).
4. **Configure a chave da API antes do primeiro deploy** (ou logo depois):
   - Em "Environment Variables", adicione:
     - `OPENAI_API_KEY` = sua chave da OpenAI (crie em [platform.openai.com/api-keys](https://platform.openai.com/api-keys))
     - `OPENAI_MODEL` (opcional) = por exemplo `gpt-5.6-terra` ou `gpt-5.6-luna` (mais barato). Veja os modelos disponíveis na sua conta em platform.openai.com/docs/models.
5. **Deploy**. A Vercel te dará uma URL pública, tipo `https://chatbot-reforma-tributaria.vercel.app` — é esse link que você compartilha com outras pessoas.
6. Se depois você mudar a variável de ambiente, é preciso fazer um **novo deploy** (Vercel > Deployments > "Redeploy") para ela ter efeito.

### Alternativa sem GitHub (Vercel CLI)

Se preferir não usar GitHub, dá para publicar direto do computador:

```
npm install -g vercel
cd chatbot-reforma-tributaria
vercel login
vercel --prod
```

A CLI vai perguntar sobre configurar o projeto (aceite os padrões) e, depois,
peça para configurar a variável `OPENAI_API_KEY` quando solicitado (ou defina
depois em vercel.com > seu projeto > Settings > Environment Variables e rode
`vercel --prod` novamente).

## Testar localmente antes de publicar (opcional)

```
npm install -g vercel
vercel dev
```

Isso sobe uma versão local em `http://localhost:3000` simulando o ambiente da
Vercel (lê o arquivo `.env`, que você deve criar a partir do `.env.example`).

## Atualizando o conteúdo

Sempre que sair uma nova lei ou regulamentação (ex.: novas leis complementares
do CG-IBS), edite `lib/kb.js` — adicione um novo item ao array `KB` com
`tema`, `titulo`, `conteudo` e `fonte`. Não é necessário mexer no frontend.

## Busca ao vivo no Google durante o chat

Além do texto das leis, cada pergunta feita à RITA também busca no Google (via
`lib/google_search.js` > `searchWeb()`, chamado em `api/chat.js`), trazendo até
`WEB_SEARCH_RESULTS` resultados (padrão: 4) como contexto complementar —
notícias, discussões práticas, aplicações reais do tema — que não está e nunca
vai estar no texto puro da lei.

Isso usa as **mesmas** variáveis `GOOGLE_API_KEY` e `GOOGLE_CSE_ID` da seção
abaixo (atualização automática) — se você já configurou essas duas variáveis,
essa busca ao vivo já funciona sozinha, sem nenhum passo extra. Se ainda não
configurou, o chat continua funcionando normalmente, só sem esse contexto
extra (a busca é sempre opcional/best-effort — se falhar ou não estiver
configurada, a resposta segue só com o texto das leis).

Os resultados da web são claramente rotulados nas instruções do modelo como
"RESULTADOS_DA_WEB" e as regras deixam explícito que isso NÃO é texto legal —
a RITA foi instruída a nunca citar um resultado da web como se fosse um artigo
de lei, e a sempre priorizar o texto legal em caso de conflito. Mesmo assim,
como qualquer busca na web pode trazer conteúdo impreciso ou desatualizado,
vale acompanhar as respostas de vez em quando para confirmar que esse contexto
extra está sendo usado com o cuidado esperado.

## Atualização automática da base (via Google Search API)

Além da atualização manual acima, o projeto tem um pipeline opcional que roda
sozinho, todo dia, sem você precisar subir arquivo nenhum: ele busca no Google
por publicações novas sobre a Reforma Tributária, baixa o texto, divide em
blocos, gera os embeddings e publica no índice — a RITA passa a usar esse
conteúdo na próxima pergunta, sem precisar de um novo deploy.

**Aviso importante**: esse pipeline publica o que encontra **sem revisão sua
antes** (foi a opção escolhida para este projeto). Isso quer dizer que, se a
busca do Google trouxer algo que não é realmente uma norma oficial (uma
notícia especulativa, um rascunho de projeto de lei que ainda pode mudar), a
RITA pode acabar usando esse conteúdo como se fosse texto legal definitivo.
Para conteúdo jurídico voltado ao público, o mais seguro em geral é ter
alguém revisando antes de publicar — se preferir mudar para esse modelo mais
tarde, me avise que eu ajusto o pipeline para só notificar em vez de publicar
direto. Enquanto isso, use o changelog (explicado abaixo) para auditar de vez
em quando o que entrou na base.

### Como configurar

1. **Vercel Blob** (onde o índice automático fica guardado — só assim uma
   função da Vercel consegue "lembrar" o que já indexou entre uma execução e
   outra, já que ela não pode escrever de volta no seu repositório do GitHub):
   - No painel da Vercel, vá no seu projeto > aba "Storage" > "Create Database" > escolha "Blob".
   - Confirme a criação e conecte esse Blob Store ao projeto do chatbot.
   - A autenticação é automática (OIDC) — a Vercel injeta sozinha o que for
     necessário; não precisa copiar nenhum token manualmente para o site
     publicado. **Importante:** isso exige `@vercel/blob` na versão `2.x`
     (já é a versão usada no `package.json` deste projeto) — versões antigas
     do pacote não sabiam usar OIDC e exigiam configurar
     `BLOB_READ_WRITE_TOKEN` manualmente.

2. **Google Custom Search API** (a busca por novidades):
   - Acesse [console.cloud.google.com](https://console.cloud.google.com), crie um projeto (ou use um existente).
   - Vá em "APIs e serviços" > "Biblioteca", procure "Custom Search API" e clique em "Ativar".
   - Em "Credenciais", clique "Criar credenciais" > "Chave de API" — essa é a `GOOGLE_API_KEY`.
   - Acesse [programmablesearchengine.google.com](https://programmablesearchengine.google.com/), crie um novo mecanismo de busca.
     - Pode configurar para buscar em sites específicos (recomendado, para focar em fontes oficiais): `planalto.gov.br`, `in.gov.br`, `camara.leg.br`, `senado.leg.br`, `gov.br`.
     - Ou deixar buscar na "Web inteira" — nesse caso as consultas em `lib/google_search.js` já são bem específicas (incluem `site:` nos termos), mas o risco de trazer algo irrelevante é maior.
   - Copie o "ID do mecanismo de pesquisa" (Search engine ID) — essa é a `GOOGLE_CSE_ID`.
   - A cota gratuita é de 100 buscas/dia; o pipeline usa 5 consultas por execução — bem dentro do limite rodando 1x por dia.

3. **Configure as variáveis na Vercel** (Settings > Environment Variables):
   - `GOOGLE_API_KEY`
   - `GOOGLE_CSE_ID`
   - `CRON_SECRET` — invente uma senha longa e aleatória (protege o endpoint contra chamadas externas não autorizadas)
   - `OPENAI_API_KEY` já deve estar configurada (é a mesma usada pelo chat)

4. **Faça um novo deploy** para essas variáveis e o `vercel.json` (que já configura o agendamento) entrarem em vigor.

5. Pronto — a partir daí, o job roda automaticamente todo dia às 6h (horário UTC; ajuste em `vercel.json` se quiser outro horário, usando a mesma sintaxe de cron do Linux). Você pode disparar manualmente antes de esperar o horário, visitando (no navegador ou com `curl`) `https://seu-site.vercel.app/api/cron/check-updates` com o cabeçalho `Authorization: Bearer SEU_CRON_SECRET`.

**Nota sobre o plano da Vercel**: o plano gratuito (Hobby) permite no máximo uma execução de cron por dia — é exatamente o que está configurado aqui. Planos pagos permitem execuções mais frequentes, se um dia você quiser checar com mais frequência.

### Auditar o que foi adicionado

Acesse `https://seu-site.vercel.app/api/changelog` no navegador — mostra a
data, o título e a URL de cada documento que o pipeline adicionou
automaticamente, e quantos blocos cada um gerou. É a forma de conferir depois
o que entrou na base, já que não há aprovação antes de publicar.

## Registro de acessos (quem fez login)

Ao preencher nome/cargo/empresa na barra lateral, além de salvar localmente
no navegador (para lembrar quem é a pessoa na próxima visita), o site também
envia esse registro para o servidor — assim você consegue ver quem acessou o
chat.

### Como configurar

1. Escolha uma senha (só pra você) e configure a variável de ambiente
   `ACCESS_LOG_SECRET` na Vercel (Settings > Environment Variables), com
   redeploy depois. Sem essa variável, a página de consulta fica desativada.
2. Isso também precisa do Blob Store conectado ao projeto (o mesmo usado pela
   atualização automática — veja a seção acima). Sem o Blob configurado, o
   login continua funcionando normalmente, só que
   nenhum registro fica guardado no servidor.

### Como consultar

Acesse, no navegador:
```
https://seu-site.vercel.app/api/access-log?chave=SUA_SENHA
```
(trocando `SUA_SENHA` pela senha que você configurou em `ACCESS_LOG_SECRET`)

Isso mostra uma tabela com nome, cargo, empresa e data/hora de cada login,
do mais recente para o mais antigo.

**Importante:** isso não é um controle de acesso — qualquer pessoa com o
link do site consegue usar a RITA e/ou preencher qualquer nome no login
(não há verificação de identidade). É só um registro informativo de quem
disse que é quem, e quando.

## Limitações deste protótipo

- Não há autenticação real — o "login" na barra lateral não verifica senha
  nem identidade; qualquer pessoa pode preencher qualquer nome. O que é
  preenchido fica salvo localmente no navegador da pessoa e (se configurado)
  registrado no servidor — veja "Registro de acessos" acima.
- O conteúdo adicionado pela atualização automática (se ativada) não passa por
  revisão humana antes de publicar — veja o aviso na seção acima. Desde a
  correção de 31/jul, esse conteúdo é marcado internamente como
  `auto_web_nao_revisado` e nunca entra no mesmo bloco do prompt que os
  TRECHOS_LEGAIS_RELEVANTES oficiais (leis + DeRE): ele aparece separado, como
  "CONTEUDO_AUTOMATICO_NAO_REVISADO", com instrução explícita para o modelo
  nunca citá-lo como texto legal e sempre priorizar a lei/DeRE em caso de
  divergência. Isso evita que uma notícia ou rascunho encontrado
  automaticamente seja citado como se fosse a lei, e reduz respostas
  divergentes para a mesma pergunta conforme o índice automático muda com o
  tempo.
- Histórico de conversas salvo no navegador (localStorage) — some se a pessoa
  limpar os dados do navegador ou trocar de dispositivo.

## Login opcional e limite de perguntas (global, por navegador)

O login (nome, cargo e empresa, na barra lateral) é **opcional** — dá pra
conversar com a RITA sem preencher nada. Quem loga só ajuda a identificar a
conversa e aparece no registro de acessos (veja "Registro de acessos" acima);
não é uma trava de acesso, e nunca teve senha nem verificação de identidade.

Cada navegador tem no máximo **4 perguntas no TOTAL**, logado ou não — e esse
número **não reseta** ao criar uma nova conversa. Antes o limite era "4
perguntas por conversa" (dava pra criar uma conversa nova e ganhar mais 4);
agora é um limite único e permanente por navegador: ao atingir a 4ª pergunta,
o campo de texto e o botão "Criar uma nova conversa" ficam desabilitados em
definitivo — a pessoa só consegue continuar lendo o histórico das conversas
já existentes, sem fazer perguntas novas. A pesquisa de perfil (ver abaixo) é
independente desse limite — ela acontece uma vez só, antes de qualquer
pergunta.

- **Onde é controlado**: o contador fica em `localStorage`
  (`rita_perguntas_totais_global`, em `index.html`) e é enviado a cada
  pergunta para o servidor (`api/chat.js`, variável `MAX_PERGUNTAS_POR_SESSAO`)
  como uma segunda checagem — a mesma limitação de sempre se aplica: como não
  há login/conta obrigatório, alguém que limpe os dados do navegador reseta o
  contador. É o mesmo nível de proteção que a pesquisa de perfil já tinha.
- **Para mudar o número de perguntas**: se só ajustar a variável de ambiente
  na Vercel, o servidor passa a aceitar o novo limite, mas o frontend continua
  mostrando o aviso com "4" — edite também a constante
  `MAX_PERGUNTAS_POR_SESSAO` dentro do `<script>` do `index.html` para os dois
  ficarem sincronizados.

## Pesquisa de perfil (8 perguntas no chat, obrigatória antes de conversar)

Assim que a pessoa abre o site, **antes de poder fazer qualquer pergunta**, a
RITA conduz — dentro do próprio chat, uma pergunta de cada vez, na mesma
caixa de texto — 8 perguntas sobre o nível de conhecimento, otimismo e
percepções da pessoa sobre a Reforma Tributária (nível de conhecimento, nível
de otimismo, elemento que gostaria de se aprofundar, principal desafio,
principal elemento de incerteza, se a Reforma Tributária vai simplificar o
ambiente de negócios, familiaridade com Regime Geral/Específico, e efeitos de
reprecificação). Perguntas com opções fechadas (Baixo/Médio/Alto,
Sim/Não, etc.) aparecem como botões clicáveis abaixo da pergunta, além de
aceitar resposta digitada.

(As 3 perguntas técnicas sobre Nota Fiscal em bancos, dedução de sinistros por
seguradoras e sujeição de sub-adquirentes/meios de pagamento à DeRE foram
removidas do questionário.)

**A pesquisa é anônima por padrão** — não pergunta nome, cargo nem empresa.
O login (opcional, na barra lateral) é um recurso totalmente separado; se a
pessoa já tiver feito login antes de responder a pesquisa, nome/cargo/empresa
são anexados automaticamente às respostas enviadas ao servidor, sem perguntar
de novo.

É obrigatório terminar a pesquisa para liberar o chat — o menu lateral (nova
conversa, trocar de conversa, excluir) e a caixa de pergunta ficam
bloqueados até ela terminar. Depois de respondida uma vez, fica marcada em
`localStorage` (`rita_survey_v3`) e não é pedida de novo no mesmo navegador.

**Onde ficam as respostas**: gravadas no Vercel Blob (mesmo Store do registro
de acessos) via `POST /api/survey`. Para consultar, acesse:
```
https://seu-site.vercel.app/api/survey-log?chave=SUA_SENHA
```
(mesma senha de `ACCESS_LOG_SECRET`, usada em "Registro de acessos" acima) —
a página tem filtro por empresa (para quem respondeu logado) e um botão para
baixar tudo como `.xlsx`.

**Gerador de dashboard (dentro da própria página `/api/survey-log`):** cada
linha da tabela tem uma caixinha de seleção (todas vêm marcadas por padrão, e
o filtro de empresa é só um facilitador de busca — não interfere na seleção).
Depois de marcar as respostas desejadas, o botão **"Gerar dashboard"** monta,
na hora e sem sair da página, o mesmo estilo de dashboard usado nos relatórios
em PDF: KPIs, gráfico de nível de conhecimento vs. otimismo, gráfico de
percepções técnicas (Sim/Não/Depende — só aparece se alguma resposta
selecionada tiver esses campos preenchidos), gráfico de pizza dos temas que
mais querem se aprofundar, e nuvens de palavras de "Desafios" e "Incertezas"
(cada nuvem trata a resposta inteira da célula como uma frase única — só
conta como repetida se o texto for exatamente igual, sem separar em palavras
soltas). Tudo com as cores oficiais da PwC e a marca "RiT@". Um botão
**"Baixar dashboard como PDF"** gera o PDF (usa bibliotecas carregadas via
internet — Chart.js, WordCloud2, html2canvas e jsPDF; se a internet cair no
meio, a página avisa com uma mensagem clara em vez de travar). O restante da
página — filtro, tabela, exportar Excel — continua funcionando normalmente
mesmo se o gerador de dashboard não conseguir carregar essas bibliotecas.

**Limitação conhecida:** o progresso da pesquisa não é salvo se a página for
recarregada no meio — só a conclusão final é persistida. Se a pessoa atualizar
a página no meio das 8 perguntas, a RITA recomeça do início na próxima vez
que a página carregar.
