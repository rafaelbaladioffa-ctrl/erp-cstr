export interface Translations {
  // Layout — navegação
  nav: {
    centralOperacoes: string;
    operacaoDoDia: string;
    timelineOperacional: string;
    relatoriosIndicadores: string;
    projeto: string;
    projetosAtivos: string;
    historicoProjestos: string;
    atualizacoes: string;
    atualizacoesDiarias: string;
    atualizacoesProjetos: string;
    sistema: string;
    dashboard: string;
    cadastrosGerais: string;
    cadastrosMestres: string;
    tecnico: string;
    minhasTarefas: string;
    seguranca: string;
    log: string;
  };
  // Layout — breadcrumb
  breadcrumb: {
    detalhe: string;
    erp: string;
  };
  // Layout — shellbar / sidebar
  layout: {
    abrirMenu: string;
    fecharMenu: string;
    menuMobile: string;
    abrirEmGuia: (label: string) => string;
    abrirEmGuiaTip: string;
    configuracoes: string;
    semModulo: string;
    recolher: string;
    expandirMenu: string;
    notifAtivas: string;
    notifBloqueadas: string;
    roleAdmin: string;
    roleUsuario: string;
  };
  // Layout — menu de configurações
  settings: {
    tema: string;
    claro: string;
    escuro: string;
    idioma: string;
    minhaConta: string;
    sair: string;
  };
  // Notificações
  notif: {
    titulo: string;
    semNotificacoes: string;
    marcarLidas: string;
    ativarNotificacoes: string;
    notificacoesAtivas: string;
  };
  // Busca global
  search: {
    placeholder: string;
    projetos: string;
    sites: string;
    tarefas: string;
    buscando: string;
    semResultados: string;
    semResultadosPara: (term: string) => string;
  };
  // Comuns (botões, estados, etc.)
  common: {
    salvar: string;
    cancelar: string;
    excluir: string;
    editar: string;
    novo: string;
    buscar: string;
    carregando: string;
    semDados: string;
    confirmar: string;
    voltar: string;
    fechar: string;
    sim: string;
    nao: string;
    ativo: string;
    inativo: string;
    todos: string;
    nenhum: string;
    pagina: string;
    porPagina: string;
    anterior: string;
    proximo: string;
    de: string;
    ate: string;
    hoje: string;
    ontem: string;
    salvando: string;
    removendo: string;
    remover: string;
  };
  // Permissão / acesso
  permission: {
    semAcesso: string;
    semModulo: string;
    superuserOnly: string;
  };
  // Paginação
  pagination: {
    nenhum: string;
    exibindo: (start: number, end: number, total: number) => string;
    porPagina: (n: number) => string;
    anteriorPagina: string;
    proximaPagina: string;
  };
  // Minha Conta
  account: {
    titulo: string;
    senhaAtual: string;
    novaSenha: string;
    confirmarSenha: string;
    salvarSenha: string;
    salvando: string;
    sairConta: string;
    errCamposObrigatorios: string;
    errSenhasMismatch: string;
    errDefault: string;
    sucesso: string;
  };
  // Calendário / seletor de período
  calendar: {
    selecionarPeriodo: string;
    limparPeriodo: string;
    limpar: string;
    periodoLimitado: (n: number) => string;
    escolhaDiaFinal: (maxDays: number) => string;
    cliqueNumDia: string;
  };
  // Formulário genérico
  form: {
    selecione: string;
    ativo: string;
  };
  // Modal de ausências de técnico
  absence: {
    titulo: (name: string) => string;
    de: string;
    ate: string;
    motivo: string;
    motivoPlaceholder: string;
    adicionarAusencia: string;
    fechar: string;
    removendo: string;
    remover: string;
  };
}
