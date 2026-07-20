// Configuração compartilhada entre scripts/build_index.js (indexação, roda uma vez
// no seu computador) e lib/retrieval.js (busca, roda a cada pergunta no servidor).
// Os dois PRECISAM usar o mesmo modelo e a mesma quantidade de dimensões — se você
// mudar aqui, rode novamente scripts/build_index.js antes de publicar.

module.exports = {
  EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: Number(process.env.OPENAI_EMBEDDING_DIMENSIONS || 512),
  TOP_K: Number(process.env.RAG_TOP_K || 8),
};
