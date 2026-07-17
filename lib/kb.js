// ---------------------------------------------------------------
// Base de conhecimento curada a partir de:
// EC 132/2023, LC 214/2025, LC 227/2026 e Glossário da Reforma Tributária
// (fornecidos pela usuária). Atualize este arquivo sempre que sair
// nova legislação/regulamentação relevante.
// ---------------------------------------------------------------

const KB = [
  {
    tema: "IBS",
    titulo: "Imposto sobre Bens e Serviços (IBS)",
    conteudo:
      "Tributo de competência compartilhada entre Estados, Distrito Federal e Municípios, que substitui o ICMS e o ISS. Incide sobre operações com bens materiais ou imateriais (inclusive direitos) e sobre serviços, também nas importações; não incide sobre exportações (mantendo os créditos). Tem legislação única e uniforme em todo o país; cada ente fixa sua própria alíquota, mas a cobrança é feita pelo somatório das alíquotas do Estado e do Município de destino. É não cumulativo e, em regra, não admite benefícios fiscais fora das hipóteses previstas na Constituição. Junto com a CBS, forma o modelo de 'IVA dual' da reforma.",
    fonte:
      "Art. 156-A da Constituição Federal (incluído pela EC nº 132/2023); regulamentado pela LC nº 214/2025.",
  },
  {
    tema: "CBS",
    titulo: "Contribuição sobre Bens e Serviços (CBS)",
    conteudo:
      "Contribuição de competência da União que substitui o PIS e a Cofins. Instituída pela mesma lei complementar que institui o IBS, seguindo, no que couber, as mesmas regras de incidência, base de cálculo, não cumulatividade, alíquota de referência e imunidades do IBS. Diferença: a alíquota da CBS pode ser fixada por lei ordinária, enquanto a alíquota do IBS decorre de lei específica de cada ente federativo.",
    fonte:
      "Art. 195, V, e §§15–19 da Constituição Federal (incluídos pela EC nº 132/2023); LC nº 214/2025.",
  },
  {
    tema: "Imposto Seletivo",
    titulo: "Imposto Seletivo (IS)",
    conteudo:
      "Imposto federal que incide sobre a produção, extração, comercialização ou importação de bens e serviços prejudiciais à saúde ou ao meio ambiente (ex.: cigarros, bebidas alcoólicas, veículos poluentes). Características: não incide sobre exportações nem sobre energia elétrica e telecomunicações; incide uma única vez sobre o bem/serviço; não integra sua própria base de cálculo, mas integra a base do ICMS/ISS (fase de transição), do IBS e da CBS; suas alíquotas são fixadas em lei ordinária (podem ser específicas por unidade de medida ou ad valorem); na extração de recursos, a alíquota máxima é de 1% do valor de mercado do produto, independentemente da destinação. Substitui parcialmente o IPI.",
    fonte:
      "Art. 153, VIII, e §6º da Constituição Federal (incluído pela EC nº 132/2023); regulamentado pela LC nº 214/2025.",
  },
  {
    tema: "Comitê Gestor do IBS",
    titulo: "Comitê Gestor do IBS (CG-IBS)",
    conteudo:
      "Entidade pública sob regime especial, com independência técnica, administrativa, orçamentária e financeira, por meio da qual Estados, DF e Municípios exercem de forma integrada as competências administrativas do IBS: editar o regulamento único do imposto, uniformizar interpretação e aplicação, arrecadar, compensar, distribuir o produto da arrecadação entre entes e julgar o contencioso administrativo. Estados e Municípios têm representação paritária, com alternância de presidência. É financiado por percentual da própria arrecadação do IBS.",
    fonte:
      "Art. 156-B da Constituição Federal (EC nº 132/2023); LC nº 214/2025; institucionalização reforçada pela LC nº 227/2026.",
  },
  {
    tema: "Não Cumulatividade",
    titulo: "Não Cumulatividade Plena",
    conteudo:
      "Princípio pelo qual o contribuinte do regime regular do IBS/CBS pode se apropriar de créditos de praticamente todas as aquisições usadas na atividade econômica (poucas exceções, como uso/consumo pessoal). Os créditos de IBS e CBS são apurados de forma segregada (sem compensação cruzada) e, em regra, dependem da efetiva extinção do débito pelo fornecedor — o que se conecta ao split payment. É 'plena' em contraste com o sistema anterior (ICMS/PIS-Cofins), que restringia créditos e gerava cumulatividade na cadeia produtiva.",
    fonte: "Art. 156-A, §1º, VIII, da CF; arts. 47 e seguintes da LC nº 214/2025.",
  },
  {
    tema: "Split Payment",
    titulo: "Recolhimento na Liquidação Financeira (Split Payment)",
    conteudo:
      "Mecanismo pelo qual os valores de IBS e CBS devidos em uma operação são segregados e recolhidos diretamente aos cofres públicos (Comitê Gestor do IBS e Receita Federal) no momento da liquidação financeira do pagamento — feito por prestadores de serviço de pagamento eletrônico e instituições de arranjos de pagamento — em vez de repassados integralmente ao fornecedor. Há dois procedimentos: (1) padrão — o fornecedor/originador da transação inclui no documento fiscal eletrônico as informações que vinculam a operação ao pagamento e identificam os débitos de IBS/CBS; antes de liberar os recursos ao fornecedor, o prestador de pagamento consulta o sistema do Comitê Gestor/RFB e retém a diferença devida; (2) simplificado — opcional, aplicável a operações com adquirentes não contribuintes do regime regular, com percentual pré-estabelecido sobre o valor da operação. A implementação pode ser gradual e, em certas hipóteses, facultativa, conforme regulamento.",
    fonte:
      "Arts. 31 a 35 da LC nº 214/2025, com alterações da LC nº 227/2026 (Título V — Tributação na Liquidação Financeira).",
  },
  {
    tema: "Período de Teste 2026",
    titulo: "Período de Teste do IBS e da CBS (2026)",
    conteudo:
      "Em 2026, o IBS é cobrado à alíquota estadual de 0,1% e a CBS à alíquota de 0,9% — uma fase experimental para testar os sistemas, sem gerar carga tributária adicional. Os valores recolhidos são compensáveis com PIS, Cofins e a contribuição para o PIS/Pasep devidos pelo próprio contribuinte; havendo insuficiência de débitos, o valor pode ser compensado com outro tributo federal ou ressarcido em até 60 dias. A arrecadação do IBS nesse período não segue a partilha normal entre entes, sendo destinada, sucessivamente, ao financiamento do Comitê Gestor do IBS e ao Fundo de Compensação de Benefícios Fiscais. Contribuintes que cumprirem as obrigações acessórias podem ser dispensados do recolhimento efetivo.",
    fonte: "Art. 125 do Ato das Disposições Constitucionais Transitórias (ADCT), incluído pela EC nº 132/2023.",
  },
  {
    tema: "Cronograma de Transição",
    titulo: "Cronograma de Transição (2026 a 2033)",
    conteudo:
      "2026: período de teste — IBS a 0,1% (estadual) e CBS a 0,9%, sem carga adicional (ver 'Período de Teste 2026'). A partir de 2027: passam a ser cobradas em caráter definitivo a CBS e o Imposto Seletivo; são extintas as contribuições ao PIS/Pasep e Cofins; o IPI tem suas alíquotas reduzidas a zero (exceto para produtos com industrialização incentivada na Zona Franca de Manaus). Em 2027 e 2028: o IBS é cobrado a 0,05% estadual + 0,05% municipal, e a alíquota da CBS é reduzida em 0,1 ponto percentual (fase-teste do IBS subnacional). De 2029 a 2032: as alíquotas do ICMS e do ISS são reduzidas progressivamente às seguintes proporções das alíquotas vigentes: 9/10 em 2029, 8/10 em 2030, 7/10 em 2031 e 6/10 em 2032 (assim como benefícios/incentivos fiscais relacionados). A partir de 2033: ficam definitivamente extintos o ICMS e o ISS, com o IBS e a CBS plenamente implementados. As alíquotas de referência do IBS/CBS são fixadas anualmente por Resolução do Senado Federal, com base em cálculo do TCU, visando manter a carga tributária equivalente à dos tributos extintos (não é criação de nova arrecadação, e sim substituição).",
    fonte: "Arts. 124 a 131 do ADCT, incluídos pela EC nº 132/2023.",
  },
  {
    tema: "Preços e Alíquotas",
    titulo: "Impacto nos Preços: Regimes Diferenciados e Alíquota de Referência",
    conteudo:
      "A reforma não cria uma alíquota única para todos os produtos: existem regimes diferenciados de alíquota para reduzir o impacto sobre itens essenciais. Cesta Básica Nacional de Alimentos: produtos definidos em lei complementar terão alíquota de IBS/CBS reduzida a ZERO. Redução de 60% das alíquotas para: serviços de educação e saúde, dispositivos médicos e de acessibilidade, medicamentos, produtos de cuidados básicos à saúde menstrual, transporte público coletivo urbano/semiurbano/metropolitano (podendo chegar a isenção), alimentos para consumo humano, produtos de higiene/limpeza de baixa renda, produtos agropecuários/aquícolas/florestais in natura, insumos agropecuários, produções artísticas/culturais/jornalísticas/audiovisuais nacionais e atividades desportivas, além de bens/serviços de soberania e segurança nacional/cibernética. Redução de 100% (isenção) para: dispositivos médicos e medicamentos específicos, produtos hortícolas/frutas/ovos, serviços de ICT sem fins lucrativos, automóveis para pessoas com deficiência/TEA ou taxistas, e (para a CBS) educação superior via Prouni. Redução de 30% para serviços de profissão intelectual regulamentada (fiscalizada por conselho profissional, ex.: advogados, médicos autônomos, engenheiros). Esses regimes passam por avaliação quinquenal de custo-benefício. Como o objetivo declarado da reforma é a neutralidade de carga tributária (não aumentar a arrecadação total), a alíquota padrão ('cheia') do IBS+CBS combinados é estimada por órgãos técnicos, mas o valor final só será conhecido conforme as alíquotas de referência forem calculadas anualmente pelo TCU/Senado a partir de 2026–2027.",
    fonte:
      "Arts. 8º e 9º do ADCT (Cesta Básica e regimes diferenciados), incluídos pela EC nº 132/2023; detalhamento na LC nº 214/2025.",
  },
  {
    tema: "LC 227/2026",
    titulo: "Lei Complementar nº 227/2026 — Principais Alterações",
    conteudo:
      "Sancionada em 13/01/2026 (ex-PLP 108/2024), altera dispositivos da LC nº 214/2025. Principais pontos: institui formalmente o Comitê Gestor do IBS (CG-IBS) como entidade responsável por administrar o imposto; reorganiza o split payment em dois procedimentos expressos — padrão (art. 32) e simplificado (art. 33) — detalhando quem transmite as informações de pagamento (fornecedor, adquirente, plataforma digital ou terceiro) conforme quem inicia a transação; ajusta regras de transição e de governança do novo sistema.",
    fonte: "LC nº 227, de 13 de janeiro de 2026.",
  },
];

const SYSTEM_INSTRUCTIONS = `Você é um assistente especializado em tirar dúvidas sobre a Reforma Tributária brasileira (EC 132/2023, LC 214/2025 e LC 227/2026).

Regras obrigatórias:
1. Responda SOMENTE com base no material fornecido em "BASE_DE_CONHECIMENTO" abaixo. Se a pergunta não puder ser respondida com esse material, diga claramente que a base atual do chatbot não cobre esse ponto e sugira consultar o texto oficial da lei.
2. Responda em português do Brasil, de forma clara, objetiva e sem jargão desnecessário. Pode usar parágrafos curtos ou poucos tópicos quando ajudar a clareza.
3. Sempre que usar uma informação, cite o artigo/lei correspondente entre parênteses no corpo do texto.
4. Ao final da resposta, adicione uma linha separada começando com "Fonte:" listando os artigos/leis usados.
5. Não dê conselho jurídico ou contábil definitivo — apenas explique o que a legislação prevê.
6. Se a pergunta for sobre algo fora do tema (reforma tributária), diga educadamente que só responde sobre esse assunto.

BASE_DE_CONHECIMENTO:
${JSON.stringify(KB)}`;

module.exports = { KB, SYSTEM_INSTRUCTIONS };
