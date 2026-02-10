# Используем официальный Node.js образ (Alpine для меньшего размера)
FROM node:18-alpine

# Не устанавливаем дополнительные пакеты - используем Node.js для health check
# Это быстрее и надежнее

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json
COPY package.json ./

# Устанавливаем зависимости
RUN npm install --only=production

# Копируем остальные файлы приложения
COPY . .

# Создаем непривилегированного пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Открываем порт
EXPOSE 3333

# Запускаем приложение
CMD ["node", "server.js"]
