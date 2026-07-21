// Etapa de análise da pergunta, executada ANTES da busca e da resposta principal.
//
// Faz uma chamada rápida e barata a um modelo da OpenAI pedindo para classificar
// a pergunta em três eixos:
//   1) ambigua           -> a pergunta depende de informação que só o usuário tem
//                           (ex.: regime tributário da empresa, tipo de operação)
//                           e por isso é melhor perguntar antes de responder.
//   2) complexa          -> a pergunta cruza mais de um tema/regra da reforma e
//                           por isso vale a pena: (a) decompor em sub-perguntas
//                           antes de buscar, e (b) usar mais esforço de raciocínio
//                           na resposta final.
//   3) subperguntas       -> as sub-perguntas identificadas (se complexa).
//
// Se essa etapa falhar por qualquer motivo (erro de rede, JSON malformado etc.),
// api/chat.js cai no caminho "simples" — a pergunta segue direto para a busca e
// resposta normais, sem travar o chat.

const ANALYZER_MODEL = process.env.ANALYZER_MODEL || "gpt-5.6-luna";
const OPENAI_URL = "https://api.openai.com/v1/responses";

const ANALYZER_INSTRUCTIONS = `Você é um classificador de perguntas para um assistente sobre a Reforma Tributária brasileira (EC 132/2023, LC 214/2025, LC 227/2026).

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, exatamente neste formato:
{"ambigua": boolean, "pergunta_esclarecimento": string ou null, "complexa": boolean, "subperguntas": [string, ...]}

Regras:
- "ambigua" = true SOMENTE se a pergunta for genuinamente impossível de responder bem sem uma informação que só o usuário tem (ex.: o regime tributário específico da empresa dele, o tipo exato de operação, se ele é ou não contribuinte do regime regular). Perguntas conceituais gerais (ex.: "o que é o IBS", "como funciona o split payment") NUNCA são ambíguas, mesmo que amplas.
- Se "ambigua" for true: preencha "pergunta_esclarecimento" com UMA pergunta curta, direta e educada para o usuário responder antes de você continuar. Nesse caso "complexa" deve ser false e "subperguntas" um array vazio.
- "complexa" = true se, para responder bem, for necessário cruzar mais de um tema/regra distintos da reforma (ex.: uma pergunta que envolve split payment aplicado a marketplace com crédito presumido, ou o efeito combinado do cronograma de transição sobre um regime diferenciado específico).
- Se "complexa" for true: preencha "subperguntas" com 2 a 4 perguntas menores, objetivas, em português, cada uma cobrindo um sub-tema que ajuda a responder a pergunta original.
- Se "complexa" for false: "subperguntas" deve ser um array vazio.
- Nunca escreva nada fora do JSON. Nunca use blocos de código markdown.`;

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function extractText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
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
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content || "";
  }
  return "";
}

const FALLBACK_ANALYSIS = { ambigua: false, pergunta_esclarecimento: null, complexa: false, subperguntas: [] };

async function analyzeQuestion(apiKey, question, historyText) {
  const input =
    (historyText ? "Histórico recente da conversa:\n" + historyText + "\n\n" : "") +
    "Pergunta a classificar: " +
    question;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ANALYZER_MODEL,
      instructions: ANALYZER_INSTRUCTIONS,
      input,
      reasoning: { effort: "low" },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error("Erro da API de análise: " + JSON.stringify(data));
  }

  const raw = stripCodeFences(extractText(data));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("Falha ao interpretar JSON da análise:", raw);
    return FALLBACK_ANALYSIS;
  }

  return {
    ambigua: Boolean(parsed.ambigua),
    pergunta_esclarecimento: typeof parsed.pergunta_esclarecimento === "string" ? parsed.pergunta_esclarecimento : null,
    complexa: Boolean(parsed.complexa),
    subperguntas: Array.isArray(parsed.subperguntas) ? parsed.subperguntas.filter((s) => typeof s === "string" && s.trim()) : [],
  };
}

module.exports = { analyzeQuestion, FALLBACK_ANALYSIS };
