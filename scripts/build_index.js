// Gera o índice vetorial (embeddings) a partir de data/chunks_leis_reforma_tributaria.json.
//
// COMO RODAR (uma única vez, no seu computador — não roda na Vercel):
//   1. cd reforma-tributaria-chatbot
//   2. Crie um arquivo .env (copie de .env.example) com sua OPENAI_API_KEY
//   3. node --env-file=.env scripts/build_index.js
//      (se seu Node for mais antigo e não aceitar --env-file, exporte a variável
//       manualmente antes: export OPENAI_API_KEY=sk-...   e rode "node scripts/build_index.js")
//
// O script chama a API de embeddings da OpenAI para cada bloco de lei/parágrafo e
// grava os resultados em data/index_*.json — um arquivo por fonte, para cada um
// ficar bem abaixo do limite de 25MB do upload pela interface do GitHub.
//
// Custo aproximado: poucos centavos de dólar para o volume atual (~3.200 blocos).

const fs = require("fs");
const path = require("path");
const { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } = require("../lib/embedding_config");
const { embedBatch } = require("../lib/embeddings_client");

const BATCH_SIZE = 100;

const CHUNKS_PATH = path.join(__dirname, "..", "data", "chunks_leis_reforma_tributaria.json");
const OUT_DIR = path.join(__dirname, "..", "data");

const SOURCE_TO_FILE = {
  "EC 132/2023": "index_ec132.json",
  "LC 214/2025": "index_lc214.json",
  "LC 227/2026": "index_lc227.json",
  "Glossário da Reforma Tributária": "index_glossario.json",
};

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Defina OPENAI_API_KEY antes de rodar este script (veja o topo do arquivo).");
    process.exit(1);
  }

  const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, "utf-8"));
  console.log(`Lidos ${chunks.length} blocos de ${CHUNKS_PATH}`);
  console.log(`Modelo: ${EMBEDDING_MODEL} | Dimensões: ${EMBEDDING_DIMENSIONS}`);

  const bySource = {};
  for (const c of chunks) {
    if (!bySource[c.lei]) bySource[c.lei] = [];
    bySource[c.lei].push(c);
  }

  for (const [lei, list] of Object.entries(bySource)) {
    const outPath = path.join(OUT_DIR, SOURCE_TO_FILE[lei] || `index_${lei.replace(/[^a-z0-9]/gi, "_")}.json`);
    const result = [];

    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.texto.slice(0, 6000)); // limite de segurança por item
      const embeddings = await embedBatch(apiKey, texts);

      for (let j = 0; j < batch.length; j++) {
        result.push({
          referencia: batch[j].referencia,
          lei: batch[j].lei,
          artigo: batch[j].artigo,
          paragrafo: batch[j].paragrafo,
          texto: batch[j].texto,
          embedding: embeddings[j].map(round4),
        });
      }
      console.log(`  [${lei}] ${Math.min(i + BATCH_SIZE, list.length)}/${list.length}`);
    }

    fs.writeFileSync(outPath, JSON.stringify(result));
    const sizeMB = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
    console.log(`Gravado ${outPath} (${sizeMB} MB)`);
  }

  console.log("\nConcluído. Suba os arquivos data/index_*.json junto com o resto do projeto para o GitHub.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
