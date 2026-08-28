const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const axios = require("axios");

const API_URL = process.env.BOT_API_URL || "http://backend:8000/api";
const API_SECRET = process.env.BOT_API_SECRET || "";
const AUTH_DIR = process.env.AUTH_DIR || "/app/auth_info";

const logger = pino({ level: "warn" });

function formatDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

async function buildReply(phone) {
  const { data } = await axios.get(`${API_URL}/bot/allocation/`, {
    params: { phone },
    headers: { "X-Bot-Secret": API_SECRET },
    timeout: 10000,
  });

  if (!data.found) {
    return "Não encontrei seu número cadastrado no sistema. Fale com seu gestor pra atualizar seu telefone no cadastro de Técnicos.";
  }
  if (!data.allocations.length) {
    return `Olá, ${data.collaborator_name}! Você ainda não tem uma alocação registrada para hoje (${formatDate(data.date)}).`;
  }
  const lines = data.allocations.map(
    (a) => `• ${a.project}${a.code ? ` (${a.code})` : ""} — Site: ${a.site || "não informado"}`
  );
  return `Olá, ${data.collaborator_name}! Sua alocação de hoje (${formatDate(data.date)}):\n\n${lines.join("\n")}`;
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
      // O WhatsApp às vezes manda o remoteJid como "@lid" (um id opaco, não o
      // telefone) em vez do JID clássico "@s.whatsapp.net" — quando isso
      // acontece, o telefone de verdade (se disponível) vem em remoteJidAlt.
      const phoneJid = jid.endsWith("@lid") && msg.key.remoteJidAlt ? msg.key.remoteJidAlt : jid;
      const phone = phoneJid.split("@")[0];
      try {
        const reply = await buildReply(phone);
        await sock.sendMessage(jid, { text: reply });
      } catch (err) {
        console.error(`Erro ao responder ${phone}:`, err.message);
        try {
          await sock.sendMessage(jid, { text: "Desculpe, deu um erro ao consultar sua alocação. Tenta de novo em alguns minutos." });
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
