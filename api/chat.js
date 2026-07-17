// Função serverless (Vercel) que recebe a pergunta do usuário no frontend
// e chama a API da OpenAI, mantendo a chave de API protegida no servidor.
//
// Variáveis de ambiente necessárias (configure no painel da Vercel):
//   OPENAI_API_KEY  - sua chave da API da OpenAI (platform.openai.com)
//   OPENAI_MODEL    - opcional. Padrão: "gpt-5.6-terra"
//                     (use "gpt-5.6-luna" para reduzir custo, ou o modelo
//                     mais recente disponível na sua conta — confira em
//                     https://platform.openai.com/docs/models)

const { SYSTEM_INSTRUCTIONS } = require("../lib/kb");

const OPENAI_URL = "https://api.openai.com/v1/responses";

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

  try {
    const openaiRes = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions: SYSTEM_INSTRUCTIONS,
        input: userInput,
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
    return res.status(200).json({ answer });
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
