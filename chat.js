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

const OPENAI_URL = "https://api.openai.com/v1/responses";

const BASE_RULES = `Você é RITA, assistente especializada em tirar dúvidas sobre a Reforma Tributária brasileira (EC 132/2023, LC 214/2025 e LC 227/2026).

Regras obrigatórias:
1. Use os TRECHOS_LEGAIS_RELEVANTES abaixo como sua fonte de verdade. Para perguntas que cruzam mais de um tema (ex.: split payment + crédito presumido + marketplace), é esperado e desejado que você COMBINE e INTERPRETE vários trechos diferentes para construir uma resposta — isso não é proibido, é o objetivo. Deixe claro no texto o que é citação literal da lei e o que é interpretação/síntese sua a partir dela (ex.: "Combinando o art. X, que trata de Y, com o art. Z, que trata de W, é possível entender que...").
2. Quando a lei usar uma definição genérica (ex.: "arranjos de pagamento", "prestadores de serviço de pagamento eletrônico") que tecnicamente cobre um caso concreto não citado nominalmente (ex.: Pix, boleto, cartão), você pode aplicar essa definição ao caso e explicar o raciocínio — não é preciso que a lei mencione o termo exato para você responder.
3. Só diga que a base não cobre a pergunta se, mesmo combinando e interpretando os trechos fornecidos, não houver nenhum conteúdo minimamente relacionado. Não recuse apenas porque não existe uma única frase que responda tudo de forma literal e direta.
4. Responda em português do Brasil, de forma clara, objetiva e sem jargão desnecessário.
5. Sempre que usar uma informação, cite a referência exata entre parênteses (ex.: "Art. 32, LC 214/2025").
6. Ao final da resposta, adicione uma linha separada começando com "Fonte:" listando as referências usadas.
7. Não dê conselho jurídico ou contábil definitivo — deixe claro quando estiver interpretando/inferindo, em vez de citando a lei literalmente.
8. Se a pergunta for sobre algo fora do tema (reforma tributária), diga educadamente que só responde sobre esse assunto.`;

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
    if (hasIndex()) {
      if (analysis.complexa && analysis.subperguntas.length > 0) {
        retrieved = await retrieveMulti(apiKey, [question, ...analysis.subperguntas], 8, 20);
      } else {
        retrieved = await retrieve(apiKey, question);
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
