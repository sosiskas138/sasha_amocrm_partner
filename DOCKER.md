# Docker инструкции

## Быстрый старт

### 1. Подготовка

Убедитесь, что у вас есть файл `.env` с необходимыми переменными:
```bash
PORT=3000
WEBHOOK_SECRET=your_webhook_secret_here
BITRIX_WEBHOOK_URL=https://your-domain.bitrix24.ru/rest/1/webhook_code/
```

### 2. Запуск через docker-compose (рекомендуется)

```bash
# Запуск в фоновом режиме
docker-compose up -d

# Просмотр логов
docker-compose logs -f

# Остановка
docker-compose down
```

### 3. Запуск через Docker напрямую

```bash
# Сборка образа
docker build -t sasha-webhook-bitrix .

# Запуск контейнера
docker run -d \
  --name sasha-webhook-bitrix \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  sasha-webhook-bitrix

# Просмотр логов
docker logs -f sasha-webhook-bitrix

# Остановка и удаление
docker stop sasha-webhook-bitrix
docker rm sasha-webhook-bitrix
```

## Проверка работоспособности

После запуска проверьте:

```bash
# Health check
curl http://localhost:3000/health

# Должен вернуться:
# {"status":"ok","timestamp":"...","service":"sasha-webhook-to-bitrix"}
```

## Настройка портов

Если нужно изменить порт, отредактируйте `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"  # Внешний порт:Внутренний порт
```

Или при запуске через `docker run`:

```bash
docker run -d -p 8080:3000 ...
```

## Обновление кода

### С docker-compose (для разработки)

Файлы монтируются как volumes, поэтому изменения применяются автоматически после перезапуска:

```bash
docker-compose restart
```

### С Docker (нужна пересборка)

```bash
# Остановите контейнер
docker stop sasha-webhook-bitrix
docker rm sasha-webhook-bitrix

# Пересоберите образ
docker build -t sasha-webhook-bitrix .

# Запустите заново
docker run -d --name sasha-webhook-bitrix -p 3000:3000 --env-file .env sasha-webhook-bitrix
```

## Продакшн настройки

Для продакшена рекомендуется:

1. **Убрать volumes из docker-compose.yml** (чтобы использовать код из образа, а не с хоста)
2. **Использовать переменные окружения напрямую** вместо `.env` файла
3. **Настроить reverse proxy** (nginx, traefik) для HTTPS
4. **Использовать Docker secrets** для чувствительных данных

Пример продакшн docker-compose.yml:

```yaml
version: '3.8'

services:
  webhook-server:
    build: .
    container_name: sasha-webhook-bitrix
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - WEBHOOK_SECRET=${WEBHOOK_SECRET}
      - BITRIX_WEBHOOK_URL=${BITRIX_WEBHOOK_URL}
    restart: always
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Troubleshooting

### Контейнер не запускается

Проверьте логи:
```bash
docker-compose logs
# или
docker logs sasha-webhook-bitrix
```

### Порт занят

Измените порт в `docker-compose.yml` или остановите процесс, использующий порт 3000.

### Переменные окружения не загружаются

Убедитесь, что файл `.env` существует и находится в корне проекта рядом с `docker-compose.yml`.

### Health check не проходит

Проверьте, что сервер запустился:
```bash
docker exec sasha-webhook-bitrix wget -qO- http://localhost:3000/health
```
