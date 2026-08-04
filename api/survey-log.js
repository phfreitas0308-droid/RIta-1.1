// Página só-leitura para você conferir as respostas da pesquisa de perfil que
// a RITA faz no próprio chat quando o visitante atinge o limite de perguntas.
// Usa a MESMA senha do registro de acessos (ACCESS_LOG_SECRET). Acesse:
//   https://seu-site.vercel.app/api/survey-log?chave=SUA_SENHA

const { blobConfigured, getSurveyResponses } = require("../lib/blob_store");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(bodyHtml, extraHeadHtml = "") {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>RITA — Pesquisa de perfil</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #F5F1EA; color: #2A2620; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p.sub { color: #7A6F63; margin-top: 0; font-size: 13px; }
  a.voltar { font-size: 12.5px; color: #7A6F63; }
  table { border-collapse: collapse; width: 100%; margin-top: 20px; background: #fff; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #E4DDD1; font-size: 13px; vertical-align: top; }
  th { background: #2A2620; color: #fff; position: sticky; top: 0; }
  tr:hover td { background: #F9F6F0; }
  .filters { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 18px; align-items: flex-end; }
  .filters button { font-size: 13px; padding: 7px 14px; border-radius: 6px; border: 1px solid #D9D2C4; background: #fff; cursor: pointer; }
  .filters button:hover { background: #F0EAE0; }
  .table-scroll { overflow-x: auto; }
  .col-resposta { min-width: 220px; max-width: 340px; white-space: pre-wrap; }
</style>
${extraHeadHtml}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// Colunas exibidas, na mesma ordem em que a RITA pergunta no chat.
const COLUNAS = [
  { key: "dataHora", label: "Data/hora" },
  { key: "nome", label: "Nome" },
  { key: "cargo", label: "Cargo" },
  { key: "empresa", label: "Empresa" },
  { key: "nivelConhecimento", label: "Nível de conhecimento" },
  { key: "duvidas", label: "Principais dúvidas" },
  { key: "aprofundar", label: "Quer se aprofundar em" },
  { key: "desafio", label: "Principal desafio" },
  { key: "projetos", label: "Já trabalhou em projetos?" },
  { key: "regimeEspecificoGeral", label: "Familiaridade Regime Específico/Geral" },
  { key: "creditamento", label: "Familiaridade creditamento CBS/IBS" },
  { key: "frequenciaConsulta", label: "Frequência de consulta à legislação" },
];

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const secret = process.env.ACCESS_LOG_SECRET;
  if (!secret) {
    return res.status(501).send(renderPage(
      "<h1>Pesquisa de perfil desativada</h1><p class='sub'>Configure a variável de ambiente <code>ACCESS_LOG_SECRET</code> na Vercel (Settings &gt; Environment Variables) com uma senha à sua escolha, redeploy, e acesse de novo esta página com <code>?chave=SUA_SENHA</code> no final do endereço.</p>"
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
      "<h1>Nenhuma resposta ainda</h1><p class='sub'>O Blob Store não está conectado a este projeto — crie um Blob Store na Vercel (aba Storage) e conecte ao projeto para começar a registrar as respostas.</p>"
    ));
  }

  const respostas = await getSurveyResponses();

  const fmtData = (e) =>
    e.dataHora ? new Date(e.dataHora).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-";

  const linkVoltar = `<p><a class="voltar" href="/api/access-log?chave=${encodeURIComponent(chave)}">← Ver registro de acessos</a></p>`;

  const rows = respostas
    .map((e) => {
      const cells = COLUNAS.map((c) => {
        const valor = c.key === "dataHora" ? fmtData(e) : e[c.key];
        const cls = c.key === "dataHora" || c.key === "nome" || c.key === "cargo" || c.key === "empresa" ? "" : " class=\"col-resposta\"";
        return `<td${cls}>${escapeHtml(valor)}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");

  const body = `
    <h1>RITA — Pesquisa de perfil</h1>
    <p class="sub" id="contagem">${respostas.length} resposta${respostas.length === 1 ? "" : "s"} registrada${respostas.length === 1 ? "" : "s"} (mais recente primeiro).</p>
    ${linkVoltar}

    <div class="filters">
      <button id="baixarExcel">Baixar como Excel (.xlsx)</button>
    </div>

    <div class="table-scroll">
      <table>
        <thead><tr>${COLUNAS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
        <tbody id="corpoTabela">${rows || `<tr><td colspan='${COLUNAS.length}'>Nenhuma resposta registrada ainda.</td></tr>`}</tbody>
      </table>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <script>
      document.getElementById('baixarExcel').addEventListener('click', () => {
        const cabecalho = ${JSON.stringify(COLUNAS.map((c) => c.label)).replace(/</g, "\\u003c")};
        const linhas = Array.from(document.querySelectorAll('#corpoTabela tr')).map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => td.textContent)
        );

        const planilha = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]);
        planilha['!cols'] = cabecalho.map(() => ({ wch: 26 }));
        const pasta = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(pasta, planilha, 'Pesquisa de perfil');

        const agora = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(pasta, 'pesquisa-perfil-rita-' + agora + '.xlsx');
      });
    </script>
  `;

  return res.status(200).send(renderPage(body));
};
