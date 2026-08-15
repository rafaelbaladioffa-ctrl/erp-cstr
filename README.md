# ERP CSTR

Base do ERP construída com Django Admin e PostgreSQL, executada integralmente em containers. O frontend React será iniciado depois que as regras de negócio forem validadas no Admin.

## Requisitos

- Docker Desktop (ou Docker Engine com Docker Compose)

## Executar pela primeira vez

1. Copie `.env.example` para `.env` e altere as senhas e a chave secreta.
2. Execute:

```powershell
docker compose up --build
```

3. Acesse:

- Admin: http://localhost:8000/admin/
- Health check: http://localhost:8000/health/

As migrações, os arquivos estáticos e o superusuário inicial são preparados automaticamente na inicialização.

## Comandos úteis

```powershell
# Executar os testes
docker compose run --rm backend python manage.py test

# Criar outro administrador
docker compose run --rm backend python manage.py createsuperuser

# Gerar migrações depois de alterar modelos
docker compose run --rm backend python manage.py makemigrations

# Parar os serviços sem apagar os dados
docker compose down
```

Os dados do PostgreSQL e os arquivos enviados ficam em volumes Docker. `docker compose down -v` apaga esses volumes e, portanto, deve ser usado somente quando a perda dos dados for intencional.

## Organização inicial

- `backend/config`: configuração do projeto Django.
- `backend/core`: cadastros compartilhados, começando por empresas.
- `backend/users`: usuários, grupos, permissões e vínculo com empresa.
- `docker/backend`: imagem e inicialização do backend.

## Próxima etapa funcional

Antes de criar módulos, devem ser definidos os processos reais da empresa. Uma sequência comum é: cadastros básicos, comercial/vendas, compras, estoque, financeiro, fiscal e relatórios. Cada módulo deve ser validado no Django Admin antes de expor sua API ao futuro frontend React.
