// Função serverless (Vercel) que recebe a pergunta do usuário no frontend
// e chama a API da OpenAI, mantendo a chave de API protegida no servidor.
//
// Variáveis de ambiente necessárias (configure no painel da Vercel):
//   OPENAI_API_KEY  - sua chave da API da OpenAI (platform.openai.com)
//   OPENAI_MODEL    - opcional. Padrão: "gpt-5.6-terra"
//                     (use "gpt-5.6-luna" para reduzir custo, ou o modelo
//                     mais recente disponível na sua conta — confira em
//                     https://platform.openai.com/docs/models)
//
// Busca (RAG): se os arquivos data/index_*.json existirem (gerados por
// scripts/build_index.js), cada pergunta busca os trechos de lei mais
// relevantes por similaridade de embeddings e os injeta no prompt, com a
// referência exata (ex.: "Art. 32, LC 214/2025"). Se esses arquivos ainda não
// existirem, cai de volta no resumo fixo curado em lib/kb.js — então nada
// quebra antes de você rodar a indexação.
//
// Raciocínio mais profundo: antes de buscar/responder, uma chamada rápida
// (lib/analyze.js) classifica a pergunta. Se for ambígua, o chatbot pede
// esclarecimento em vez de responder. Se for complexa (cruza vários temas),
// ela é decomposta em sub-perguntas — cada uma gera sua própria busca — e a
// resposta final usa um nível mais alto de reasoning_effort.

const { retrieve, retrieveMulti, hasIndex } = require("../lib/retrieval");
const { analyzeQuestion, FALLBACK_ANALYSIS } = require("../lib/analyze");
const { SYSTEM_INSTRUCTIONS: FALLBACK_INSTRUCTIONS } = require("../lib/kb");
const { searchWeb } = require("../lib/google_search");

const OPENAI_URL = "https://api.openai.com/v1/responses";
const WEB_SEARCH_RESULTS = Number(process.env.WEB_SEARCH_RESULTS || 4);

const BASE_RULES = `Você é RITA, assistente especializada em tirar dúvidas sobre a Reforma Tributária brasileira (EC 132/2023, LC 214/2025 e LC 227/2026).

Regras obrigatórias:
1. Use os TRECHOS_LEGAIS_RELEVANTES abaixo como sua fonte de verdade para qualquer citação de lei/artigo. Para perguntas que cruzam mais de um tema (ex.: split payment + crédito presumido + marketplace), é esperado e desejado que você COMBINE e INTERPRETE vários trechos diferentes para construir uma resposta — isso não é proibido, é o objetivo. Deixe claro no texto o que é citação literal da lei e o que é interpretação/síntese sua a partir dela (ex.: "Combinando o art. X, que trata de Y, com o art. Z, que trata de W, é possível entender que...").
2. Quando a lei usar uma definição genérica (ex.: "arranjos de pagamento", "prestadores de serviço de pagamento eletrônico") que tecnicamente cobre um caso concreto não citado nominalmente (ex.: Pix, boleto, cartão), você pode aplicar essa definição ao caso e explicar o raciocínio — não é preciso que a lei mencione o termo exato para você responder.
3. Só diga que a base não cobre a pergunta se, mesmo combinando e interpretando os trechos fornecidos E os RESULTADOS_DA_WEB (quando houver), não houver nenhum conteúdo minimamente relacionado. Não recuse apenas porque não existe uma única frase que responda tudo de forma literal e direta.
4. RESULTADOS_DA_WEB (se presentes) são resultados de busca no Google — contexto complementar sobre notícias, discussões práticas ou aplicações reais do tema, e NÃO são texto legal. Nunca cite um resultado da web como se fosse um artigo de lei, nunca escreva algo como "(Art. X, LC 214/2025)" baseado só em um resultado da web. Use-os apenas para enriquecer a resposta com contexto atual/prático, e deixe claro quando a informação vier da web em vez da lei (ex.: "Segundo reportagens recentes, ..."). Se algum resultado da web contradisser o texto da lei, prevaleça sempre o texto legal.
5. Responda em português do Brasil, de forma clara, objetiva e sem jargão desnecessário.
6. Sempre que usar uma informação legal, cite a referência exata entre parênteses (ex.: "Art. 32, LC 214/2025"). Sempre que usar uma informação de um RESULTADO_DA_WEB, mencione a fonte (ex.: "segundo [título/veículo]").
7. Ao final da resposta, adicione uma linha "Fonte:" listando as referências legais usadas e, se tiver usado algum resultado da web, uma linha separada "Fonte adicional (web):" listando título e link.
8. Não dê conselho jurídico ou contábil definitivo — deixe claro quando estiver interpretando/inferindo, em vez de citando a lei literalmente.
9. Se a pergunta for sobre algo fora do tema (reforma tributária), diga educadamente que só responde sobre esse assunto.`;

module.exports = async function handler(req, res) {
  // CORS básico (ajuste allowed origin se for embutir em outro domínio)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido. Use POST." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY não configurada no servidor. Defina essa variável de ambiente no painel da Vercel e faça um novo deploy.",
    });
  }

  const { question, history } = req.body || {};
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Campo 'question' é obrigatório." });
  }

  // ---------- Limite de perguntas por sessão/conversa ----------
  // Protege contra custo descontrolado de API: cada conversa (definida pelo
  // frontend) pode fazer no máximo MAX_PERGUNTAS_POR_SESSAO perguntas.
  // Verificado no servidor (não só no frontend) para não depender só do
  // JavaScript do navegador — alguém não pode simplesmente ignorar o limite
  // chamando a API diretamente.
  const MAX_PERGUNTAS_POR_SESSAO = Number(process.env.MAX_PERGUNTAS_POR_SESSAO || 4);
  const perguntasAnteriores = Array.isArray(history)
    ? history.filter((h) => h && h.role === "user").length
    : 0;
  if (perguntasAnteriores >= MAX_PERGUNTAS_POR_SESSAO) {
    return res.status(403).json({
      error: `Você atingiu o limite de ${MAX_PERGUNTAS_POR_SESSAO} perguntas nesta conversa. Inicie uma nova conversa para continuar.`,
      meta: { tipo: "limite_atingido" },
    });
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";

  // Monta o histórico recente da conversa (até 6 últimas mensagens) para dar contexto.
  const historyText = Array.isArray(history)
    ? history
        .slice(-6)
        .map((h) => (h.role === "user" ? "Usuário: " : "Assistente: ") + h.text)
        .join("\n")
    : "";

  const userInput =
    (historyText ? "Histórico recente da conversa:\n" + historyText + "\n\n" : "") +
    "Pergunta atual do usuário: " +
    question;

  // Query usada para a BUSCA (RAG) — diferente do userInput acima, que vai para
  // o modelo principal. Quando o usuário responde a um pedido de esclarecimento
  // com uma frase curta (ex.: pergunta "explique o art. 193", RITA responde
  // perguntando "de qual lei?", usuário responde só "da LC 214"), a mensagem
  // atual sozinha ("da LC 214") não tem quase nenhum conteúdo para a busca por
  // embeddings encontrar o trecho certo — o número do artigo só existe na
  // pergunta anterior. Por isso, a busca combina a pergunta atual com a última
  // pergunta do usuário no histórico (quando forem diferentes), garantindo que
  // sinais como "artigo 193" não se percam nesse tipo de troca.
  const previousUserQuestions = Array.isArray(history)
    ? history.filter((h) => h && h.role === "user").map((h) => h.text)
    : [];
  const lastUserQuestion = previousUserQuestions[previousUserQuestions.length - 1];
  const searchQuery =
    lastUserQuestion && lastUserQuestion.trim() !== question.trim()
      ? `${lastUserQuestion}\n${question}`
      : question;

  // ---------- Etapa 1: analisar a pergunta (ambígua? complexa?) ----------
  let analysis = FALLBACK_ANALYSIS;
  try {
    analysis = await analyzeQuestion(apiKey, question, historyText);
  } catch (err) {
    console.error("Erro na análise da pergunta:", err);
    // segue com o padrão (não ambígua, não complexa) — nunca trava o chat por causa disso
  }

  // Pergunta ambígua: pede esclarecimento em vez de responder, sem gastar com busca/modelo principal.
  if (analysis.ambigua && analysis.pergunta_esclarecimento) {
    return res.status(200).json({
      answer: analysis.pergunta_esclarecimento,
      meta: { tipo: "esclarecimento" },
    });
  }

  // ---------- Etapa 2: busca (simples ou decomposta em sub-perguntas) ----------
  let instructions;
  let retrieved = [];
  const reasoningEffort = analysis.complexa ? "high" : "low";

  try {
    if (await hasIndex()) {
      if (analysis.complexa && analysis.subperguntas.length > 0) {
        retrieved = await retrieveMulti(apiKey, [searchQuery, ...analysis.subperguntas], 8, 20);
      } else {
        retrieved = await retrieve(apiKey, searchQuery);
      }
      const trechos = retrieved
        .map((r) => `[${r.referencia}]\n${r.texto}`)
        .join("\n\n---\n\n");
      const subperguntasBlock =
        analysis.complexa && analysis.subperguntas.length > 0
          ? "\n\nEsta pergunta foi identificada como complexa e decomposta nas seguintes sub-perguntas para orientar sua análise:\n" +
            analysis.subperguntas.map((s) => `- ${s}`).join("\n")
          : "";
      instructions =
        BASE_RULES +
        subperguntasBlock +
        "\n\nTRECHOS_LEGAIS_RELEVANTES (recuperados por busca semântica para esta pergunta):\n" +
        (trechos || "(nenhum trecho relevante encontrado)");
    } else {
      // Índice ainda não gerado — usa o resumo fixo curado como antes.
      instructions = FALLBACK_INSTRUCTIONS;
    }
  } catch (err) {
    console.error("Erro na busca (retrieval):", err);
    // Se a busca falhar (ex.: erro de rede na API de embeddings), não derruba o
    // chat inteiro — cai para o resumo fixo como rede de segurança.
    instructions = FALLBACK_INSTRUCTIONS;
  }

  // ---------- Etapa 2.5: busca ao vivo no Google (contexto complementar) ----------
  // Além do texto das leis, cada pergunta também busca no Google (mesma API/CSE
  // usada pela atualização automática) para trazer contexto atual/prático sobre
  // a Reforma Tributária — notícias, discussões, aplicações reais — que não
  // está e nunca vai estar no texto da lei em si. Opcional: só roda se
  // GOOGLE_API_KEY e GOOGLE_CSE_ID estiverem configurados; se a busca falhar
  // por qualquer motivo, a resposta segue normalmente só com os trechos legais.
  const googleKey = process.env.GOOGLE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  let webResults = [];
  if (googleKey && cseId) {
    try {
      webResults = await searchWeb(googleKey, cseId, searchQuery, { num: WEB_SEARCH_RESULTS });
      if (webResults.length > 0) {
        const webBlock = webResults
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nLink: ${r.link}`)
          .join("\n\n");
        instructions += "\n\nRESULTADOS_DA_WEB (busca no Google, contexto complementar — NÃO é texto legal):\n" + webBlock;
      }
    } catch (err) {
      console.error("Erro na busca ao vivo no Google:", err);
      // segue sem contexto da web — nunca trava o chat por causa disso
    }
  }

  // ---------- Etapa 3: resposta principal, com reasoning_effort conforme a complexidade ----------
  try {
    const openaiRes = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions,
        input: userInput,
        reasoning: { effort: reasoningEffort },
      }),
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      console.error("Erro da API da OpenAI:", data);
      return res.status(openaiRes.status).json({
        error: (data && data.error && data.error.message) || "Erro ao consultar a OpenAI.",
      });
    }

    const answer = extractText(data);
    return res.status(200).json({
      answer,
      meta: {
        tipo: "resposta",
        complexa: analysis.complexa,
        subperguntas: analysis.subperguntas,
        reasoning_effort: reasoningEffort,
        trechos_usados: retrieved.map((r) => r.referencia),
        fontes_web: webResults.map((r) => ({ title: r.title, link: r.link })),
      },
    });
  } catch (err) {
    console.error("Erro ao chamar a OpenAI:", err);
    return res.status(500).json({ error: "Falha ao consultar o modelo de IA. Tente novamente." });
  }
};

// A API Responses da OpenAI pode retornar o texto em formatos ligeiramente
// diferentes dependendo do SDK/versão. Esta função tenta os formatos mais
// comuns antes de desistir.
function extractText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }
  if (Array.isArray(data.output)) {
    const parts = [];
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const c of item.content) {
          if (typeof c.text === "string") parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join("\n");
  }
  // Fallback: formato antigo de Chat Completions, caso a conta ainda use esse endpoint.
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content || "";
  }
  return "Não foi possível interpretar a resposta do modelo.";
}
