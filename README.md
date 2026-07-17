# Chatbot – Reforma Tributária

Chatbot que responde dúvidas sobre a Reforma Tributária brasileira (IBS, CBS,
Imposto Seletivo, cronograma de transição, alíquotas e split payment), com
base na EC 132/2023, LC 214/2025 e LC 227/2026.

## Como funciona

- `index.html` — frontend estático (chat), sem nenhuma chave de API exposta.
- `api/chat.js` — função serverless que recebe a pergunta do navegador e
  chama a API da OpenAI **no servidor**, mantendo sua chave protegida.
- `lib/kb.js` — base de conhecimento curada (resumo da legislação) e as
  instruções que orientam a IA a responder só com base nesse conteúdo,
  citando o artigo/lei correspondente.

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

- Não há autenticação — qualquer pessoa com o link acessa o chat.
- A base de conhecimento é um resumo curado, não os textos legais completos
  na íntegra (para reduzir custo de tokens). Para uma versão mais robusta,
  considere migrar para uma arquitetura RAG com busca vetorial sobre os
  textos completos das leis.
- Não há limite de uso por usuário — em produção real, considere adicionar
  um limite de requisições (rate limiting) para controlar custo da API.
- Sem histórico persistido: a conversa é perdida ao recarregar a página.
