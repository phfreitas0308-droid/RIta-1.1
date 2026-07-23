// Armazenamento do índice gerado AUTOMATICAMENTE (pelo pipeline de busca do
// Google + extração + chunking + embeddings) no Vercel Blob.
//
// Por quê Blob e não arquivos em data/*.json como o índice manual? Porque uma
// função serverless da Vercel não consegue "commitar" um arquivo de volta pro
// repositório do GitHub — qualquer coisa que ela escrever no disco local some
// assim que a execução termina. O Vercel Blob é um espaço de armazenamento
// simples (tipo um HD na nuvem) que tanto o cron job (escreve) quanto o chat
// (lê) conseguem acessar em tempo real, sem precisar de um novo deploy.
//
// Estrutura guardada no Blob:
//   auto-index/manifest.json        -> lista de documentos já indexados + URLs já vistas
//   auto-index/docs/<slug>.json     -> os blocos (com embedding) de cada documento
//   auto-index/changelog.json       -> histórico legível do que foi adicionado e quando
//
// Se BLOB_READ_WRITE_TOKEN não estiver configurado (Blob Store não criado/
// conectado ao projeto na Vercel), todas as funções aqui viram no-op — o
// chatbot continua funcionando normalmente com só o índice local.

let blobLib = null;
function getBlobLib() {
  if (blobLib === null) {
    try {
      blobLib = require("@vercel/blob");
    } catch (err) {
      blobLib = false; // pacote não instalado — trata como "não configurado"
    }
  }
  return blobLib || null;
}

function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN) && Boolean(getBlobLib());
}

const MANIFEST_PATH = "auto-index/manifest.json";
const CHANGELOG_PATH = "auto-index/changelog.json";

async function fetchJsonBlob(pathname) {
  const { list } = getBlobLib();
  const { blobs } = await list({ prefix: pathname });
  const match = blobs.find((b) => b.pathname === pathname);
  if (!match) return null;
  const res = await fetch(match.url, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function putJsonBlob(pathname, data) {
  const { put } = getBlobLib();
  await put(pathname, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function getManifest() {
  if (!blobConfigured()) return { documentos: [], seenUrls: [], lastRunAt: null };
  const manifest = await fetchJsonBlob(MANIFEST_PATH);
  return manifest || { documentos: [], seenUrls: [], lastRunAt: null };
}

async function saveManifest(manifest) {
  if (!blobConfigured()) return;
  await putJsonBlob(MANIFEST_PATH, manifest);
}

async function getDocumentChunks(slug) {
  if (!blobConfigured()) return [];
  return (await fetchJsonBlob(`auto-index/docs/${slug}.json`)) || [];
}

async function saveDocumentChunks(slug, chunksComEmbedding) {
  if (!blobConfigured()) return;
  await putJsonBlob(`auto-index/docs/${slug}.json`, chunksComEmbedding);
}

// Junta os blocos (com embedding) de todos os documentos já indexados
// automaticamente — é isso que lib/retrieval.js soma ao índice local.
async function getAutoIndexBundle() {
  if (!blobConfigured()) return [];
  const manifest = await getManifest();
  const docs = manifest.documentos || [];
  if (docs.length === 0) return [];

  const chunksPorDocumento = await Promise.all(
    docs.map((doc) => getDocumentChunks(doc.slug).catch(() => []))
  );
  return chunksPorDocumento.flat();
}

async function appendChangelog(entry) {
  if (!blobConfigured()) return;
  const changelog = (await fetchJsonBlob(CHANGELOG_PATH)) || [];
  changelog.unshift(entry); // mais recente primeiro
  await putJsonBlob(CHANGELOG_PATH, changelog.slice(0, 300));
}

async function getChangelog() {
  if (!blobConfigured()) return [];
  return (await fetchJsonBlob(CHANGELOG_PATH)) || [];
}

module.exports = {
  blobConfigured,
  getManifest,
  saveManifest,
  getDocumentChunks,
  saveDocumentChunks,
  getAutoIndexBundle,
  appendChangelog,
  getChangelog,
};
