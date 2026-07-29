// Página só-leitura para você conferir quem fez login na RITA (nome, cargo,
// empresa e data/hora). Acesse:
//   https://seu-site.vercel.app/api/access-log?chave=SUA_SENHA
// trocando SUA_SENHA pelo valor que você configurou em ACCESS_LOG_SECRET
// (Vercel > Settings > Environment Variables). Sem essa senha configurada,
// o endpoint fica desativado (para não expor nomes/empresas publicamente).

const { blobConfigured, getAccessLog } = require("../lib/blob_store");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>RITA — Registro de acessos</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #F5F1EA; color: #2A2620; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p.sub { color: #7A6F63; margin-top: 0; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; margin-top: 20px; background: #fff; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #E4DDD1; font-size: 13px; }
  th { background: #2A2620; color: #fff; }
  tr:hover td { background: #F9F6F0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const secret = process.env.ACCESS_LOG_SECRET;
  if (!secret) {
    return res.status(501).send(renderPage(
      "<h1>Registro de acessos desativado</h1><p class='sub'>Configure a variável de ambiente <code>ACCESS_LOG_SECRET</code> na Vercel (Settings &gt; Environment Variables) com uma senha à sua escolha, redeploy, e acesse de novo esta página com <code>?chave=SUA_SENHA</code> no final do endereço.</p>"
    ));
  }

  const chave = req.query && req.query.chave;
  if (chave !== secret) {
    return res.status(401).send(renderPage(
      "<h1>Acesso negado</h1><p class='sub'>Acesse com <code>?chave=SUA_SENHA</code> no final do endereço, usando a senha configurada em ACCESS_LOG_SECRET.</p>"
    ));
  }

  if (!blobConfigured()) {
    return res.status(200).send(renderPage(
      "<h1>Nenhum registro ainda</h1><p class='sub'>O Blob Store não está configurado (BLOB_READ_WRITE_TOKEN ausente) — crie um Blob Store na Vercel e conecte ao projeto para começar a registrar os acessos.</p>"
    ));
  }

  const log = await getAccessLog();

  const rows = log
    .map((e) => {
      const data = e.dataHora ? new Date(e.dataHora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-";
      return `<tr><td>${escapeHtml(data)}</td><td>${escapeHtml(e.nome)}</td><td>${escapeHtml(e.cargo)}</td><td>${escapeHtml(e.empresa)}</td></tr>`;
    })
    .join("\n");

  const body = `
    <h1>RITA — Registro de acessos</h1>
    <p class="sub">${log.length} login${log.length === 1 ? "" : "s"} registrado${log.length === 1 ? "" : "s"} (mais recente primeiro).</p>
    <table>
      <thead><tr><th>Data/hora</th><th>Nome</th><th>Cargo</th><th>Empresa</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='4'>Nenhum login registrado ainda.</td></tr>"}</tbody>
    </table>
  `;

  return res.status(200).send(renderPage(body));
};
