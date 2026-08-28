const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const axios = require("axios");

const API_URL = process.env.BOT_API_URL || "http://backend:8000/api";
const API_SECRET = process.env.BOT_API_SECRET || "";
const AUTH_DIR = process.env.AUTH_DIR || "/app/auth_info";

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

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("Escaneie o QR Code abaixo com o WhatsApp (Aparelhos conectados > Conectar um aparelho):");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Conexão com o WhatsApp fechada.", shouldReconnect ? "Reconectando..." : "Sessão deslogada — apague o volume de auth e escaneie o QR de novo.");
      if (shouldReconnect) start();
    } else if (connection === "open") {
      console.log("Bot conectado ao WhatsApp com sucesso.");
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

start().catch((err) => {
  console.error("Falha ao iniciar o bot:", err);
  process.exit(1);
});
