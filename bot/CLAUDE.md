# Módulo: Bot WhatsApp

Node.js + Baileys (`@whiskeysockets/baileys`). Automação e broadcast via WhatsApp Web.

> Herda as regras de deploy e segurança de `/CLAUDE.md` na raiz do repositório.

---

## Arquivos principais

```
bot/
  index.js          — bot completo (799 linhas): conexão Baileys, menu, broadcasts, HTTP :3001
  package.json
  auth_info_baileys/ — sessão WhatsApp persistida (nunca commitar)

backend/bot/          — Django app do bot
  models.py           — BotSubscriber, ProjectProgressSnapshot
  views.py            — todos os endpoints /api/bot/* (590 linhas)
  urls.py
```

---

## Como o bot funciona

### Conexão
Baileys mantém sessão em `auth_info_baileys/`. Na primeira execução gera QR Code disponível em `http://localhost:3001/qr`. Reconecta automaticamente em queda.

### Menu interativo
Usuário manda qualquer mensagem → bot responde com menu. Estado da conversa em `Map<JID, estado>`:
- **1** Alocação (projeto/site de hoje)
- **2** Atualização de projetos
- **3** Minhas tarefas
- **4** Status dos técnicos

### Broadcasts agendados
`setInterval` a cada 60 s verifica horários UTC. `lastRunDateKey` garante 1 disparo/dia.

| Horário BR | UTC | Broadcast |
|-----------|-----|-----------|
| 08h | 11:00 | Print da Operação #1 |
| 10h | 13:00 | Tarefas do dia + Print #2 |
| 12h | 15:00 | Print #3 |
| 14h | 17:00 | Print #4 |
| 15h | 18:00 | Relatório de Projetos (texto) |
| 15h01 | 18:01 | Relatório de Projetos (imagem) |
| 16h | 19:00 | Print #5 |
| 17h | 20:00 | Atualizações de projetos |
| 18h | 21:00 | Alocação do dia seguinte + Print #6 |

### Servidor HTTP :3001 (triggers manuais)
```
GET /qr                     — QR Code HTML
GET /qr.png                 — QR Code imagem
GET /groups                 — lista grupos (JID + nome)
GET /trigger-operations-print?to=<jid>
GET /trigger-daily-project-report-image?to=<jid>&limit=<n>
GET /trigger-<key>?to=<jid>
```

---

## API Django — backend/bot/views.py

Autenticação: header `X-Bot-Secret`. Chave em `WHATSAPP_BOT_SECRET` (env).

Endpoints interativos:
- `GET /api/bot/allocation/?name=`
- `GET /api/bot/my-tasks/?name=`
- `GET /api/bot/sites/`
- `GET /api/bot/tech-status/sites/`
- `GET /api/bot/tech-status/?site_id=`
- `GET /api/bot/projects/?site_id=`
- `GET /api/bot/project-update/?project_id=`

Endpoints de broadcast:
- `GET /api/bot/broadcasts/daily-tasks/?date=`
- `GET /api/bot/broadcasts/project-updates/`
- `GET /api/bot/broadcasts/daily-project-report/?date=`
- `GET /api/bot/broadcasts/operations-print-recipients/`

---

## Modelo BotSubscriber

Flags booleanas por assinante: `daily_tasks`, `daily_report`, `daily_report_image`, `project_updates`, `allocation`, `operations_print`.

Campos de destinatário: `phone` (número sem código de país — bot adiciona `55`) **ou** `group_jid` (`120363XXXXX@g.us`).

Para descobrir JID de grupos:
```bash
docker exec bot curl http://localhost:3001/groups
```

---

## Puppeteer

- **Print da Operação:** `captureOperationsPrint()` — URL `http://frontend:3000/operations-print`, viewport 1260×900, deviceScaleFactor 2
- **Print do Relatório:** `captureDailyProjectReportPrint(date, limit)` — URL com `?date=&limit=`, viewport 780×1200

---

## Timezone

UTC−3 fixo (Brasil). Função `formatBrazilDateTime()` subtrai 3 h sem depender de `tzdata`.

## Rate limiting

800 ms de delay após cada `sock.sendMessage()`.

---

## Segurança

- **NUNCA** exibir o valor de `WHATSAPP_BOT_SECRET` em log, output ou commit.
- A pasta `auth_info_baileys/` está no `.gitignore` — nunca remover essa entrada.

---

## Deploy do bot

```bash
ssh notebook-servidor "wsl.exe -d Ubuntu bash -c \"
  cd /home/server-cstr/erp-cstr &&
  git pull origin main &&
  docker compose -f compose.yaml -f compose.prod.yaml build bot &&
  docker compose -f compose.yaml -f compose.prod.yaml up -d --force-recreate bot &&
  docker compose ps bot
\""
```

Ao alterar apenas `backend/bot/`, o serviço a rebuildar é `backend`, não `bot`.

---

## Auto-commit

```bash
git add bot/ backend/bot/
git commit -m "descrição da alteração"
git push origin main
```
