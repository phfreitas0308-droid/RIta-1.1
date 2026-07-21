// Busca por similaridade (RAG) sobre os índices gerados por scripts/build_index.js.
//
// Carrega todos os arquivos data/index_*.json uma única vez (no "cold start" da
// função serverless) e, a cada pergunta, embute a pergunta do usuário e calcula a
// similaridade de cosseno contra cada bloco indexado, devolvendo os top-k mais
// relevantes — cada um já com sua referência exata (ex.: "Art. 32, LC 214/2025").

const fs = require("fs");
const path = require("path");
const { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, TOP_K } = require("./embedding_config");

const DATA_DIR = path.join(__dirname, "..", "data");

let INDEX = null; // carregado sob demanda, cacheado entre invocações "quentes"

function loadIndex() {
  if (INDEX !== null) return INDEX;

  INDEX = [];
  if (!fs.existsSync(DATA_DIR)) return INDEX;

  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith("index_") && f.endsWith(".json"));
  for (const file of files) {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
      INDEX.push(...content);
    } catch (err) {
      console.error(`Falha ao carregar ${file}:`, err.message);
    }
  }
  return INDEX;
}

function hasIndex() {
  return loadIndex().length > 0;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------
// Busca híbrida: embeddings sozinhos às vezes não priorizam bem termos
// técnicos/nomeados específicos (ex.: "crédito presumido", "marketplace").
// Aqui somamos um pequeno reforço de pontuação para blocos que contêm
// literalmente as palavras-chave da pergunta, além da similaridade semântica.
// ---------------------------------------------------------------
const STOPWORDS = new Set([
  "para", "como", "quando", "onde", "esse", "essa", "isso", "esta", "este",
  "estas", "estes", "aquele", "aquela", "sobre", "entre", "pela", "pelo",
  "pelas", "pelos", "pode", "podem", "sera", "serao", "sao", "das", "dos",
  "que", "com", "uma", "umas", "uns", "por", "sua", "seus", "suas", "qual",
  "quais", "muito", "mais", "menos", "tambem", "ainda", "apos", "antes",
  "durante", "cada", "algum", "alguma", "algumas", "alguns", "outro",
  "outra", "outras", "outros", "todo", "toda", "todas", "todos",
]);

function stripAccents(str) {
  return str.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function extractKeywords(text) {
  const normalized = stripAccents(text.toLowerCase()).replace(/[^a-z0-9\s]/g, " ");
  const words = normalized.split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

function keywordOverlapScore(text, keywords) {
  if (!keywords.length) return 0;
  const normalized = stripAccents(text.toLowerCase());
  let matches = 0;
  for (const kw of keywords) {
    if (normalized.includes(kw)) matches++;
  }
  return matches / keywords.length;
}

const KEYWORD_BOOST_WEIGHT = 0.2;

async function embedQuery(apiKey, text) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [text],
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error("Erro da API de embeddings: " + JSON.stringify(data));
  }
  return data.data[0].embedding;
}

// Retorna os top-k blocos mais relevantes para a pergunta, ou [] se ainda não
// houver índice gerado (nesse caso, api/chat.js cai de volta no resumo fixo antigo).
// Combina similaridade semântica (embeddings) com um reforço por palavras-chave
// literais da pergunta — isso ajuda a achar termos técnicos/nomeados específicos
// (ex.: "crédito presumido", "marketplace") que o embedding sozinho às vezes
// não prioriza o suficiente.
async function retrieve(apiKey, question, k = TOP_K) {
  const index = loadIndex();
  if (index.length === 0) return [];

  const queryEmbedding = await embedQuery(apiKey, question);
  const keywords = extractKeywords(question);

  const scored = index.map((item) => {
    const cos = cosineSimilarity(queryEmbedding, item.embedding);
    const kw = keywordOverlapScore(item.texto, keywords);
    return { item, score: cos + KEYWORD_BOOST_WEIGHT * kw };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k).map((s) => ({
    referencia: s.item.referencia,
    texto: s.item.texto,
    score: Math.round(s.score * 1000) / 1000,
  }));
}

// Busca com várias perguntas de uma vez (usada quando a pergunta original foi
// decomposta em sub-perguntas por lib/analyze.js). Roda uma busca para cada
// pergunta, junta os resultados, remove duplicatas (mesma referência) mantendo
// a maior pontuação, e devolve os "maxTotal" melhores no total.
async function retrieveMulti(apiKey, questions, kEach = 5, maxTotal = 12) {
  const index = loadIndex();
  if (index.length === 0) return [];

  const resultsPerQuestion = await Promise.all(
    questions.map((q) => retrieve(apiKey, q, kEach).catch(() => []))
  );

  const byReferencia = new Map();
  for (const list of resultsPerQuestion) {
    for (const item of list) {
      const existing = byReferencia.get(item.referencia);
      if (!existing || item.score > existing.score) {
        byReferencia.set(item.referencia, item);
      }
    }
  }

  return Array.from(byReferencia.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTotal);
}

module.exports = { retrieve, retrieveMulti, hasIndex };
