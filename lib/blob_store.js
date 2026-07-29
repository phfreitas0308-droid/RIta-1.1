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
// Se o Blob Store não estiver criado/conectado ao projeto na Vercel, todas as
// funções aqui viram no-op — o chatbot continua funcionando normalmente com
// só o índice local. A autenticação com o Blob é automática (OIDC) quando o
// Store está conectado — não precisa configurar nenhum token manualmente
// (veja blobConfigured() logo abaixo).

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
  // A Vercel tem 2 jeitos de autenticar no Blob: o token estático clássico
  // (BLOB_READ_WRITE_TOKEN) ou, no modelo mais novo (OIDC — o padrão hoje ao
  // conectar um Blob Store pela aba Storage), a dupla BLOB_STORE_ID +
  // VERCEL_OIDC_TOKEN (esse último é injetado automaticamente pela Vercel a
  // cada execução, sem precisar configurar nada manualmente). O SDK
  // @vercel/blob já sabe usar OIDC sozinho quando BLOB_STORE_ID existe —
  // por isso não exigimos mais só o BLOB_READ_WRITE_TOKEN aqui.
  const hasStaticToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const hasOidc = Boolean(process.env.BLOB_STORE_ID);
  return (hasStaticToken || hasOidc) && Boolean(getBlobLib());
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

// ---------------------------------------------------------------
// Registro de acessos (login): quem entrou no chat (nome/cargo/empresa) e
// quando. Guardado no mesmo Blob Store dos índices automáticos — se o Blob
// não estiver configurado, o login continua funcionando normalmente
// (localmente, no navegador), só não fica nenhum registro no servidor.
// ---------------------------------------------------------------
const ACCESS_LOG_PATH = "access-log.json";
const ACCESS_LOG_MAX = 2000;

async function appendAccessLog(entry) {
  if (!blobConfigured()) return;
  const log = (await fetchJsonBlob(ACCESS_LOG_PATH)) || [];
  log.unshift(entry); // mais recente primeiro
  await putJsonBlob(ACCESS_LOG_PATH, log.slice(0, ACCESS_LOG_MAX));
}

async function getAccessLog() {
  if (!blobConfigured()) return [];
  return (await fetchJsonBlob(ACCESS_LOG_PATH)) || [];
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
  appendAccessLog,
  getAccessLog,
};
