// Página só-leitura para você conferir quem fez login na RITA (nome, cargo,
// empresa e data/hora), com filtros por nome/cargo/empresa. Acesse:
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

// Serializa com segurança para dentro de uma tag <script> (evita que um nome
// como "</script><script>" quebre a página).
function toScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function renderPage(bodyHtml, extraHeadHtml = "") {
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
  .filters { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 18px; align-items: flex-end; }
  .filters label { display: flex; flex-direction: column; font-size: 12px; color: #7A6F63; gap: 4px; }
  .filters select { font-size: 13px; padding: 6px 8px; border-radius: 6px; border: 1px solid #D9D2C4; background: #fff; min-width: 180px; }
  .filters button { font-size: 13px; padding: 7px 14px; border-radius: 6px; border: 1px solid #D9D2C4; background: #fff; cursor: pointer; }
  .filters button:hover { background: #F0EAE0; }
  tr.oculta { display: none; }
</style>
${extraHeadHtml}
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
      "<h1>Nenhum registro ainda</h1><p class='sub'>O Blob Store não está conectado a este projeto — crie um Blob Store na Vercel (aba Storage) e conecte ao projeto para começar a registrar os acessos.</p>"
    ));
  }

  const log = await getAccessLog();

  const fmtData = (e) =>
    e.dataHora ? new Date(e.dataHora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-";

  const rows = log
    .map((e) => {
      const data = fmtData(e);
      return (
        `<tr data-nome="${escapeHtml(e.nome)}" data-cargo="${escapeHtml(e.cargo)}" data-empresa="${escapeHtml(e.empresa)}">` +
        `<td>${escapeHtml(data)}</td><td>${escapeHtml(e.nome)}</td><td>${escapeHtml(e.cargo)}</td><td>${escapeHtml(e.empresa)}</td></tr>`
      );
    })
    .join("\n");

  // Listas de valores únicos para popular os filtros (ordenadas, sem vazios).
  const uniqueSorted = (field) =>
    Array.from(new Set(log.map((e) => (e[field] || "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "pt-BR")
    );

  const options = (values) =>
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

  const body = `
    <h1>RITA — Registro de acessos</h1>
    <p class="sub" id="contagem">${log.length} login${log.length === 1 ? "" : "s"} registrado${log.length === 1 ? "" : "s"} (mais recente primeiro).</p>

    <div class="filters">
      <label>Nome
        <select id="filtroNome"><option value="">Todos</option>${options(uniqueSorted("nome"))}</select>
      </label>
      <label>Cargo
        <select id="filtroCargo"><option value="">Todos</option>${options(uniqueSorted("cargo"))}</select>
      </label>
      <label>Empresa
        <select id="filtroEmpresa"><option value="">Todos</option>${options(uniqueSorted("empresa"))}</select>
      </label>
      <button id="limparFiltros">Limpar filtros</button>
    </div>

    <table>
      <thead><tr><th>Data/hora</th><th>Nome</th><th>Cargo</th><th>Empresa</th></tr></thead>
      <tbody id="corpoTabela">${rows || "<tr><td colspan='4'>Nenhum login registrado ainda.</td></tr>"}</tbody>
    </table>

    <script>
      const totalLogins = ${toScriptJson(log.length)};
      const filtroNome = document.getElementById('filtroNome');
      const filtroCargo = document.getElementById('filtroCargo');
      const filtroEmpresa = document.getElementById('filtroEmpresa');
      const contagemEl = document.getElementById('contagem');
      const linhas = Array.from(document.querySelectorAll('#corpoTabela tr[data-nome]'));

      function aplicarFiltros() {
        const nome = filtroNome.value;
        const cargo = filtroCargo.value;
        const empresa = filtroEmpresa.value;
        let visiveis = 0;
        linhas.forEach((tr) => {
          const bate =
            (!nome || tr.dataset.nome === nome) &&
            (!cargo || tr.dataset.cargo === cargo) &&
            (!empresa || tr.dataset.empresa === empresa);
          tr.classList.toggle('oculta', !bate);
          if (bate) visiveis++;
        });
        contagemEl.textContent = (nome || cargo || empresa)
          ? visiveis + ' de ' + totalLogins + ' login(s) — filtro aplicado'
          : totalLogins + ' login(s) registrado(s) (mais recente primeiro).';
      }

      [filtroNome, filtroCargo, filtroEmpresa].forEach((el) => el.addEventListener('change', aplicarFiltros));
      document.getElementById('limparFiltros').addEventListener('click', () => {
        filtroNome.value = '';
        filtroCargo.value = '';
        filtroEmpresa.value = '';
        aplicarFiltros();
      });
    </script>
  `;

  return res.status(200).send(renderPage(body));
};
