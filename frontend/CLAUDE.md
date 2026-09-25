# Módulo: Frontend

React + Vite + TypeScript. Interface do ERP CSTR.

> Herda as regras de deploy e segurança de `/CLAUDE.md` na raiz do repositório.

---

## Stack e convenções

- **React 18 + TypeScript** — sem Redux, estado local via `useState`/`useEffect`
- **Vite** para bundling
- **CSS puro** em `src/index.css` — sem Tailwind, sem CSS Modules
- **Sem biblioteca de gráficos** — barras e anéis são `<div>` com `width: %`
- **Ícones** via `<Icon name="..." />` (Material Symbols, carregados via Google Fonts)
- **Roteamento** via `react-router-dom` em `src/App.tsx`

## Estrutura

```
src/
  api/
    resources.ts    — todos os clientes HTTP (crud<T>, helpers por entidade)
    types.ts        — interfaces TypeScript de todos os modelos
  components/
    ui/             — Button, Icon, PageHeader, Modal, DynamicForm...
    projects/       — componentes específicos de projetos
    cadastros/      — EntityForm, EntityTable para cadastros genéricos
    master-data/    — componentes do catálogo mestre
  pages/
    Dashboard.tsx
    ProjectsList.tsx / ProjectDetail.tsx
    OperationsBoard.tsx     — Central de Operações (pool + técnicos + drag-and-drop)
    TimelineOperacional.tsx — Gantt por técnico
    OperationsReports.tsx
    MyTasks.tsx             — visão do técnico (proxy)
    AuditLog.tsx
    DailyUpdates.tsx
    SitesMap.tsx
    Login.tsx / ForcePasswordChange.tsx
    cadastros/CadastrosPage.tsx   — CRUD genérico via EntityConfig
    master-data/MasterDataPage.tsx
  utils/
    timeline.ts     — helpers de Gantt (assignLanes, buildTechSegments, pct...)
  index.css         — variáveis CSS, componentes base, estilos de cada página
  App.tsx           — rotas e RequirePermission
```

## Padrão de API

Todos os clientes ficam em `src/api/resources.ts`. Usar sempre o helper `crud<T>()`:

```ts
export const projectsApi = {
  ...crud<Project>("/api/projects/"),
  timeline: (siteId, date) => api.get<OperationsTimeline>(`/api/operations/timeline/`, { params: { site_id: siteId, date } }),
};
```

Nunca fazer `fetch()` direto nos componentes.

## CSS

Todas as variáveis de cor estão em `:root` no início de `index.css`:
- `--primary`, `--primary-hover` — botões e links
- `--surface`, `--surface-2` — cards e painéis
- `--border` — bordas
- `--text`, `--text-muted`, `--text-faint` — hierarquia de texto
- `--success`, `--warning`, `--danger` — status

**Dark mode:** definido via `[data-theme="dark"]` no `body`. Não usar `prefers-color-scheme` diretamente nos componentes — só no CSS global.

## Temas / permissões na UI

`src/utils/permissions.ts` expõe `PERMS` e `modelPerms()`. Usar `RequirePermission` no `App.tsx` e `hasPermission(user, PERMS.xxx)` dentro dos componentes.

## Popup de barra (timeline e operações)

Popups de clique em barra devem ser renderizados **na raiz do componente**, fora de qualquer container com `overflow: hidden`. Usar um `div` backdrop `position: fixed, inset: 0` + o popup com `position: fixed`. Ver `TimelineOperacional.tsx` como referência.

## Drag-and-drop (pool → técnico)

Implementado com a API nativa HTML5 (`draggable`, `onDragStart`, `onDragOver`, `onDrop`). Não usar biblioteca externa. Ver `OperationsBoard.tsx` como referência.

---

## Deploy do frontend

```bash
# Build e deploy completo
ssh notebook-servidor "wsl.exe -d Ubuntu bash -c \"
  cd /home/server-cstr/erp-cstr &&
  git pull origin main &&
  docker compose -f compose.yaml -f compose.prod.yaml build frontend &&
  docker compose -f compose.yaml -f compose.prod.yaml up -d --force-recreate frontend &&
  docker compose ps frontend
\""
```

**Antes do build:** corrigir credenciais Docker no WSL se necessário (ver CLAUDE.md raiz).

## Verificação de tipos local

```bash
npx tsc --noEmit
```

---

## Auto-commit

Ao concluir alterações no frontend, commitar apenas os arquivos alterados:

```bash
git add frontend/src/...
git commit -m "descrição da alteração"
git push origin main
```
