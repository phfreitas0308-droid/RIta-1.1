# Chatbot – Reforma Tributária

Chatbot que responde dúvidas sobre a Reforma Tributária brasileira (IBS, CBS,
Imposto Seletivo, cronograma de transição, alíquotas e split payment), com
base na EC 132/2023, LC 214/2025 e LC 227/2026.

## Como funciona

- `index.html` — frontend estático (chat), sem nenhuma chave de API exposta.
- `api/chat.js` — função serverless que recebe a pergunta do navegador e
  chama a API da OpenAI **no servidor**, mantendo sua chave protegida.
- `lib/kb.js` — resumo curado da legislação (usado como rede de segurança
  enquanto o índice de busca abaixo não existir).
- `data/chunks_leis_reforma_tributaria.json` — os textos da EC 132/2023, LC
  214/2025, LC 227/2026 e do glossário, já divididos em blocos por artigo/
  parágrafo, cada um com sua referência exata (ex.: `"Art. 32, LC 214/2025"`).
- `scripts/build_index.js` — script que você roda **uma vez, no seu
  computador**, para transformar esses blocos em um índice de busca (embeddings).
- `lib/retrieval.js` — no servidor, a cada pergunta, busca os trechos mais
  parecidos com a pergunta dentro desse índice e os envia ao modelo, no lugar
  do resumo fixo — assim a resposta pode citar o artigo exato em vez de um
  resumo genérico.
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
5. O script vai demorar alguns minutos (são ~3.200 blocos) e vai custar poucos
   centavos de dólar na sua conta OpenAI. Ao final, ele cria os arquivos:
   - `data/index_ec132.json`
   - `data/index_lc214.json`
   - `data/index_lc227.json`
   - `data/index_glossario.json`
6. Suba esses 4 arquivos novos para o mesmo repositório do GitHub (mesma pasta
   `data/`), do mesmo jeito que você já fez com o `index.html` — a Vercel
   refaz o deploy sozinha.
7. A partir daí, toda pergunta passa a buscar automaticamente nos textos
   completos das leis, citando o artigo exato.

Se no futuro sair uma nova lei ou regulamentação, adicione o texto dela ao
processo de chunking e rode `scripts/build_index.js` de novo para atualizar
o índice.

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

## Limitações deste protótipo

- Não há autenticação real — o "login" na barra lateral é só local, salvo no
  navegador da pessoa, sem verificação de senha no servidor.
- O índice de busca (RAG) precisa ser gerado manualmente (passo acima) e
  atualizado sempre que sair uma nova lei — não é automático ainda.
- Histórico de conversas salvo no navegador (localStorage) — some se a pessoa
  limpar os dados do navegador ou trocar de dispositivo.

## Limite de perguntas por sessão

Cada conversa aceita no máximo **4 perguntas**. Ao atingir o limite, o campo de
pergunta é bloqueado e aparece um aviso convidando a pessoa a iniciar uma nova
conversa (o histórico da conversa anterior continua salvo na barra lateral).

- **Onde é controlado**: no servidor, em `api/chat.js` (constante
  `MAX_PERGUNTAS_POR_SESSAO`, configurável também pela variável de ambiente
  `MAX_PERGUNTAS_POR_SESSAO` na Vercel) — é a barreira que realmente impede
  gastos além do previsto, mesmo que alguém chame a API diretamente sem passar
  pelo site. E também no frontend, em `index.html` (mesma constante, no
  `<script>`), só para mostrar o aviso e desabilitar o campo antes de gastar
  uma chamada à API à toa.
- **Para mudar o número**: se só ajustar a variável de ambiente na Vercel, o
  servidor passa a aceitar o novo limite, mas o frontend continua mostrando o
  aviso com "4" — edite também a constante `MAX_PERGUNTAS_POR_SESSAO` dentro do
  `<script>` do `index.html` para os dois ficarem sincronizados.
