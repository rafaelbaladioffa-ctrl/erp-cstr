const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const axios = require("axios");
const http = require("http");
const puppeteer = require("puppeteer-core");

const API_URL = process.env.BOT_API_URL || "http://backend:8000/api";
const API_SECRET = process.env.BOT_API_SECRET || "";
const AUTH_DIR = process.env.AUTH_DIR || "/app/auth_info";
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

const logger = pino({ level: "warn" });

// Opções do menu principal. A lista foi pensada para crescer conforme novas
// funções do bot forem adicionadas.
const MENU_OPTIONS = [
  { number: "1", key: "alocacao", label: "Alocação (projeto e site de hoje)" },
  { number: "2", key: "atualizacao_projetos", label: "Atualização de projetos" },
  { number: "3", key: "minhas_tarefas", label: "Minhas tarefas" },
];

const MENU_TEXT =
  "Olá! Eu sou o bot do ERP Consultimer. O que você deseja?\n\n" +
  MENU_OPTIONS.map((o) => `${o.number}️⃣ ${o.label}`).join("\n") +
  "\n\nDigite o número da opção.";

// Estado de conversa por número (em memória — reinicia com o processo, o que
// é aceitável já que o fluxo é curto e o usuário sempre pode digitar /bot
// de novo para recomeçar).
const sessions = new Map();

function normalize(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function extractText(msg) {
  const m = msg.message;
  return m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption || "";
}

function formatDate(iso) {
  const [y, mo, d] = iso.split("-");
  return `${d}/${mo}/${y}`;
}

async function botGet(path, params) {
  const { data } = await axios.get(`${API_URL}${path}`, {
    params,
    headers: { "X-Bot-Secret": API_SECRET },
    timeout: 10000,
  });
  return data;
}

async function fetchAllocationByName(name) {
  const data = await botGet("/bot/allocation/", { name });

  if (data.found === "ambiguous") {
    const options = data.matches.map((n) => `• ${n}`).join("\n");
    return `Encontrei mais de um técnico com esse nome:\n\n${options}\n\nDigite /bot para tentar de novo, com o nome completo.`;
  }
  if (!data.found) {
    return "Não encontrei ninguém com esse nome cadastrado como técnico ativo. Confira a digitação (nome completo) ou fale com seu gestor.";
  }
  if (!data.allocations.length) {
    return `Olá, ${data.collaborator_name}! Você ainda não tem uma alocação registrada para hoje (${formatDate(data.date)}).`;
  }
  const lines = data.allocations.map(
    (a) => `• ${a.project}${a.code ? ` (${a.code})` : ""} — Site: ${a.site || "não informado"}`
  );
  return `Olá, ${data.collaborator_name}! Sua alocação de hoje (${formatDate(data.date)}):\n\n${lines.join("\n")}`;
}

async function fetchMyTasksByName(name) {
  const data = await botGet("/bot/my-tasks/", { name });

  if (data.found === "ambiguous") {
    const options = data.matches.map((n) => `• ${n}`).join("\n");
    return `Encontrei mais de um técnico com esse nome:\n\n${options}\n\nDigite /bot para tentar de novo, com o nome completo.`;
  }
  if (!data.found) {
    return "Não encontrei ninguém com esse nome cadastrado como técnico ativo. Confira a digitação (nome completo) ou fale com seu gestor.";
  }
  if (!data.tasks.length) {
    return `Olá, ${data.collaborator_name}! Você não tem tarefas pendentes no momento. 🎉`;
  }

  const byProject = new Map();
  for (const t of data.tasks) {
    const key = `${t.code ? `${t.code} - ` : ""}${t.project}`;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  }

  const blocks = [...byProject.entries()].map(
    ([project, tasks]) => `*${project}*\n` + tasks.map((t) => `• ${t.task} (${t.status})`).join("\n")
  );

  return `Olá, ${data.collaborator_name}! Suas tarefas pendentes:\n\n${blocks.join("\n\n")}`;
}

function formatProjectUpdate(p) {
  const lines = [
    `📋 *${p.code ? `${p.code} - ` : ""}${p.name}*`,
    `Cliente: ${p.client || "não informado"} | Site: ${p.site || "não informado"}`,
    `Status: ${p.status}${p.po ? ` | PO: ${p.po}` : ""}`,
    `Progresso do projeto: ${p.completion_percent}%`,
  ];

  if (p.today_update) {
    const u = p.today_update;
    lines.push("", "*Atualização de hoje:*");
    if (u.activities_text) lines.push(`Atividades: ${u.activities_text}`);
    if (u.certification_done) lines.push("🏆 Certificação finalizada");
    if (u.project_finished) lines.push("🏁 Projeto finalizado");
    if (u.summary) lines.push(`Obs: ${u.summary}`);
    if (u.collaborators.length) lines.push(`Colaboradores: ${u.collaborators.join(", ")}`);
  } else {
    lines.push("", "Nenhuma atualização registrada hoje para este projeto.");
  }

  return lines.join("\n");
}

function phoneToJid(rawPhone) {
  const digits = (rawPhone || "").replace(/\D/g, "");
  if (digits.length >= 12) return `${digits}@s.whatsapp.net`;
  if (digits.length === 10 || digits.length === 11) return `55${digits}@s.whatsapp.net`; // sem código de país
  return null; // número curto/inválido demais para confiar
}

function formatBroadcastMessage(t, date) {
  const lines = t.allocations.map(
    (a) => `• ${a.project}${a.code ? ` (${a.code})` : ""} — Site: ${a.site || "não informado"}`
  );
  return `Olá, ${t.collaborator_name}! Aqui está sua alocação para ${formatDate(date)}:\n\n${lines.join("\n")}`;
}

async function runAllocationBroadcast(sock) {
  const data = await botGet("/bot/daily-broadcast/");
  if (!data.technicians.length) {
    console.log(`Envio de alocação: nenhuma alocação para ${data.date}, nada a enviar.`);
    return;
  }
  console.log(`Envio de alocação: enviando de ${data.date} para ${data.technicians.length} técnico(s).`);
  for (const t of data.technicians) {
    const jid = phoneToJid(t.phone);
    if (!jid) {
      console.error(`Envio de alocação: telefone inválido para ${t.collaborator_name} (${t.phone}), pulando.`);
      continue;
    }
    try {
      await sock.sendMessage(jid, { text: formatBroadcastMessage(t, data.date) });
    } catch (err) {
      console.error(`Envio de alocação: erro ao enviar para ${t.collaborator_name}:`, err.message);
    }
  }
}

// Manda o mesmo texto consolidado (todos os projetos do dia) para cada
// destinatário cadastrado no BotSubscriber — usado pelos envios das 10h e
// das 17h, que são resumos gerenciais, não mensagens individuais por técnico.
async function sendToRecipients(sock, recipients, text, label) {
  if (!recipients.length) {
    console.log(`${label}: nenhum destinatário cadastrado (BotSubscriber), nada a enviar.`);
    return;
  }
  for (const r of recipients) {
    const jid = phoneToJid(r.phone);
    if (!jid) {
      console.error(`${label}: telefone inválido para ${r.name} (${r.phone}), pulando.`);
      continue;
    }
    try {
      await sock.sendMessage(jid, { text });
    } catch (err) {
      console.error(`${label}: erro ao enviar para ${r.name}:`, err.message);
    }
  }
}

async function runDailyTasksBroadcast(sock) {
  const data = await botGet("/bot/broadcasts/daily-tasks/");
  if (!data.projects.length) {
    console.log(`Tarefas do dia (10h): nenhum projeto alocado em ${data.date}, nada a enviar.`);
    return;
  }
  const blocks = data.projects.map((p) => {
    const lines = [`*${p.code ? `${p.code} - ` : ""}${p.project}* — Site: ${p.site || "não informado"}`];
    lines.push(`Técnicos: ${p.collaborators.join(", ") || "não informado"}`);
    lines.push(p.tasks.length ? `Tarefas:\n${p.tasks.map((t) => `• ${t}`).join("\n")}` : "Sem tarefas pendentes cadastradas.");
    return lines.join("\n");
  });
  const text = `📅 Tarefas alocadas para hoje (${formatDate(data.date)}):\n\n${blocks.join("\n\n")}`;
  console.log(`Tarefas do dia (10h): enviando ${data.projects.length} projeto(s) para ${data.recipients.length} destinatário(s).`);
  await sendToRecipients(sock, data.recipients, text, "Tarefas do dia (10h)");
}

async function runProjectUpdatesBroadcast(sock) {
  const data = await botGet("/bot/broadcasts/project-updates/");
  if (!data.projects.length) {
    console.log(`Atualização de projetos (17h): nenhum projeto alocado em ${data.date}, nada a enviar.`);
    return;
  }
  const blocks = data.projects.map((p) => {
    const lines = [
      `*${p.code ? `${p.code} - ` : ""}${p.project}* — Site: ${p.site || "não informado"}`,
      `Progresso: ${p.completion_percent}%`,
    ];
    lines.push(p.activities_text ? `Concluído hoje:\n${p.activities_text}` : "Nada concluído hoje.");
    if (p.certification_done) lines.push("🏆 Certificação finalizada");
    if (p.project_finished) lines.push("🏁 Projeto finalizado");
    return lines.join("\n");
  });
  const text = `✅ Atualização de projetos — hoje (${formatDate(data.date)}):\n\n${blocks.join("\n\n")}`;
  console.log(`Atualização de projetos (17h): enviando ${data.projects.length} projeto(s) para ${data.recipients.length} destinatário(s).`);
  await sendToRecipients(sock, data.recipients, text, "Atualização de projetos (17h)");
}

async function captureOperationsPrint() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--no-zygote",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "X-Bot-Secret": API_SECRET });
    await page.setViewport({ width: 1148, height: 900 });
    await page.goto(`${API_URL}/bot/operations-print/?site=all`, { waitUntil: "networkidle0", timeout: 30000 });
    const shot = await page.screenshot({ type: "png", fullPage: true });
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
  } finally {
    await browser.close();
  }
}

async function runOperationsPrintBroadcast(sock, overridePhone) {
  const label = "Operação do Dia (print)";
  const recipients = overridePhone
    ? [{ name: "Teste", phone: overridePhone }]
    : (await botGet("/bot/broadcasts/operations-print-recipients/")).recipients;

  if (!recipients.length) {
    console.log(`${label}: nenhum destinatário cadastrado, nada a enviar.`);
    return;
  }

  console.log(`${label}: capturando imagem da Central de Operações...`);
  const image = await captureOperationsPrint();
  const now = new Date();
  const caption = `📸 Operação do Dia — ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

  console.log(`${label}: enviando para ${recipients.length} destinatário(s).`);
  for (const r of recipients) {
    const jid = phoneToJid(r.phone);
    if (!jid) {
      console.error(`${label}: telefone inválido para ${r.name} (${r.phone}), pulando.`);
      continue;
    }
    try {
      await sock.sendMessage(jid, { image, caption, mimetype: "image/png" });
    } catch (err) {
      console.error(`${label}: erro ao enviar para ${r.name}:`, err.message);
    }
  }
}

let currentSock = null;

// Horários dos envios automáticos, em America/Sao_Paulo (convertidos para UTC
// fixo -3h — o Brasil não tem mais horário de verão desde 2019, então não
// precisa do pacote tzdata, nem sempre presente em imagens slim).
const SCHEDULED_BROADCASTS = [
  { key: "daily-tasks", hourUTC: 13, minuteUTC: 0, run: runDailyTasksBroadcast }, // 10h
  { key: "allocation", hourUTC: 21, minuteUTC: 0, run: runAllocationBroadcast }, // 18h
  { key: "project-updates", hourUTC: 20, minuteUTC: 0, run: runProjectUpdatesBroadcast }, // 17h
  // Print da Operação do Dia — 6x ao dia (8h, 10h, 12h, 14h, 16h, 18h). Cada
  // horário precisa de uma key própria: são disparos independentes no mesmo
  // dia, não um único envio diário como os de cima.
  { key: "operations-print-08", hourUTC: 11, minuteUTC: 0, run: (sock) => runOperationsPrintBroadcast(sock) },
  { key: "operations-print-10", hourUTC: 13, minuteUTC: 0, run: (sock) => runOperationsPrintBroadcast(sock) },
  { key: "operations-print-12", hourUTC: 15, minuteUTC: 0, run: (sock) => runOperationsPrintBroadcast(sock) },
  { key: "operations-print-14", hourUTC: 17, minuteUTC: 0, run: (sock) => runOperationsPrintBroadcast(sock) },
  { key: "operations-print-16", hourUTC: 19, minuteUTC: 0, run: (sock) => runOperationsPrintBroadcast(sock) },
  { key: "operations-print-18", hourUTC: 21, minuteUTC: 0, run: (sock) => runOperationsPrintBroadcast(sock) },
];
const lastRunDateKey = {};

// Servidor só para uso interno (não publicado no compose.yaml, só acessível
// de dentro do próprio container) — permite disparar cada envio automático na
// hora, via `docker exec`, para testar sem esperar o horário programado.
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (!currentSock) {
      res.writeHead(503).end("Bot não está conectado ao WhatsApp no momento.\n");
      return;
    }

    // Rota própria pro print da Operação do Dia — aceita ?to=<telefone> pra
    // mandar só pra um número específico (teste), em vez da lista completa
    // de destinatários cadastrados.
    if (url.pathname === "/trigger-operations-print") {
      const overridePhone = url.searchParams.get("to") || undefined;
      runOperationsPrintBroadcast(currentSock, overridePhone)
        .then(() => res.writeHead(200).end("Envio disparado — confira os logs do bot.\n"))
        .catch((err) => res.writeHead(500).end(`Erro: ${err.message}\n`));
      return;
    }

    const broadcast = SCHEDULED_BROADCASTS.find((b) => url.pathname === `/trigger-${b.key}`);
    if (!broadcast) {
      res.writeHead(404).end();
      return;
    }
    broadcast
      .run(currentSock)
      .then(() => res.writeHead(200).end("Envio disparado — confira os logs do bot.\n"))
      .catch((err) => res.writeHead(500).end(`Erro: ${err.message}\n`));
  })
  .listen(3001, "127.0.0.1");

setInterval(() => {
  if (!currentSock) return;
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  for (const b of SCHEDULED_BROADCASTS) {
    if (now.getUTCHours() === b.hourUTC && now.getUTCMinutes() === b.minuteUTC && lastRunDateKey[b.key] !== dateKey) {
      lastRunDateKey[b.key] = dateKey;
      b.run(currentSock).catch((err) => console.error(`Erro no envio automático (${b.key}):`, err.message));
    }
  }
}, 60000);

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Usando versão do WhatsApp Web: ${version.join(".")} (mais recente: ${isLatest})`);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    version,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 20000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("Escaneie o QR Code abaixo com o WhatsApp (Aparelhos conectados > Conectar um aparelho):");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      currentSock = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Conexão com o WhatsApp fechada (statusCode=${statusCode}, motivo=${lastDisconnect?.error?.message}).`, shouldReconnect ? "Reconectando..." : "Sessão deslogada — apague o volume de auth e escaneie o QR de novo.");
      if (shouldReconnect) start();
    } else if (connection === "open") {
      console.log("Bot conectado ao WhatsApp com sucesso.");
      currentSock = sock;
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@g.us")) continue;

      const rawText = extractText(msg).trim();
      const text = normalize(rawText);
      if (!text) continue;

      try {
        if (text === "/bot" || text === "bot") {
          sessions.set(jid, { state: "menu" });
          await sock.sendMessage(jid, { text: MENU_TEXT });
          continue;
        }

        const session = sessions.get(jid);
        if (!session) continue; // ignora mensagens fora do fluxo, sem /bot não reagimos

        if (session.state === "menu") {
          const option = MENU_OPTIONS.find((o) => o.number === text || normalize(o.key) === text || text.includes(o.key));
          if (!option) {
            await sock.sendMessage(jid, { text: "Opção inválida. " + MENU_TEXT });
            continue;
          }

          if (option.key === "alocacao" || option.key === "minhas_tarefas") {
            sessions.set(jid, { state: "awaiting_name", purpose: option.key });
            await sock.sendMessage(jid, { text: "Qual é o seu nome completo (como está cadastrado no sistema)?" });
            continue;
          }

          if (option.key === "atualizacao_projetos") {
            const sites = await botGet("/bot/sites/");
            if (!sites.length) {
              sessions.delete(jid);
              await sock.sendMessage(jid, { text: "Não encontrei nenhum site com projeto ativo no momento." });
              continue;
            }
            sessions.set(jid, { state: "select_site", sites });
            const list = sites.map((s, i) => `${i + 1}️⃣ ${s.name}`).join("\n");
            await sock.sendMessage(jid, { text: `Qual site?\n\n${list}\n\nDigite o número.` });
            continue;
          }
        }

        if (session.state === "select_site") {
          const index = parseInt(text, 10) - 1;
          const site = session.sites[index];
          if (!site) {
            await sock.sendMessage(jid, { text: "Número inválido. Digite o número de um dos sites da lista, ou /bot para recomeçar." });
            continue;
          }

          const projects = await botGet("/bot/projects/", { site_id: site.id });
          if (!projects.length) {
            sessions.delete(jid);
            await sock.sendMessage(jid, { text: `Não há projetos ativos em ${site.name} no momento.` });
            continue;
          }
          sessions.set(jid, { state: "select_project", site, projects });
          const list = projects.map((p, i) => `${i + 1}️⃣ ${p.code ? `${p.code} - ` : ""}${p.name}`).join("\n");
          await sock.sendMessage(jid, {
            text: `Projetos ativos em ${site.name}:\n\n${list}\n\n0️⃣ Todos os projetos ativos deste site\n\nDigite o número.`,
          });
          continue;
        }

        if (session.state === "select_project") {
          const { site, projects } = session;
          sessions.delete(jid);

          if (text === "0" || text.includes("todos")) {
            const updates = await botGet("/bot/project-update/", { site_id: site.id });
            for (const update of updates) {
              await sock.sendMessage(jid, { text: formatProjectUpdate(update) });
            }
            continue;
          }

          const index = parseInt(text, 10) - 1;
          const project = projects[index];
          if (!project) {
            await sock.sendMessage(jid, { text: "Número inválido. Digite /bot para recomeçar." });
            continue;
          }
          const [update] = await botGet("/bot/project-update/", { project_id: project.id });
          await sock.sendMessage(jid, { text: formatProjectUpdate(update) });
          continue;
        }

        if (session.state === "awaiting_name") {
          const { purpose } = session;
          sessions.delete(jid);
          const reply =
            purpose === "minhas_tarefas" ? await fetchMyTasksByName(rawText) : await fetchAllocationByName(rawText);
          await sock.sendMessage(jid, { text: reply });
          continue;
        }
      } catch (err) {
        console.error(`Erro ao responder ${jid}:`, err.message);
        sessions.delete(jid);
        try {
          await sock.sendMessage(jid, { text: "Desculpe, deu um erro. Digite /bot para começar de novo." });
        } catch {
          // ignora falha ao enviar a mensagem de erro
        }
      }
    }
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Promise rejeitada sem tratamento:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Exceção não capturada:", err);
});

start().catch((err) => {
  console.error("Falha ao iniciar o bot:", err);
  process.exit(1);
});
