# ERP CSTR — Contexto do Projeto

Sistema ERP interno para gestão de obras de cabeamento estruturado em data centers hyperscale.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Django 4 + Django REST Framework |
| Frontend | React + Vite + TypeScript |
| Bot | Node.js + Baileys (WhatsApp Web) + Puppeteer |
| Banco | PostgreSQL |
| Infra | Docker Compose (monorepo único) |

## Estrutura do repositório

```
backend/       Django — API, modelos, apps por domínio
frontend/      React — páginas, componentes, estilos
bot/           Node.js — bot WhatsApp + Puppeteer
docker/        Dockerfiles por serviço
compose.yaml / compose.prod.yaml
```

## Apps Django

| App | Responsabilidade |
|-----|-----------------|
| `core` | Catálogos base: Site, ActivityType, ProjectType, Category |
| `projects` | Project, ProjectTask, WorkBlock, ProjectItem, TaskDependency |
| `api` | Todos os endpoints REST (views.py, operations.py, dashboard.py) |
| `dispatch` | Fila de despacho de tarefas |
| `technical` | Proxy MyTask para visão do técnico |
| `bot` | BotSubscriber, views do bot, ProjectProgressSnapshot |
| `users` | Collaborator, User, autenticação |
| `audit` | AuditLog (diff automático por signal) |
| `updates` | Atualizações de projeto ao cliente por e-mail |
| `master_data` | Catálogo mestre assistido por IA |

---

## Deploy no servidor

O servidor é acessado via SSH pelo alias `notebook-servidor`.
O código roda via Docker Compose em WSL (Ubuntu) no Windows Server.

### Fluxo de deploy padrão

```bash
ssh notebook-servidor "wsl.exe -d Ubuntu bash -c \"
  cd /home/server-cstr/erp-cstr &&
  git pull origin main &&
  docker compose -f compose.yaml -f compose.prod.yaml build <serviço> &&
  docker compose -f compose.yaml -f compose.prod.yaml up -d --force-recreate <serviço> &&
  docker compose ps <serviço>
\""
```

Serviços disponíveis: `backend`, `frontend`, `bot`, `db`, `nginx`.

### Antes de qualquer build: corrigir credenciais Docker no WSL

Após reiniciar o WSL ou o Docker Desktop, `~/.docker/config.json` reverte para
`{"credsStore":"desktop.exe"}`, fazendo o build falhar silenciosamente.

```bash
ssh notebook-servidor "wsl.exe -d Ubuntu bash -c \"echo '{\"credsStore\":\"\"}' > ~/.docker/config.json\""
```

---

## Regras de segurança — NUNCA violar

- **NUNCA usar `docker compose down -v`** — apaga o volume do banco de dados em produção.
- **NUNCA printar ou exibir** a variável `WHATSAPP_BOT_SECRET`, `OPENROUTER_API_KEY` ou qualquer `_SECRET`/`_KEY` do `.env`.
- **`docker compose restart <serviço>` NÃO relê o `.env`** — após mudar env vars, usar `up -d --force-recreate`.
- **Migrações sempre aditivas** — nunca remover coluna ou tabela sem deprecação prévia.
- **Nunca commitar** arquivos `.env`, `auth_info_baileys/`, `media/`, `staticfiles/`.

---

## Git e auto-commit

Repositório: `git@github.com:rafaelbaladioffa-ctrl/erp-cstr.git`

O Claude deve fazer commit e push automaticamente ao concluir cada tarefa:

```bash
git add <arquivos alterados>
git commit -m "mensagem descritiva"
git push origin main
```

**Nunca usar `git add -A` sem revisar o status primeiro** — evitar commitar `.env` ou arquivos de sessão.

---

## Timezone

UTC−3 fixo (Brasil). Nunca usar pacotes de timezone — a função `formatBrazilDateTime()` já existe no bot e subtrai 3 h manualmente.

## Testes

```bash
# Backend
ssh notebook-servidor "wsl.exe -d Ubuntu bash -c \"cd /home/server-cstr/erp-cstr && docker compose exec backend python manage.py test\""
```
