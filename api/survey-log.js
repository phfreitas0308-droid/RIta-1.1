// Página só-leitura para você conferir as respostas da pesquisa de perfil que
// a RITA faz no próprio chat, obrigatoriamente, ANTES de liberar a conversa.
// Usa a MESMA senha do registro de acessos (ACCESS_LOG_SECRET). Acesse:
//   https://seu-site.vercel.app/api/survey-log?chave=SUA_SENHA
// Nome/cargo/empresa costumam vir vazios (a pesquisa é anônima por padrão) —
// só aparecem preenchidos quando a pessoa também fez login pela barra lateral.
//
// Além da tabela e do export em Excel, esta página tem um gerador de
// dashboard: marque quais respostas quer incluir (coluna "Incluir", à
// esquerda da tabela — vêm todas marcadas por padrão) e clique em "Gerar
// dashboard" para montar, na hora, no navegador, os gráficos e nuvens de
// palavras só com as respostas selecionadas. Dá pra baixar o resultado como
// PDF de uma página. Tudo roda no seu navegador (Chart.js + wordcloud2.js +
// html2canvas + jsPDF, via CDN) — nada disso é enviado a lugar nenhum.

const { blobConfigured, getSurveyResponses } = require("../lib/blob_store");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Serializa com segurança para dentro de uma tag <script> (evita que um valor
// como "</script><script>" quebre a página).
function toScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
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
  th.col-chk, td.col-chk { width: 34px; text-align: center; padding-left: 6px; padding-right: 6px; }
  .filters { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 18px; align-items: flex-end; }
  .filters label { display: flex; flex-direction: column; font-size: 12px; color: #7A6F63; gap: 4px; }
  .filters select { font-size: 13px; padding: 6px 8px; border-radius: 6px; border: 1px solid #D9D2C4; background: #fff; min-width: 180px; }
  .filters button { font-size: 13px; padding: 7px 14px; border-radius: 6px; border: 1px solid #D9D2C4; background: #fff; cursor: pointer; }
  .filters button:hover { background: #F0EAE0; }
  .filters button.principal { background: #AD1B02; color: #fff; border-color: #AD1B02; font-weight: 600; }
  .filters button.principal:hover { background: #8f1602; }
  .dica-selecao { font-size: 12px; color: #A69C8E; margin: 6px 0 0; }
  .table-scroll { overflow-x: auto; }
  .col-resposta { min-width: 220px; max-width: 340px; white-space: pre-wrap; }
  tr.oculta { display: none; }

  .dash-section { margin-top: 30px; background: #fff; border-radius: 12px; padding: 22px 26px; }
  .dash-section h2 { font-size: 18px; margin: 0 0 2px; }
  .dash-section p.dash-sub { color: #7A6F63; font-size: 12.5px; margin: 0 0 18px; }
  .dash-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 22px; }
  .dash-kpi { background: #FBF9F4; border-radius: 8px; padding: 12px 14px; }
  .dash-kpi .lbl { font-size: 12px; color: #7A6F63; display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .dash-kpi .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dash-kpi .val { font-size: 22px; font-weight: 700; }
  .dash-card { margin-bottom: 26px; }
  .dash-card h3 { font-size: 14.5px; margin: 0 0 10px; font-weight: 700; }
  .dash-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 10px; font-size: 12.5px; color: #7A6F63; }
  .dash-legend .sq { width: 10px; height: 10px; border-radius: 2px; display: inline-block; margin-right: 5px; vertical-align: -1px; }
  .dash-chart-wrap { position: relative; width: 100%; }
  .dash-wc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .dash-wc-row canvas { width: 100% !important; height: auto !important; background: #fff; }
  .dash-actions { display: flex; gap: 10px; margin-top: 4px; }
  #dashboardSection { display: none; }
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
  { key: "nivelConhecimento", label: "Nível de conhecimento sobre a Reforma Tributária" },
  { key: "nivelOtimismo", label: "Nível de otimismo sobre a Reforma Tributária" },
  { key: "elementoAprofundar", label: "Elemento que quer se aprofundar" },
  { key: "principalDesafio", label: "Principal desafio" },
  { key: "elementoIncerteza", label: "Principal elemento de incerteza" },
  { key: "simplificaAmbienteNegocios", label: "Reforma Tributária simplifica o ambiente de negócios?" },
  { key: "familiaridadeRegimes", label: "Familiarizado com Regime Geral/Específico?" },
  { key: "efeitosReprecificacao", label: "Identifica efeitos de reprecificação?" },
  // Perguntas antigas (removidas do questionário atual, mas respostas
  // anteriores no Blob ainda podem ter esses campos preenchidos) — inclusas
  // aqui só para o dashboard conseguir usá-las quando existirem.
  { key: "bancoNotaFiscal", label: "Banco emitirá Nota Fiscal?" },
  { key: "seguradoraDeducaoSinistros", label: "Seguradora deduzirá sinistros?" },
  { key: "subadquirentesDeRE", label: "Sub-adquirentes sujeitas à DeRE?" },
];

// Colunas efetivamente mostradas na tabela (as antigas ficam de fora da
// tabela por padrão, pra não confundir quem nunca respondeu elas — mas
// continuam disponíveis nos dados brutos pro dashboard usar se existirem).
const COLUNAS_TABELA = COLUNAS.filter(
  (c) => !["bancoNotaFiscal", "seguradoraDeducaoSinistros", "subadquirentesDeRE"].includes(c.key)
);

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
    .map((e, i) => {
      const cells = COLUNAS_TABELA.map((c) => {
        const valor = c.key === "dataHora" ? fmtData(e) : e[c.key];
        const cls = c.key === "dataHora" || c.key === "nome" || c.key === "cargo" || c.key === "empresa" ? "" : " class=\"col-resposta\"";
        return `<td${cls}>${escapeHtml(valor)}</td>`;
      }).join("");
      return `<tr data-empresa="${escapeHtml((e.empresa || "").trim())}" data-index="${i}"><td class="col-chk"><input type="checkbox" class="chk-linha" data-index="${i}" checked></td>${cells}</tr>`;
    })
    .join("\n");

  // Lista de empresas únicas (ordenada, sem vazios) para popular o filtro.
  const empresasUnicas = Array.from(
    new Set(respostas.map((e) => (e.empresa || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const opcoesEmpresa = empresasUnicas
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
    .join("");

  // Dados brutos normalizados (mesma ordem das linhas da tabela) para o
  // gerador de dashboard usar direto, sem precisar reler o HTML da tabela.
  const respostasNormalizadas = respostas.map((e) => {
    const obj = {};
    COLUNAS.forEach((c) => {
      obj[c.key] = c.key === "dataHora" ? fmtData(e) : (e[c.key] || "");
    });
    return obj;
  });

  const body = `
    <h1>RITA — Pesquisa de perfil</h1>
    <p class="sub" id="contagem">${respostas.length} resposta${respostas.length === 1 ? "" : "s"} registrada${respostas.length === 1 ? "" : "s"} (mais recente primeiro).</p>
    ${linkVoltar}

    <div class="filters">
      <label>Empresa
        <select id="filtroEmpresa"><option value="">Todas</option>${opcoesEmpresa}</select>
      </label>
      <button id="limparFiltro">Limpar filtro</button>
      <button id="baixarExcel">Baixar como Excel (.xlsx)</button>
      <button id="gerarDashboard" class="principal">Gerar dashboard</button>
    </div>
    <p class="dica-selecao">Marque na coluna "Incluir" quais respostas quer usar no dashboard (vêm todas marcadas por padrão). O filtro de empresa acima só ajuda a achar linhas — quem entra no dashboard é definido pelas marcações.</p>

    <div class="table-scroll">
      <table>
        <thead><tr><th class="col-chk"><input type="checkbox" id="chkTodos" checked title="Marcar/desmarcar todas as linhas visíveis"></th>${COLUNAS_TABELA.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
        <tbody id="corpoTabela">${rows || `<tr><td colspan='${COLUNAS_TABELA.length + 1}'>Nenhuma resposta registrada ainda.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="dash-section" id="dashboardSection">
      <div id="dashboardCapture">
        <h2>RiT@ — Dashboard da pesquisa de perfil</h2>
        <p class="dash-sub" id="dashSub"></p>

        <div class="dash-kpis" id="dashKpis"></div>

        <div class="dash-card">
          <h3>Nível de conhecimento vs. nível de otimismo</h3>
          <div class="dash-legend" id="legendaConhecOtim"></div>
          <div class="dash-chart-wrap" style="height:240px;"><canvas id="chartConhecOtim"></canvas></div>
        </div>

        <div class="dash-card" id="cardPercepcoes">
          <h3>Percepções técnicas</h3>
          <div class="dash-legend" id="legendaPercepcoes"></div>
          <div class="dash-chart-wrap" id="wrapPercepcoes"><canvas id="chartPercepcoes"></canvas></div>
        </div>

        <div class="dash-card">
          <h3>Temas que mais querem se aprofundar</h3>
          <div class="dash-chart-wrap" style="height:280px;"><canvas id="chartAprofundar"></canvas></div>
        </div>

        <div class="dash-card">
          <div class="dash-wc-row">
            <div>
              <h3>Desafios</h3>
              <canvas id="wcDesafios" width="700" height="380"></canvas>
            </div>
            <div>
              <h3>Incertezas</h3>
              <canvas id="wcIncertezas" width="700" height="380"></canvas>
            </div>
          </div>
        </div>

        <p class="dica-selecao">Paleta de cores: preto, vermelho escarlate, laranja, dourado, amarelo e rosa — as cores oficiais do logo da PwC.</p>
      </div>

      <div class="dash-actions">
        <button id="baixarDashboardPdf">Baixar dashboard como PDF</button>
        <button id="fecharDashboard">Fechar dashboard</button>
      </div>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/wordcloud2.js/1.2.3/wordcloud2.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js"></script>
    <script>
      const totalRespostas = ${toScriptJson(respostas.length)};
      const RESPOSTAS_RAW = ${toScriptJson(respostasNormalizadas)};

      const filtroEmpresa = document.getElementById('filtroEmpresa');
      const contagemEl = document.getElementById('contagem');
      const linhas = Array.from(document.querySelectorAll('#corpoTabela tr[data-empresa]'));

      function aplicarFiltro() {
        const empresa = filtroEmpresa.value;
        let visiveis = 0;
        linhas.forEach((tr) => {
          const bate = !empresa || tr.dataset.empresa === empresa;
          tr.classList.toggle('oculta', !bate);
          if (bate) visiveis++;
        });
        contagemEl.textContent = empresa
          ? visiveis + ' de ' + totalRespostas + ' resposta(s) — filtro aplicado'
          : totalRespostas + ' resposta(s) registrada(s) (mais recente primeiro).';
      }

      filtroEmpresa.addEventListener('change', aplicarFiltro);
      document.getElementById('limparFiltro').addEventListener('click', () => {
        filtroEmpresa.value = '';
        aplicarFiltro();
      });

      // Baixa como .xlsx só as linhas VISÍVEIS (respeita o filtro de empresa
      // aplicado na tela) — se nenhum filtro estiver ativo, baixa tudo.
      document.getElementById('baixarExcel').addEventListener('click', () => {
        const cabecalho = ${JSON.stringify(["Incluir", ...COLUNAS_TABELA.map((c) => c.label)]).replace(/</g, "\\u003c")};
        const linhasVisiveis = linhas.filter((tr) => !tr.classList.contains('oculta'));
        const dados = linhasVisiveis.map((tr) => {
          const chk = tr.querySelector('.chk-linha');
          const textos = Array.from(tr.querySelectorAll('td:not(.col-chk)')).map((td) => td.textContent);
          return [chk.checked ? 'Sim' : 'Não', ...textos];
        });

        const planilha = XLSX.utils.aoa_to_sheet([cabecalho, ...dados]);
        planilha['!cols'] = cabecalho.map(() => ({ wch: 26 }));
        const pasta = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(pasta, planilha, 'Pesquisa de perfil');

        const agora = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(pasta, 'pesquisa-perfil-rita-' + agora + '.xlsx');
      });

      // ---------------- Seleção de linhas (checkboxes) ----------------
      const chkTodos = document.getElementById('chkTodos');
      const checksLinha = Array.from(document.querySelectorAll('.chk-linha'));

      chkTodos.addEventListener('change', () => {
        linhas.forEach((tr) => {
          if (tr.classList.contains('oculta')) return; // só afeta linhas visíveis
          const chk = tr.querySelector('.chk-linha');
          if (chk) chk.checked = chkTodos.checked;
        });
      });

      function coletarSelecionados() {
        return checksLinha
          .filter((chk) => chk.checked)
          .map((chk) => RESPOSTAS_RAW[Number(chk.dataset.index)])
          .filter(Boolean);
      }

      // ---------------- Paleta PwC ----------------
      const PWC_SCARLET = '#AD1B02';
      const PWC_ORANGE = '#D85604';
      const PWC_GOLD = '#E88D14';
      const PWC_YELLOW = '#F3BE26';
      const PWC_PINK = '#E669A2';
      const PWC_BLACK = '#000000';
      const PWC_CICLO = [PWC_SCARLET, PWC_ORANGE, PWC_GOLD, PWC_YELLOW, PWC_PINK, PWC_BLACK];

      function pct(n, total) {
        if (!total) return 0;
        return Math.round((n / total) * 100);
      }

      // Conta valores exatos de um campo (trim, sem diferenciar maiúsc/minúsc
      // pra dedupe, mas preserva a primeira grafia encontrada para exibir).
      function contarFrases(lista, campo) {
        const mapa = new Map(); // chaveNormalizada -> { texto, contagem }
        lista.forEach((r) => {
          const bruto = (r[campo] || '').trim();
          if (!bruto) return;
          const chave = bruto.toLowerCase();
          if (mapa.has(chave)) {
            mapa.get(chave).contagem++;
          } else {
            mapa.set(chave, { texto: bruto, contagem: 1 });
          }
        });
        return Array.from(mapa.values()).sort((a, b) => b.contagem - a.contagem);
      }

      function contarCategorias(lista, campo, categorias) {
        const contagem = {};
        categorias.forEach((c) => { contagem[c] = 0; });
        lista.forEach((r) => {
          const v = (r[campo] || '').trim();
          if (contagem.hasOwnProperty(v)) contagem[v]++;
        });
        return contagem;
      }

      // Plugin customizado do Chart.js pra escrever a porcentagem dentro de
      // cada segmento colorido da barra empilhada (sem depender de plugin
      // externo extra).
      const percentLabelPlugin = {
        id: 'percentLabel',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.data.datasets.forEach((dataset, dsIndex) => {
            if (!dataset._percentLabels) return;
            const meta = chart.getDatasetMeta(dsIndex);
            meta.data.forEach((bar, index) => {
              const label = dataset._percentLabels[index];
              if (!label) return;
              ctx.save();
              ctx.fillStyle = dataset._labelColor || '#2A2620';
              ctx.font = 'bold 11px -apple-system, Arial, sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, bar.x, bar.y);
              ctx.restore();
            });
          });
        }
      };
      if (typeof Chart !== 'undefined') Chart.register(percentLabelPlugin);

      let chartConhecOtim = null;
      let chartPercepcoes = null;
      let chartAprofundar = null;

      const CAMPOS_TECNICOS = [
        { key: 'simplificaAmbienteNegocios', label: 'RT simplifica negócios' },
        { key: 'familiaridadeRegimes', label: 'Familiaridade Regimes' },
        { key: 'bancoNotaFiscal', label: 'Banco emite NF' },
        { key: 'seguradoraDeducaoSinistros', label: 'Seguradora deduz sinistros' },
        { key: 'subadquirentesDeRE', label: 'Sub-adquirentes e DeRE' },
        { key: 'efeitosReprecificacao', label: 'Efeito de reprecificação' },
      ];

      function renderLegenda(elId, itens) {
        const el = document.getElementById(elId);
        el.innerHTML = itens.map((it) =>
          '<span><span class="sq" style="background:' + it.cor + '"></span>' + it.texto + '</span>'
        ).join('');
      }

      function gerarDashboard() {
        if (typeof Chart === 'undefined' || typeof WordCloud === 'undefined') {
          alert('Não consegui carregar as bibliotecas de gráficos (Chart.js/wordcloud2.js) via internet. Verifique sua conexão e recarregue a página antes de tentar de novo.');
          return;
        }
        const selecionados = coletarSelecionados();
        if (selecionados.length === 0) {
          alert('Marque pelo menos uma resposta na tabela antes de gerar o dashboard.');
          return;
        }

        document.getElementById('dashSub').textContent =
          selecionados.length + ' de ' + totalRespostas + ' resposta(s) selecionada(s) para este dashboard.';

        // ---- KPIs ----
        const totalSel = selecionados.length;
        const otimismoAlto = selecionados.filter((r) => (r.nivelOtimismo || '').trim() === 'Alto').length;
        const simplificaSim = selecionados.filter((r) => (r.simplificaAmbienteNegocios || '').trim() === 'Sim');
        const simplificaRespondido = selecionados.filter((r) => (r.simplificaAmbienteNegocios || '').trim() !== '');
        const reprecifSim = selecionados.filter((r) => (r.efeitosReprecificacao || '').trim() === 'Sim');
        const reprecifRespondido = selecionados.filter((r) => (r.efeitosReprecificacao || '').trim() !== '');

        const kpis = [
          { cor: PWC_SCARLET, label: 'Respostas selecionadas', valor: String(totalSel) },
          { cor: PWC_ORANGE, label: 'Otimismo alto', valor: pct(otimismoAlto, totalSel) + '%' },
          {
            cor: PWC_GOLD,
            label: 'Acham que vai simplificar',
            valor: simplificaRespondido.length ? pct(simplificaSim.length, simplificaRespondido.length) + '%' : '—',
          },
          {
            cor: PWC_PINK,
            label: 'Veem efeito de reprecificação',
            valor: reprecifRespondido.length ? pct(reprecifSim.length, reprecifRespondido.length) + '%' : '—',
          },
        ];
        document.getElementById('dashKpis').innerHTML = kpis.map((k) =>
          '<div class="dash-kpi"><div class="lbl"><span class="dot" style="background:' + k.cor + '"></span>' + k.label + '</div><div class="val">' + k.valor + '</div></div>'
        ).join('');

        // ---- Gráfico 1: conhecimento vs otimismo ----
        const niveis = ['Baixo', 'Médio', 'Alto'];
        const conhecCont = contarCategorias(selecionados, 'nivelConhecimento', niveis);
        const otimCont = contarCategorias(selecionados, 'nivelOtimismo', niveis);

        renderLegenda('legendaConhecOtim', [
          { cor: PWC_SCARLET, texto: 'Nível de conhecimento' },
          { cor: PWC_GOLD, texto: 'Nível de otimismo' },
        ]);

        if (chartConhecOtim) chartConhecOtim.destroy();
        chartConhecOtim = new Chart(document.getElementById('chartConhecOtim'), {
          type: 'bar',
          data: {
            labels: niveis,
            datasets: [
              { label: 'Conhecimento', data: niveis.map((n) => conhecCont[n]), backgroundColor: PWC_SCARLET, borderRadius: 4, maxBarThickness: 44 },
              { label: 'Otimismo', data: niveis.map((n) => otimCont[n]), backgroundColor: PWC_GOLD, borderRadius: 4, maxBarThickness: 44 },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { precision: 0, color: '#7A6F63' }, grid: { color: '#EEE8DC' } },
              x: { ticks: { color: '#7A6F63' }, grid: { display: false } },
            },
          },
        });

        // ---- Gráfico 2: percepções técnicas (só campos com pelo menos uma resposta) ----
        const camposComDado = CAMPOS_TECNICOS.filter((c) =>
          selecionados.some((r) => (r[c.key] || '').trim() !== '')
        );

        if (camposComDado.length === 0) {
          document.getElementById('cardPercepcoes').style.display = 'none';
        } else {
          document.getElementById('cardPercepcoes').style.display = '';
          renderLegenda('legendaPercepcoes', [
            { cor: PWC_YELLOW, texto: 'Sim' },
            { cor: PWC_SCARLET, texto: 'Não' },
            { cor: PWC_ORANGE, texto: 'Depende' },
          ]);

          const labelsTec = camposComDado.map((c) => c.label);
          const totaisPorCampo = camposComDado.map((c) => selecionados.filter((r) => (r[c.key] || '').trim() !== '').length);
          const simData = camposComDado.map((c) => selecionados.filter((r) => (r[c.key] || '').trim() === 'Sim').length);
          const naoData = camposComDado.map((c) => selecionados.filter((r) => (r[c.key] || '').trim() === 'Não').length);
          const dependeData = camposComDado.map((c) => selecionados.filter((r) => (r[c.key] || '').trim() === 'Depende').length);

          function labelsPct(valores) {
            return valores.map((v, i) => (v > 0 ? pct(v, totaisPorCampo[i]) + '%' : ''));
          }

          const dsSim = { label: 'Sim', data: simData, backgroundColor: PWC_YELLOW, borderRadius: 4, _percentLabels: labelsPct(simData), _labelColor: '#412402' };
          const dsNao = { label: 'Não', data: naoData, backgroundColor: PWC_SCARLET, borderRadius: 4, _percentLabels: labelsPct(naoData), _labelColor: '#FFFFFF' };
          const dsDepende = { label: 'Depende', data: dependeData, backgroundColor: PWC_ORANGE, borderRadius: 4, _percentLabels: labelsPct(dependeData), _labelColor: '#FFFFFF' };

          document.getElementById('wrapPercepcoes').style.height = Math.max(220, camposComDado.length * 46 + 60) + 'px';

          if (chartPercepcoes) chartPercepcoes.destroy();
          chartPercepcoes = new Chart(document.getElementById('chartPercepcoes'), {
            type: 'bar',
            data: { labels: labelsTec, datasets: [dsSim, dsNao, dsDepende] },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: '#7A6F63' }, grid: { color: '#EEE8DC' } },
                y: { stacked: true, ticks: { color: '#2A2620' }, grid: { display: false } },
              },
            },
          });
        }

        // ---- Gráfico 3: pizza — elemento que quer se aprofundar ----
        let temas = contarFrases(selecionados, 'elementoAprofundar');
        if (temas.length > 9) {
          const top = temas.slice(0, 9);
          const outros = temas.slice(9).reduce((acc, t) => acc + t.contagem, 0);
          temas = top.concat([{ texto: 'Outros', contagem: outros }]);
        }
        const totalTemas = temas.reduce((acc, t) => acc + t.contagem, 0);

        if (chartAprofundar) chartAprofundar.destroy();
        chartAprofundar = new Chart(document.getElementById('chartAprofundar'), {
          type: 'pie',
          data: {
            labels: temas.map((t) => t.texto + ' (' + t.contagem + '/' + totalTemas + ')'),
            datasets: [{
              data: temas.map((t) => t.contagem),
              backgroundColor: temas.map((_, i) => PWC_CICLO[i % PWC_CICLO.length]),
              borderColor: '#FFFFFF',
              borderWidth: 2,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'right', labels: { color: '#2A2620', boxWidth: 12, font: { size: 11.5 } } },
            },
          },
        });

        // ---- Nuvens de palavras: cada CÉLULA (resposta inteira) é uma
        // unidade só — repete (fica maior) quando o mesmo texto aparece de
        // novo, igual, em outra resposta selecionada. Não quebra em palavras
        // soltas. ----
        function desenharNuvem(canvasId, campo) {
          const canvas = document.getElementById(canvasId);
          const itens = contarFrases(selecionados, campo);
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (itens.length === 0) return;
          const maxPeso = Math.max(...itens.map((it) => it.contagem));
          const cores = new Map(itens.map((it, i) => [it.texto, PWC_CICLO[i % PWC_CICLO.length]]));
          WordCloud(canvas, {
            list: itens.map((it) => [it.texto, it.contagem]),
            weightFactor: (peso) => 16 + (peso / maxPeso) * 42,
            fontFamily: '-apple-system, Segoe UI, Arial, sans-serif',
            color: (word) => cores.get(word) || PWC_BLACK,
            backgroundColor: '#FFFFFF',
            rotateRatio: 0,
            gridSize: 10,
            drawOutOfBound: false,
            shrinkToFit: true,
          });
        }

        desenharNuvem('wcDesafios', 'principalDesafio');
        desenharNuvem('wcIncertezas', 'elementoIncerteza');

        document.getElementById('dashboardSection').style.display = 'block';
        document.getElementById('dashboardSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      document.getElementById('gerarDashboard').addEventListener('click', gerarDashboard);
      document.getElementById('fecharDashboard').addEventListener('click', () => {
        document.getElementById('dashboardSection').style.display = 'none';
      });

      document.getElementById('baixarDashboardPdf').addEventListener('click', async () => {
        if (typeof html2canvas === 'undefined' || !window.jspdf) {
          alert('Não consegui carregar as bibliotecas de PDF (html2canvas/jsPDF) via internet. Verifique sua conexão e recarregue a página antes de tentar de novo.');
          return;
        }
        const btn = document.getElementById('baixarDashboardPdf');
        btn.disabled = true;
        btn.textContent = 'Gerando PDF…';
        try {
          const el = document.getElementById('dashboardCapture');
          const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#FFFFFF' });
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          const pageW = pdf.internal.pageSize.getWidth();
          const pageH = pdf.internal.pageSize.getHeight();
          const margin = 8;
          const maxW = pageW - margin * 2;
          const maxH = pageH - margin * 2;
          let imgW = maxW;
          let imgH = (canvas.height / canvas.width) * imgW;
          if (imgH > maxH) {
            imgH = maxH;
            imgW = (canvas.width / canvas.height) * imgH;
          }
          const x = (pageW - imgW) / 2;
          const y = margin;
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, imgW, imgH);
          pdf.save('dashboard-pesquisa-rita-' + new Date().toISOString().slice(0, 10) + '.pdf');
        } catch (err) {
          alert('Não consegui gerar o PDF: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Baixar dashboard como PDF';
        }
      });
    </script>
  `;

  return res.status(200).send(renderPage(body));
};
