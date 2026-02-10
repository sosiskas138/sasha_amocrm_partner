const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { leadMapping, contactMapping, applyMapping } = require('./mapping');
require('dotenv').config();

const app = express();
// PORT используется для внешнего доступа, CONTAINER_PORT для Docker контейнера
const PORT = process.env.CONTAINER_PORT || process.env.PORT || 3333;

// Middleware для получения сырого тела запроса ТОЛЬКО для /webhook (нужно для проверки подписи)
// Важно: это должно быть ДО express.json(), чтобы Express не пытался парсить JSON дважды
// Используем express.text() для получения строки, как в документации
app.use('/webhook', express.text({ 
  type: 'application/json',  // Принимаем application/json
  limit: '10mb' // Лимит размера тела запроса
}));

// Middleware для парсинга JSON в других роутах (НЕ для /webhook)
// Express автоматически пропустит /webhook, т.к. тело уже обработано express.raw()
app.use(express.json({ limit: '10mb' }));

// Middleware для логирования входящих запросов
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  
  // Логируем тело запроса
  if (req.body) {
    if (typeof req.body === 'string') {
      // Для /webhook (express.text())
      console.log('Body:', req.body);
    } else if (typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      // Для других роутов (express.json())
      console.log('Body:', JSON.stringify(req.body, null, 2));
    }
  }
  
  next();
});

/**
 * 
 * @param {Object} payload 
 * @param {String} signature 
 * @param {String} secret 
 * @returns {Boolean}
 */
function verifyWebhookSignature(payload, signature, secret) {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/**
 * Получение базового URL для amoCRM API
 */
function getAmoCRMBaseUrl() {
  const subdomain = process.env.AMOCRM_SUBDOMAIN;
  if (!subdomain) {
    throw new Error('AMOCRM_SUBDOMAIN не установлен в переменных окружения');
  }
  return `https://${subdomain}.amocrm.ru`;
}

/**
 * Получение токена авторизации для amoCRM
 */
function getAmoCRMToken() {
  const token = process.env.AMOCRM_ACCESS_TOKEN;
  if (!token) {
    throw new Error('AMOCRM_ACCESS_TOKEN не установлен в переменных окружения');
  }
  return token;
}

/**
 * Создание или обновление контакта в amoCRM
 * @param {Object} data - Данные в формате вебхука от Sasha AI
 * @returns {Promise<Object>} - Результат создания/обновления контакта
 */
async function createOrUpdateContactInAmoCRM(data) {
  const baseUrl = getAmoCRMBaseUrl();
  const token = getAmoCRMToken();
  
  // Применяем маппинг для преобразования данных вебхука в поля amoCRM
  const contactFields = applyMapping(data, contactMapping);
  
  // Формируем данные для отправки в amoCRM
  const contactData = [contactFields];
  
  try {
    const url = `${baseUrl}/api/v4/contacts`;
    
    const response = await axios.post(
      url,
      contactData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    // amoCRM возвращает объект с _embedded.contacts[0].id
    const contactId = response.data?._embedded?.contacts?.[0]?.id;
    
    return {
      success: true,
      contactId: contactId,
      data: response.data
    };
  } catch (error) {
    console.error('Ошибка при создании/обновлении контакта в amoCRM:', error.response?.data || error.message);
    throw new Error(`Ошибка при создании/обновлении контакта в amoCRM: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Функция для создания сделки в amoCRM
 * Использует маппинг из mapping.js для преобразования данных
 * @param {Object} data - Данные в формате вебхука от Sasha AI
 * @param {String} contactId - ID контакта для связи
 * @returns {Promise<Object>} - Результат создания сделки в amoCRM
 */
async function createLeadInAmoCRM(data, contactId) {
  const baseUrl = getAmoCRMBaseUrl();
  const token = getAmoCRMToken();
  
  // Применяем маппинг для преобразования данных вебхука в поля amoCRM
  const leadFields = applyMapping(data, leadMapping);
  
  // Добавляем связь с контактом, если он был создан
  // Формат для amoCRM API v2: contacts_id должен быть массивом ID
  if (contactId) {
    // Преобразуем contactId в число, если это строка
    const contactIdNum = typeof contactId === 'string' ? parseInt(contactId) : contactId;
    leadFields.contacts_id = [contactIdNum];
  }
  
  // Формируем данные для отправки в amoCRM (требуется массив)
  const leadData = [leadFields];
  
  try {
    const url = `${baseUrl}/api/v4/leads`;
    
    const response = await axios.post(
      url,
      leadData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    // amoCRM возвращает объект с _embedded.leads[0].id
    const leadId = response.data?._embedded?.leads?.[0]?.id;
    
    return {
      success: true,
      leadId: leadId,
      data: response.data
    };
  } catch (error) {
    console.error('Ошибка при создании сделки в amoCRM:', error.response?.data || error.message);
    throw new Error(`Ошибка при создании сделки в amoCRM: ${error.response?.data?.error || error.message}`);
  }
}

/**
 * Обработчик вебхука от Sasha AI
 */
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body; // Теперь это строка благодаря express.text()
  const secret = process.env.WEBHOOK_SECRET;
  
  // Проверка наличия необходимых данных
  if (!signature) {
    return res.status(401).send('Отсутствует заголовок X-Webhook-Signature');
  }
  
  if (!secret) {
    return res.status(500).send('WEBHOOK_SECRET не настроен');
  }
  
  if (!payload) {
    return res.status(400).send('Тело запроса пустое');
  }
  
  

  try {
    const data = JSON.parse(payload);
    
    // Валидация наличия данных
    if (!data || Object.keys(data).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Данные не предоставлены. Отправьте JSON в теле запроса'
      });
    }
    
    // Валидация обязательных полей
    if (!data.contact || !data.call) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: contact или call'
      });
    }
    
    // Создание/обновление контакта в amoCRM
    let contactId = null;
    try {
      const contactResult = await createOrUpdateContactInAmoCRM(data);
      contactId = contactResult.contactId;
      console.log(`Контакт создан/обновлен в amoCRM: ${contactId}`);
    } catch (error) {
      console.warn('Не удалось создать/обновить контакт:', error.message);
      // Продолжаем создание сделки даже если контакт не создан
    }
    
    // Создание сделки в amoCRM
    const result = await createLeadInAmoCRM(data, contactId);
    
    res.json({
      success: true,
      message: 'Сделка успешно создана в amoCRM',
      leadId: result.leadId,
      contactId: contactId,
      data: result.data
    });
  } catch (error) {
    console.error('Ошибка при обработке запроса:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * Тестовый endpoint: отправка сделки в amoCRM вручную.
 *
 * Использование:
 * - POST /test/amocrm/lead
 * - Content-Type: application/json
 * - Body: JSON в формате вебхука Sasha AI (или частично — важны contact + call)
 *
 * Важно: endpoint не проверяет подпись и предназначен только для тестов.
 */
app.post('/test/amocrm/lead', async (req, res) => {
  try {
    const data = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Данные не предоставлены. Отправьте JSON в теле запроса'
      });
    }

    // Минимальная валидация как в /webhook
    if (!data.contact || !data.call) {
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: contact или call'
      });
    }

    // Создание/обновление контакта в amoCRM
    let contactId = null;
    try {
      const contactResult = await createOrUpdateContactInAmoCRM(data);
      contactId = contactResult.contactId;
      console.log(`Тестовый контакт создан/обновлен в amoCRM: ${contactId}`);
    } catch (error) {
      console.warn('Не удалось создать/обновить тестовый контакт:', error.message);
    }

    const result = await createLeadInAmoCRM(data, contactId);

    return res.json({
      success: true,
      message: 'Тестовая сделка успешно создана в amoCRM',
      leadId: result.leadId,
      contactId: contactId,
      data: result.data
    });
  } catch (error) {
    console.error('Ошибка при тестовой отправке в amoCRM:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера'
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'sasha-webhook-to-amocrm'
  });
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  
  if (!process.env.WEBHOOK_SECRET) {
    console.warn('⚠️  ВНИМАНИЕ: WEBHOOK_SECRET не установлен. Проверка подписи отключена!');
  }
  
  if (!process.env.AMOCRM_SUBDOMAIN) {
    console.warn('⚠️  ВНИМАНИЕ: AMOCRM_SUBDOMAIN не установлен. Отправка в amoCRM не будет работать!');
  }
  
  if (!process.env.AMOCRM_ACCESS_TOKEN) {
    console.warn('⚠️  ВНИМАНИЕ: AMOCRM_ACCESS_TOKEN не установлен. Отправка в amoCRM не будет работать!');
  }
});
