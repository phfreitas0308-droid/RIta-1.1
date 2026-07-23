// Cliente compartilhado para a API de embeddings da OpenAI — usado tanto por
// scripts/build_index.js (rodado manualmente por você) quanto por
// api/cron/check-updates.js (rodado automaticamente pela Vercel Cron).

const { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } = require("./embedding_config");

async function embedBatch(apiKey, texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error("Erro da API de embeddings: " + JSON.stringify(data));
  }
  // A API preserva a ordem de entrada em data.data[i].embedding
  return data.data.map((d) => d.embedding);
}

module.exports = { embedBatch };
