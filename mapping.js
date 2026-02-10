/**
 * МАППИНГ ДАННЫХ: Вебхук → amoCRM
 * 
 * Этот файл определяет, какие данные из вебхука попадают в какие поля amoCRM.
 * Чтобы изменить соответствие, просто поменяйте значение в поле "source" или "transform".
 * 
 * Структура:
 * - source: путь к данным в вебхуке (например, 'call.agreements.client_name')
 * - transform: функция преобразования (опционально)
 * - default: значение по умолчанию, если данных нет (опционально)
 * 
 * ВАЖНО: Для работы с amoCRM необходимо настроить ID кастомных полей в переменных окружения:
 * - AMOCRM_PHONE_FIELD_ID - ID поля телефона
 * - AMOCRM_EMAIL_FIELD_ID - ID поля email
 * - AMOCRM_PIPELINE_ID - ID воронки (обязательно)
 * - AMOCRM_STATUS_ID - ID статуса в воронке (опционально, по умолчанию первый статус)
 */

/**
 * Маппинг для СДЕЛОК (leads) в amoCRM
 */
const leadMapping = {
  // Название сделки (обязательное поле)
  name: {
    source: 'call.agreements.agreements',  // Откуда берем: договоренности из звонка
    transform: (value, data) => {
      if (value) {
        // Ограничиваем длину названия (amoCRM имеет ограничение)
        return value.length > 250 ? value.substring(0, 247) + '...' : value;
      }
      // Если договоренностей нет, используем имя клиента или телефон
      const clientName = data.call?.agreements?.client_name;
      if (clientName) {
        return `Лид от AI менеджера: ${clientName}`;
      }
      const phone = data.contact?.phone;
      if (phone) {
        return `Лид от AI менеджера: ${phone}`;
      }
      return 'Лид от AI менеджера';
    }
  },
  
  // ID воронки (обязательное поле)
  pipeline_id: {
    source: 'static',
    value: process.env.AMOCRM_PIPELINE_ID || null
  },
  
  // ID статуса в воронке (опционально)
  status_id: {
    source: 'static',
    value: process.env.AMOCRM_STATUS_ID || null
  },
  
  // Цена сделки (опционально)
  price: {
    source: 'call.agreements.price',  // Если есть цена в договоренностях
    transform: (value) => {
      if (!value) return null;
      // Преобразуем в число
      const numValue = parseInt(value);
      return isNaN(numValue) ? null : numValue;
    }
  },
  
  // Кастомные поля сделки (custom_fields_values для API v4)
  custom_fields_values: {
    source: 'multiple',
    transform: (value, data) => {
      const customFields = [];
      const agreements = data.call?.agreements || {};
      const call = data.call || {};
      const contact = data.contact || {};
      
      // Договоренности (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_AGREEMENTS_FIELD_ID && agreements.agreements) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_AGREEMENTS_FIELD_ID),
          values: [{ value: agreements.agreements }]
        });
      }
      
      // Факты о клиенте (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_CLIENT_FACTS_FIELD_ID && agreements.client_facts) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_CLIENT_FACTS_FIELD_ID),
          values: [{ value: agreements.client_facts }]
        });
      }
      
      // SMS текст (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_SMS_TEXT_FIELD_ID && agreements.smsText) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_SMS_TEXT_FIELD_ID),
          values: [{ value: agreements.smsText }]
        });
      }
      
      // Длительность звонка (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_CALL_DURATION_FIELD_ID && call.duration) {
        const minutes = Math.floor(call.duration / 60000);
        const seconds = Math.floor((call.duration % 60000) / 1000);
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_CALL_DURATION_FIELD_ID),
          values: [{ value: `${minutes} мин ${seconds} сек` }]
        });
      }
      
      // Время начала звонка (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_CALL_STARTED_FIELD_ID && call.startedAt) {
        const dateValue = Math.floor(new Date(call.startedAt).getTime() / 1000);
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_CALL_STARTED_FIELD_ID),
          values: [{ value: dateValue }]
        });
      }
      
      // Запись звонка - ссылка (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_CALL_RECORD_URL_FIELD_ID && call.recordUrl) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_CALL_RECORD_URL_FIELD_ID),
          values: [{ value: call.recordUrl }]
        });
      }
      
      // История диалога (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_CALL_HISTORY_FIELD_ID && agreements.historycall) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_CALL_HISTORY_FIELD_ID),
          values: [{ value: agreements.historycall }]
        });
      }
      
      // Время договоренности (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_AGREEMENTS_TIME_FIELD_ID && agreements.agreements_time) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_AGREEMENTS_TIME_FIELD_ID),
          values: [{ value: agreements.agreements_time }]
        });
      }
      
      // Регион (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_REGION_FIELD_ID && contact.dadataPhoneInfo?.region) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_REGION_FIELD_ID),
          values: [{ value: contact.dadataPhoneInfo.region }]
        });
      }
      
      // Компания (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_COMPANY_FIELD_ID && contact.additionalFields?.company) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_COMPANY_FIELD_ID),
          values: [{ value: contact.additionalFields.company }]
        });
      }
      
      return customFields.length > 0 ? customFields : null;
    }
  }
  
  // Примечание: Комментарии в amoCRM создаются отдельно через API notes
  // Для добавления комментариев можно использовать отдельный endpoint после создания сделки
};

/**
 * Маппинг для КОНТАКТОВ в amoCRM
 */
const contactMapping = {
  // Имя контакта (обязательное поле)
  name: {
    source: 'call.agreements.client_name',  // Откуда берем: имя клиента из договоренностей
    transform: (value, data) => {
      if (value) {
        return value.trim();
      }
      // Если имени нет, используем телефон
      const phone = data.contact?.phone;
      if (phone) {
        return `Контакт ${phone}`;
      }
      return 'Контакт без имени';
    }
  },
  
  // Кастомные поля контакта (custom_fields_values для API v4)
  custom_fields_values: {
    source: 'multiple',
    transform: (value, data) => {
      const customFields = [];
      const contact = data.contact || {};
      
      // Телефон (стандартное поле PHONE)
      if (contact.phone) {
        const phoneFormatted = contact.phone.replace(/\D/g, '');
        if (phoneFormatted) {
          // Форматируем телефон для amoCRM (должен начинаться с +)
          const phoneValue = phoneFormatted.startsWith('7') ? `+${phoneFormatted}` : `+7${phoneFormatted}`;
          customFields.push({
            field_code: 'PHONE',  // Стандартный код поля телефона
            values: [{
              value: phoneValue,
              enum_code: 'WORK'  // Тип телефона: WORK, MOB, HOME, FAX, OTHER
            }]
          });
        }
      }
      
      // Email (стандартное поле EMAIL)
      if (contact.additionalFields?.email) {
        customFields.push({
          field_code: 'EMAIL',  // Стандартный код поля email
          values: [{
            value: contact.additionalFields.email,
            enum_code: 'WORK'  // Тип email: WORK, PRIV, OTHER
          }]
        });
      }
      
      // Компания (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_CONTACT_COMPANY_FIELD_ID && contact.additionalFields?.company) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_CONTACT_COMPANY_FIELD_ID),
          values: [{ value: contact.additionalFields.company }]
        });
      }
      
      // Город (если есть ID поля - кастомное поле)
      if (process.env.AMOCRM_CONTACT_CITY_FIELD_ID && contact.additionalFields?.city) {
        customFields.push({
          field_id: parseInt(process.env.AMOCRM_CONTACT_CITY_FIELD_ID),
          values: [{ value: contact.additionalFields.city }]
        });
      }
      
      return customFields.length > 0 ? customFields : null;
    }
  }
};

/**
 * Функция для получения значения из объекта по пути (например, 'contact.phone')
 */
function getValueByPath(obj, path) {
  if (!path || path === 'static' || path === 'multiple') {
    return null;
  }
  
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

/**
 * Применяет маппинг к данным вебхука
 * @param {Object} webhookData - Данные из вебхука
 * @param {Object} mapping - Объект маппинга (leadMapping, contactMapping и т.д.)
 * @returns {Object} - Объект с полями для amoCRM
 */
function applyMapping(webhookData, mapping) {
  const result = {};
  
  for (const [amocrmField, config] of Object.entries(mapping)) {
    try {
      let value;
      
      if (config.source === 'static') {
        // Статическое значение
        value = config.value;
      } else if (config.source === 'multiple') {
        // Специальная обработка для множественных источников
        value = config.transform ? config.transform(null, webhookData) : null;
      } else {
        // Получаем значение по пути
        const rawValue = getValueByPath(webhookData, config.source);
        
        // Применяем преобразование, если есть
        if (config.transform) {
          value = config.transform(rawValue, webhookData);
        } else {
          value = rawValue;
        }
      }
      
      // Добавляем поле только если значение не null/undefined
      if (value !== null && value !== undefined) {
        result[amocrmField] = value;
      }
    } catch (error) {
      console.warn(`Ошибка при обработке поля ${amocrmField}:`, error.message);
    }
  }
  
  return result;
}

module.exports = {
  leadMapping,
  contactMapping,
  applyMapping,
  getValueByPath
};
