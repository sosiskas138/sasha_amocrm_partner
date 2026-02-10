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
  
  if (!subdomain || subdomain.trim() === '') {
    throw new Error('Ошибка при отправке вебхука: Invalid URL - AMOCRM_SUBDOMAIN не установлен в переменных окружения. Проверьте файл .env');
  }
  
  // Очищаем subdomain от лишних символов (пробелы, слэши и т.д.)
  const cleanSubdomain = subdomain.trim().replace(/[^a-zA-Z0-9-]/g, '');
  
  if (!cleanSubdomain || cleanSubdomain.length === 0) {
    throw new Error('Ошибка при отправке вебхука: Invalid URL - AMOCRM_SUBDOMAIN содержит недопустимые символы или пустой. Укажите поддомен вашего аккаунта amoCRM (например: mycompany для mycompany.amocrm.ru)');
  }
  
  const baseUrl = `https://${cleanSubdomain}.amocrm.ru`;
  
  // Валидация URL
  try {
    const url = new URL(baseUrl);
    if (!url.hostname || !url.hostname.includes('amocrm.ru')) {
      throw new Error('Некорректный домен');
    }
  } catch (error) {
    throw new Error(`Ошибка при отправке вебхука: Invalid URL - некорректный формат URL для amoCRM: ${baseUrl}. Проверьте значение AMOCRM_SUBDOMAIN в файле .env`);
  }
  
  return baseUrl;
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
  
  // Валидация обязательных полей контакта
  if (!contactFields.name) {
    throw new Error('Не удалось создать название контакта. Проверьте данные вебхука.');
  }
  
  // Формируем данные для отправки в amoCRM
  const contactData = [contactFields];
  
  // Логируем данные перед отправкой (для отладки)
  console.log('Данные контакта для отправки в amoCRM:', JSON.stringify(contactData, null, 2));
  
  try {
    const url = `${baseUrl}/api/v4/contacts`;
    
    // Валидация URL перед запросом
    try {
      new URL(url);
    } catch (urlError) {
      console.error('Некорректный URL:', url);
      throw new Error(`Invalid URL: ${url}`);
    }
    
    console.log(`Отправка запроса на создание контакта: ${url}`);
    
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
    console.error('❌ Ошибка при создании/обновлении контакта в amoCRM:');
    console.error('URL:', `${baseUrl}/api/v4/contacts`);
    console.error('Ошибка:', error.message);
    console.error('Код ошибки:', error.code);
    
    if (error.response) {
      console.error('Статус ответа:', error.response.status);
      console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
      console.error('Заголовки ответа:', JSON.stringify(error.response.headers, null, 2));
    } else if (error.request) {
      console.error('Запрос был отправлен, но ответ не получен');
      console.error('Детали запроса:', error.request);
    } else {
      console.error('Детали ошибки:', error.message);
    }
    
    if (error.message.includes('Invalid URL') || error.code === 'ERR_INVALID_URL') {
      throw new Error(`Ошибка при отправке вебхука: Invalid URL - проверьте AMOCRM_SUBDOMAIN в .env`);
    }
    
    // Формируем понятное сообщение об ошибке
    let errorMessage = 'Ошибка при создании/обновлении контакта в amoCRM';
    if (error.response?.data) {
      if (error.response.data.error) {
        errorMessage = error.response.data.error;
      } else if (error.response.data.detail) {
        errorMessage = error.response.data.detail;
      } else if (error.response.data.title) {
        errorMessage = error.response.data.title;
      } else if (typeof error.response.data === 'string') {
        errorMessage = error.response.data;
      } else {
        errorMessage = `Ошибка API: ${JSON.stringify(error.response.data)}`;
      }
    } else {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
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
  
  // Валидация обязательных полей
  if (!leadFields.name) {
    throw new Error('Не удалось создать название сделки. Проверьте данные вебхука.');
  }
  
  if (!leadFields.pipeline_id) {
    throw new Error('AMOCRM_PIPELINE_ID не установлен в переменных окружения. Это обязательное поле для создания сделки.');
  }
  
  // Преобразуем pipeline_id и status_id в числа, если они строки
  if (leadFields.pipeline_id) {
    leadFields.pipeline_id = parseInt(leadFields.pipeline_id);
    if (isNaN(leadFields.pipeline_id)) {
      throw new Error(`Некорректный формат AMOCRM_PIPELINE_ID: "${process.env.AMOCRM_PIPELINE_ID}". Должно быть число.`);
    }
  }
  
  if (leadFields.status_id) {
    leadFields.status_id = parseInt(leadFields.status_id);
    if (isNaN(leadFields.status_id)) {
      throw new Error(`Некорректный формат AMOCRM_STATUS_ID: "${process.env.AMOCRM_STATUS_ID}". Должно быть число.`);
    }
  }
  
  // Добавляем связь с контактом, если он был создан
  // Формат для amoCRM API v4: используется _embedded.contacts с массивом объектов
  if (contactId) {
    // Преобразуем contactId в число, если это строка
    const contactIdNum = typeof contactId === 'string' ? parseInt(contactId) : contactId;
    if (!isNaN(contactIdNum) && contactIdNum > 0) {
      // Инициализируем _embedded, если его еще нет
      if (!leadFields._embedded) {
        leadFields._embedded = {};
      }
      leadFields._embedded.contacts = [
        {
          id: contactIdNum,
          is_main: true  // Помечаем как основной контакт
        }
      ];
    }
  }
  
  // Формируем данные для отправки в amoCRM (требуется массив)
  const leadData = [leadFields];
  
  // Логируем данные перед отправкой (для отладки)
  console.log('Данные для отправки в amoCRM:', JSON.stringify(leadData, null, 2));
  
  try {
    const url = `${baseUrl}/api/v4/leads`;
    
    // Валидация URL перед запросом
    try {
      new URL(url);
    } catch (urlError) {
      console.error('Некорректный URL:', url);
      throw new Error(`Invalid URL: ${url}`);
    }
    
    console.log(`Отправка запроса на создание сделки: ${url}`);
    
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
    console.error('❌ Ошибка при создании сделки в amoCRM:');
    console.error('URL:', `${baseUrl}/api/v4/leads`);
    console.error('Ошибка:', error.message);
    console.error('Код ошибки:', error.code);
    
    if (error.response) {
      console.error('Статус ответа:', error.response.status);
      console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
      console.error('Заголовки ответа:', JSON.stringify(error.response.headers, null, 2));
    } else if (error.request) {
      console.error('Запрос был отправлен, но ответ не получен');
      console.error('Детали запроса:', error.request);
    } else {
      console.error('Детали ошибки:', error.message);
    }
    
    if (error.message.includes('Invalid URL') || error.code === 'ERR_INVALID_URL') {
      throw new Error(`Ошибка при отправке вебхука: Invalid URL - проверьте AMOCRM_SUBDOMAIN в .env`);
    }
    
    // Формируем понятное сообщение об ошибке
    let errorMessage = 'Ошибка при создании сделки в amoCRM';
    if (error.response?.data) {
      if (error.response.data.error) {
        errorMessage = error.response.data.error;
      } else if (error.response.data.detail) {
        errorMessage = error.response.data.detail;
      } else if (error.response.data.title) {
        errorMessage = error.response.data.title;
      } else if (typeof error.response.data === 'string') {
        errorMessage = error.response.data;
      } else {
        errorMessage = `Ошибка API: ${JSON.stringify(error.response.data)}`;
      }
    } else {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Обработчик вебхука от Sasha AI
 */
app.post('/webhook', async (req, res) => {
  console.log('📥 Получен вебхук от Sasha AI');
  
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
    let data;
    try {
      console.log('🔍 Начинаем парсинг JSON...');
      data = JSON.parse(payload);
      console.log('✅ JSON успешно распарсен');
    } catch (parseError) {
      console.error('❌ Ошибка парсинга JSON:', parseError.message);
      console.error('Первые 500 символов payload:', payload?.substring(0, 500));
      return res.status(400).json({
        success: false,
        error: 'Ошибка парсинга JSON',
        message: parseError.message
      });
    }
    
    // Валидация наличия данных
    console.log('🔍 Проверка наличия данных...');
    if (!data || Object.keys(data).length === 0) {
      console.error('❌ Данные не предоставлены или пусты');
      return res.status(400).json({
        success: false,
        error: 'Данные не предоставлены. Отправьте JSON в теле запроса'
      });
    }
    console.log('✅ Данные присутствуют, ключи:', Object.keys(data).join(', '));
    
    // Валидация обязательных полей
    console.log('🔍 Проверка обязательных полей (contact, call)...');
    if (!data.contact || !data.call) {
      console.error('❌ Отсутствуют обязательные поля: contact или call');
      console.error('   contact:', data.contact ? '✅ присутствует' : '❌ отсутствует');
      console.error('   call:', data.call ? '✅ присутствует' : '❌ отсутствует');
      return res.status(400).json({
        success: false,
        error: 'Отсутствуют обязательные поля: contact или call'
      });
    }
    console.log('✅ Обязательные поля присутствуют');
    console.log('📋 Начинаем создание/обновление контакта в amoCRM');
    
    // Создание/обновление контакта в amoCRM
    let contactId = null;
    try {
      const contactResult = await createOrUpdateContactInAmoCRM(data);
      contactId = contactResult.contactId;
      console.log(`✅ Контакт создан/обновлен в amoCRM: ${contactId}`);
    } catch (error) {
      console.error('❌ Не удалось создать/обновить контакт:', error.message);
      // Если ошибка связана с URL или обязательными полями, прерываем выполнение
      if (error.message.includes('Invalid URL') || error.message.includes('не установлен')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      // Продолжаем создание сделки даже если контакт не создан
      console.warn('⚠️ Продолжаем создание сделки без контакта');
    }
    
    console.log('📋 Начинаем создание сделки в amoCRM');
    
    // Создание сделки в amoCRM
    try {
      const result = await createLeadInAmoCRM(data, contactId);
      console.log(`✅ Сделка успешно создана в amoCRM: ${result.leadId}`);
      
      res.json({
        success: true,
        message: 'Сделка успешно создана в amoCRM',
        leadId: result.leadId,
        contactId: contactId,
        data: result.data
      });
    } catch (error) {
      // Если ошибка связана с URL, возвращаем понятное сообщение
      if (error.message.includes('Invalid URL')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      throw error; // Пробрасываем другие ошибки дальше
    }
  } catch (error) {
    console.error('❌❌❌ КРИТИЧЕСКАЯ ОШИБКА при обработке запроса:');
    console.error('Тип ошибки:', error.constructor.name);
    console.error('Сообщение:', error.message);
    console.error('Stack:', error.stack);
    
    // Если ошибка при парсинге JSON
    if (error instanceof SyntaxError) {
      console.error('❌ Ошибка парсинга JSON:', error.message);
      if (payload) {
        console.error('Попытка распарсить:', payload.substring(0, 200));
      }
    }
    
    // Логируем детали ошибки от amoCRM, если есть
    if (error.response) {
      console.error('Статус ответа:', error.response.status);
      console.error('Данные ответа:', JSON.stringify(error.response.data, null, 2));
      console.error('Заголовки ответа:', JSON.stringify(error.response.headers, null, 2));
    } else if (error.request) {
      console.error('Запрос был отправлен, но ответ не получен');
      console.error('Детали запроса:', error.request);
    }
    
    // Логируем переменные окружения (без секретов)
    console.error('Проверка переменных окружения:');
    console.error('AMOCRM_SUBDOMAIN:', process.env.AMOCRM_SUBDOMAIN ? '✅ установлен' : '❌ не установлен');
    console.error('AMOCRM_ACCESS_TOKEN:', process.env.AMOCRM_ACCESS_TOKEN ? '✅ установлен' : '❌ не установлен');
    console.error('AMOCRM_PIPELINE_ID:', process.env.AMOCRM_PIPELINE_ID ? `✅ установлен (${process.env.AMOCRM_PIPELINE_ID})` : '❌ не установлен');
    
    // Определяем статус код на основе типа ошибки
    let statusCode = 500;
    let errorMessage = error.message || 'Внутренняя ошибка сервера';
    
    if (error.message.includes('Invalid URL')) {
      statusCode = 400;
    } else if (error.message.includes('не установлен')) {
      statusCode = 500;
    } else if (error.response) {
      // Если есть ответ от API, используем его статус
      statusCode = error.response.status || 500;
      // Формируем понятное сообщение об ошибке
      if (error.response.data) {
        if (error.response.data.error) {
          errorMessage = error.response.data.error;
        } else if (error.response.data.detail) {
          errorMessage = error.response.data.detail;
        } else if (typeof error.response.data === 'string') {
          errorMessage = error.response.data;
        } else {
          errorMessage = `Ошибка API: ${JSON.stringify(error.response.data)}`;
        }
      }
    }
    
    res.status(statusCode).json({
      success: false,
      message: `Ошибка при отправке вебхука: ${errorMessage}`,
      error: errorMessage,
      statusCode: statusCode,
      ...(process.env.NODE_ENV === 'development' && {
        details: {
          type: error.constructor.name,
          stack: error.stack,
          response: error.response?.data
        }
      })
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

/**
 * Обработчик корневого пути
 */
app.get('/', (req, res) => {
  res.json({
    service: 'sasha-webhook-to-amocrm',
    version: '1.0.0',
    endpoints: {
      webhook: 'POST /webhook - Прием вебхуков от Sasha AI',
      test: 'POST /test/amocrm/lead - Тестовый endpoint для отправки сделки',
      health: 'GET /health - Проверка работоспособности сервера'
    },
    message: 'Для отправки вебхуков используйте POST /webhook'
  });
});

/**
 * Обработчик для всех остальных несуществующих путей
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint не найден',
    message: `Путь ${req.method} ${req.path} не существует`,
    availableEndpoints: {
      webhook: 'POST /webhook',
      test: 'POST /test/amocrm/lead',
      health: 'GET /health'
    }
  });
});

/**
 * Глобальный обработчик ошибок
 */
app.use((err, req, res, next) => {
  console.error('Глобальная ошибка:', err);
  console.error('Stack:', err.stack);
  
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Внутренняя ошибка сервера',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
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
