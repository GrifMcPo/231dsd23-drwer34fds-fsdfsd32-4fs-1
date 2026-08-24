import TelegramBot from 'node-telegram-bot-api';
import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0', 10);
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN не найден в переменных окружения');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const awaitingInput = new Map();

// ─── Утилиты ───

function moscowTime() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function progressBar(percent) {
  const filled = Math.round(percent / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

async function logCommand(userId, username, command) {
  try {
    await supabase.from('bot_logs').insert({
      user_id: userId,
      username: username || null,
      command: command
    });
  } catch (e) {
    console.error('Ошибка логирования:', e.message);
  }
}

async function saveUser(userId, username, firstName) {
  try {
    await supabase.from('bot_users').upsert({
      user_id: userId,
      username: username || null,
      first_name: firstName || null,
      last_seen: new Date().toISOString()
    }, { onConflict: 'user_id' });
  } catch (e) {
    console.error('Ошибка сохранения юзера:', e.message);
  }
}

async function isBanned(userId) {
  try {
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('bot_bans')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .gt('unban_at', now)
      .maybeSingle();
    return data;
  } catch (e) {
    return null;
  }
}

async function checkExpiredBans() {
  try {
    const now = new Date().toISOString();
    await supabase
      .from('bot_bans')
      .update({ active: false })
      .eq('active', true)
      .lt('unban_at', now);
  } catch (e) {
    console.error('Ошибка проверки банов:', e.message);
  }
}

async function getTechWorks() {
  try {
    const { data } = await supabase
      .from('bot_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (data && data.tech_works && data.tech_works_until) {
      if (new Date(data.tech_works_until) > new Date()) {
        return { active: true, until: data.tech_works_until };
      } else {
        await supabase
          .from('bot_settings')
          .update({ tech_works: false, tech_works_until: null })
          .eq('id', 1);
        return { active: false };
      }
    }
    return { active: false };
  } catch (e) {
    return { active: false };
  }
}

async function setTechWorks(active, until) {
  try {
    await supabase
      .from('bot_settings')
      .update({
        tech_works: active,
        tech_works_until: until || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1);
  } catch (e) {
    console.error('Ошибка настройки тех-работ:', e.message);
  }
}

// ─── Анимация обработки ───

async function sendProcessingAnimation(chatId, headerText) {
  const stages = [
    {
      title: `🔄 ${headerText}`,
      percents: [40, 0, 0, 0, 0],
      checks: [false, false, false, false, false]
    },
    {
      title: `🔄 ${headerText}`,
      percents: [80, 60, 40, 20, 0],
      checks: [false, false, false, false, false]
    },
    {
      title: `🔄 ${headerText}`,
      percents: [100, 100, 80, 60, 40],
      checks: [true, true, false, false, false]
    },
    {
      title: `✅ ${headerText === 'ОБРАБОТКА ЗАПРОСА' ? 'ЗАПРОС ОБРАБОТАН' : headerText === 'ПРОВЕРКА ДАННЫХ' ? 'ДАННЫЕ ПРОВЕРЕНЫ' : 'ОТЧЁТ СФОРМИРОВАН'}`,
      percents: [100, 100, 100, 100, 100],
      checks: [true, true, true, true, true],
      final: true
    }
  ];

  let messageText = formatAnimationStage(stages[0]);
  const msg = await bot.sendMessage(chatId, messageText, { parse_mode: 'HTML' });

  for (let i = 1; i < stages.length; i++) {
    await sleep(400);
    messageText = formatAnimationStage(stages[i]);
    try {
      await bot.editMessageText(messageText, {
        chat_id: chatId,
        message_id: msg.message_id,
        parse_mode: 'HTML'
      });
    } catch (e) { }
  }
  return msg;
}

function formatAnimationStage(stage) {
  let text = `<b>${stage.title}</b>\n\n`;
  for (let i = 0; i < 5; i++) {
    const p = stage.percents[i];
    const bar = progressBar(p);
    const check = stage.checks[i] ? ' ✅' : '';
    text += `📡 Этап #${i + 1}... ${bar} ${p}%${check}\n`;
  }
  if (stage.final) {
    text += `\n📊 Сбор данных...\n⏳ Формирование результата...`;
  } else {
    text += `\n⏳ Ожидайте...`;
  }
  return text;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Результаты функций ───

function formatResult1(data) {
  return `<b>✅ РЕЗУЛЬТАТ ОБРАБОТКИ</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 Входные данные: <code>${data}</code>
📊 Статус: Успешно обработано
🔍 Найдено совпадений: 3
📂 Категория: Общие данные
⚡ Время обработки: 0.8 сек
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ ПРОВЕРКА

✅ Данные валидны: ДА
✅ Формат корректен: ДА
📊 Использовано этапов: 5/5
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function formatResult2(data) {
  return `<b>✅ РЕЗУЛЬТАТ ПРОВЕРКИ ДАННЫХ</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 Входные данные: <code>${data}</code>
📊 Статус: Проверено
🔍 Результат проверки: Соответствует формату
📂 Тип данных: Текстовые
⚡ Время проверки: 0.6 сек
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ ПРОВЕРКА

✅ Данные валидны: ДА
✅ Формат корректен: ДА
📊 Использовано этапов: 5/5
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function formatResult3(data) {
  return `<b>✅ ОТЧЁТ СФОРМИРОВАН</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 Входные данные: <code>${data}</code>
📊 Статус: Отчёт готов
📄 Объём отчёта: 1 страница
📂 Формат: Текстовый
⚡ Время формирования: 1.2 сек
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ ПРОВЕРКА

✅ Данные валидны: ДА
✅ Формат корректен: ДА
📊 Использовано этапов: 5/5
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// ─── Клавиатуры ───

const menuKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '1 — Функция 1', callback_data: 'func1' }],
      [{ text: '2 — Функция 2', callback_data: 'func2' }],
      [{ text: '3 — Функция 3', callback_data: 'func3' }]
    ]
  }
};

const helpText = `📚 ДОСТУПНЫЕ КОМАНДЫ

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 ОСНОВНЫЕ

.info — получить информацию
.check — проверить данные
.report — сформировать отчёт

━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ ДОПОЛНИТЕЛЬНО

.help — справка

━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ НАКАЗАНИЯ (PLUS)

.ban (I) (T) (R) — Выдать бан в БОТЕ!
.unban (I) (R) — Снять блокировку в БОТЕ!

━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 .команды — в чатах с собеседниками
📌 /команды — в личке с ботом`;

// ─── Проверка админа ───

function isAdmin(userId) {
  return userId === ADMIN_ID;
}

// ─── Удаление сообщения ───

async function tryDeleteMessage(chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
  } catch (e) { }
}

// ─── Бан/Разбан ───

function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)([мчдс]|min|h|d|s)$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { 'м': 60000, 'min': 60000, 'ч': 3600000, 'h': 3600000, 'д': 86400000, 'd': 86400000, 'с': 1000, 's': 1000 };
  return num * multipliers[unit];
}

async function handleBan(chatId, msg, args, isBusiness) {
  if (args.length < 3) {
    await bot.sendMessage(chatId, '❌ Формат: /ban (ID) (ВРЕМЯ) (ПРИЧИНА)\nПример: /ban 123456789 24ч Спам');
    return;
  }

  const targetId = parseInt(args[0], 10);
  const durationStr = args[1];
  const reason = args.slice(2).join(' ');

  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    await bot.sendMessage(chatId, '❌ Неверный формат времени. Примеры: 30м, 2ч, 1д');
    return;
  }

  const now = new Date();
  const unbanAt = new Date(now.getTime() + durationMs);

  try {
    await supabase
      .from('bot_bans')
      .upsert({
        user_id: targetId,
        reason: reason,
        ban_duration: durationStr,
        banned_at: now.toISOString(),
        unban_at: unbanAt.toISOString(),
        active: true
      }, { onConflict: 'user_id' });

    const banMsg = `✅ ПОЛЬЗОВАТЕЛЬ ЗАБАНЕН

🆔 ID: <code>${targetId}</code>
📌 Причина: ${reason}
⏱ Время: ${durationStr}
🕐 Дата: ${moscowTime()}
⏳ Бан активен до: ${unbanAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;

    await bot.sendMessage(chatId, banMsg, { parse_mode: 'HTML' });

    try {
      const notifyMsg = `⛔ ВАС ЗАБЛОКИРОВАЛИ В БОТЕ

📌 Причина: ${reason}
⏱ Длительность: ${durationStr}
🕐 Дата блокировки: ${moscowTime()}
⏳ Разблокировка: ${unbanAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
      await bot.sendMessage(targetId, notifyMsg, { parse_mode: 'HTML' });
    } catch (e) { }
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при выдаче бана.');
  }
}

async function handleUnban(chatId, msg, args, isBusiness) {
  if (args.length < 2) {
    await bot.sendMessage(chatId, '❌ Формат: /unban (ID) (ПРИЧИНА)\nПример: /unban 123456789 Ошибка');
    return;
  }

  const targetId = parseInt(args[0], 10);
  const reason = args.slice(1).join(' ');

  try {
    const { data } = await supabase
      .from('bot_bans')
      .select('*')
      .eq('user_id', targetId)
      .eq('active', true)
      .maybeSingle();

    if (!data) {
      await bot.sendMessage(chatId, `⛔ Данный ${targetId} не заблокирован.`);
      return;
    }

    await supabase
      .from('bot_bans')
      .update({ active: false })
      .eq('user_id', targetId)
      .eq('active', true);

    const unbanMsg = `✅ ПОЛЬЗОВАТЕЛЬ РАЗБАНЕН

🆔 ID: <code>${targetId}</code>
📌 Причина разбана: ${reason}
🕐 Дата: ${moscowTime()}
🔓 Пользователь снова может пользоваться ботом`;

    await bot.sendMessage(chatId, unbanMsg, { parse_mode: 'HTML' });

    try {
      const notifyMsg = `✅ ВАС РАЗБЛОКИРОВАЛИ

📌 Причина разблокировки: ${reason}
🕐 Дата: ${moscowTime()}
🔓 Теперь вы снова можете пользоваться ботом`;
      await bot.sendMessage(targetId, notifyMsg, { parse_mode: 'HTML' });
    } catch (e) { }
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при снятии бана.');
  }
}

async function handleChkban(chatId, args) {
  if (args.length < 1) {
    await bot.sendMessage(chatId, '❌ Формат: /chkban (ID)');
    return;
  }

  const targetId = parseInt(args[0], 10);

  try {
    const now = new Date();
    const { data } = await supabase
      .from('bot_bans')
      .select('*')
      .eq('user_id', targetId)
      .eq('active', true)
      .maybeSingle();

    if (!data || new Date(data.unban_at) < now) {
      await bot.sendMessage(chatId, `⛔ Данный ${targetId} не заблокирован.`);
      return;
    }

    const remaining = new Date(data.unban_at) - now;
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    const chkMsg = `---<code>${targetId}</code>---
📌Причина: ${data.reason}
🕐Дата выдачи: ${new Date(data.banned_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
🕐Дата снятия бана: ${new Date(data.unban_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
🔓Осталось до окончания: ${hours}ч ${minutes}м ${seconds}с`;

    await bot.sendMessage(chatId, chkMsg, { parse_mode: 'HTML' });
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при проверке бана.');
  }
}

async function handleLogs(chatId, args) {
  if (args.length < 2) {
    await bot.sendMessage(chatId, '❌ Формат: /logs (ID) (количество)\nПример: /logs 123456789 10');
    return;
  }

  const targetId = parseInt(args[0], 10);
  const limit = Math.min(parseInt(args[1], 10) || 10, 100);

  try {
    const { data, error } = await supabase
      .from('bot_logs')
      .select('*')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) {
      await bot.sendMessage(chatId, '📭 Логи не найдены для данного ID.');
      return;
    }

    let logsText = `📋 Логи пользователя <code>${targetId}</code> (последние ${data.length})\n\n`;
    for (const log of data) {
      logsText += `📝 ${log.command}\n🕐 ${new Date(log.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n\n`;
    }

    if (logsText.length > 4096) {
      const chunks = logsText.match(/[\s\S]{1,4096}/g);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      }
    } else {
      await bot.sendMessage(chatId, logsText, { parse_mode: 'HTML' });
    }
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при получении логов.');
  }
}

async function handleIdlist(chatId) {
  try {
    const { data, error } = await supabase
      .from('bot_users')
      .select('*')
      .order('last_seen', { ascending: false });

    if (error || !data || data.length === 0) {
      await bot.sendMessage(chatId, '📭 Список ID пуст.');
      return;
    }

    let listText = `📋 Список пользователей (${data.length})\n\n`;
    for (const user of data) {
      const uname = user.username ? `@${user.username}` : 'нет username';
      listText += `👤 ${uname} → <code>${user.user_id}</code>\n`;
    }

    if (listText.length > 4096) {
      const chunks = listText.match(/[\s\S]{1,4096}/g);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'HTML' });
      }
    } else {
      await bot.sendMessage(chatId, listText, { parse_mode: 'HTML' });
    }
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при получении списка.');
  }
}

async function handleKey(chatId) {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 5; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    const key = `ADMIN_${suffix}`;

    const expiresAt = new Date(Date.now() + 10 * 3600000);

    await supabase.from('bot_keys').insert({
      key: key,
      expires_at: expiresAt.toISOString(),
      active: true
    });

    const keyMsg = `🔑 Ключ доступа сгенерирован

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔐 Ключ: <code>${key}</code>
⏱ Действует: 10 часов
🕐 До: ${expiresAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 Используйте этот ключ для входа в админ-панель сайта`;

    await bot.sendMessage(chatId, keyMsg, { parse_mode: 'HTML' });
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при генерации ключа.');
  }
}

async function handleTex(chatId, args) {
  if (args.length < 1) {
    await bot.sendMessage(chatId, '❌ Формат: /tex on (время) или /tex off');
    return;
  }

  const subCmd = args[0].toLowerCase();

  if (subCmd === 'on') {
    if (args.length < 2) {
      await bot.sendMessage(chatId, '❌ Укажите время: /tex on 2ч');
      return;
    }

    const durationMs = parseDuration(args[1]);
    if (!durationMs) {
      await bot.sendMessage(chatId, '❌ Неверный формат времени. Примеры: 30м, 2ч, 1д');
      return;
    }

    const until = new Date(Date.now() + durationMs);
    await setTechWorks(true, until.toISOString());

    await bot.sendMessage(chatId, `✅ ТЕХ-РАБОТЫ УСПЕШНО ВКЛЮЧЕНЫ\n🕐 Время работ: ${until.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
  } else if (subCmd === 'off') {
    await setTechWorks(false, null);
    await bot.sendMessage(chatId, '✅ ТЕХ-РАБОТЫ УСПЕШНО ВЫКЛЮЧЕНЫ');
  } else {
    await bot.sendMessage(chatId, '❌ Используйте: /tex on (время) или /tex off');
  }
}

// ─── Обработка бизнес-команд ───

async function processBusinessCommand(chatId, text, userId, username, firstName, msg) {
  if (!text.startsWith('.')) return false;

  const parts = text.slice(1).split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  const techWorks = await getTechWorks();
  if (techWorks.active && !isAdmin(userId)) {
    await tryDeleteMessage(chatId, msg.message_id);
    await bot.sendMessage(chatId, `🛠️ БОТ НА ТЕХНИЧЕСКИХ РАБОТАХ\n\n🕐 ВРЕМЯ: ${new Date(techWorks.until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
    return true;
  }

  switch (cmd) {
    case 'help':
      await tryDeleteMessage(chatId, msg.message_id);
      await bot.sendMessage(chatId, helpText);
      return true;

    case 'info':
      await tryDeleteMessage(chatId, msg.message_id);
      await sendProcessingAnimation(chatId, 'ОБРАБОТКА ЗАПРОСА');
      await bot.sendMessage(chatId, formatResult1(args.join(' ') || 'нет данных'), { parse_mode: 'HTML' });
      await logCommand(userId, username, text);
      return true;

    case 'check':
      await tryDeleteMessage(chatId, msg.message_id);
      await sendProcessingAnimation(chatId, 'ПРОВЕРКА ДАННЫХ');
      await bot.sendMessage(chatId, formatResult2(args.join(' ') || 'нет данных'), { parse_mode: 'HTML' });
      await logCommand(userId, username, text);
      return true;

    case 'report':
      await tryDeleteMessage(chatId, msg.message_id);
      await sendProcessingAnimation(chatId, 'ФОРМИРОВАНИЕ ОТЧЁТА');
      await bot.sendMessage(chatId, formatResult3(args.join(' ') || 'нет данных'), { parse_mode: 'HTML' });
      await logCommand(userId, username, text);
      return true;

    case 'ban':
      if (!isAdmin(userId)) return false;
      await tryDeleteMessage(chatId, msg.message_id);
      await handleBan(chatId, msg, args, true);
      await logCommand(userId, username, text);
      return true;

    case 'unban':
      if (!isAdmin(userId)) return false;
      await tryDeleteMessage(chatId, msg.message_id);
      await handleUnban(chatId, msg, args, true);
      await logCommand(userId, username, text);
      return true;

    case 'chkban':
      if (!isAdmin(userId)) return false;
      await tryDeleteMessage(chatId, msg.message_id);
      await handleChkban(chatId, args);
      await logCommand(userId, username, text);
      return true;

    case 'logs':
      if (!isAdmin(userId)) return false;
      await tryDeleteMessage(chatId, msg.message_id);
      await handleLogs(chatId, args);
      await logCommand(userId, username, text);
      return true;

    case 'idlist':
      if (!isAdmin(userId)) return false;
      await tryDeleteMessage(chatId, msg.message_id);
      await handleIdlist(chatId);
      await logCommand(userId, username, text);
      return true;

    case 'key':
      if (!isAdmin(userId)) return false;
      await tryDeleteMessage(chatId, msg.message_id);
      await handleKey(chatId);
      await logCommand(userId, username, text);
      return true;

    case 'tex':
      if (!isAdmin(userId)) return false;
      await tryDeleteMessage(chatId, msg.message_id);
      await handleTex(chatId, args);
      await logCommand(userId, username, text);
      return true;

    default:
      return false;
  }
}

// ─── Обработка команд ЛС ───

async function processDmCommand(chatId, text, userId, username, firstName, msg) {
  if (!text.startsWith('/')) return false;

  const parts = text.split(' ');
  const cmd = parts[0].toLowerCase().replace('/', '');
  const args = parts.slice(1);

  const techWorks = await getTechWorks();
  if (techWorks.active && !isAdmin(userId) && cmd !== 'tex') {
    await bot.sendMessage(chatId, `🛠️ БОТ НА ТЕХНИЧЕСКИХ РАБОТАХ\n\n🕐 ВРЕМЯ: ${new Date(techWorks.until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
    return true;
  }

  const ban = await isBanned(userId);
  if (ban && !isAdmin(userId)) {
    await bot.sendMessage(chatId, `⛔ Вы заблокированы в боте.\n\n📌 Причина: ${ban.reason}\n⏳ Разблокировка: ${new Date(ban.unban_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
    return true;
  }

  switch (cmd) {
    case 'start':
      await saveUser(userId, username, firstName);
      await bot.sendMessage(chatId, `👋 Добро пожаловать!\n\nИспользуйте /menu для просмотра доступных функций.`);
      await logCommand(userId, username, text);
      return true;

    case 'menu':
      await saveUser(userId, username, firstName);
      await bot.sendMessage(chatId, '<b>📋 МЕНЮ БОТА</b>\n\nВыберите функцию:', { parse_mode: 'HTML', ...menuKeyboard });
      await logCommand(userId, username, text);
      return true;

    case 'help':
      await bot.sendMessage(chatId, helpText);
      await logCommand(userId, username, text);
      return true;

    case 'ban':
      if (!isAdmin(userId)) return false;
      await handleBan(chatId, msg, args, false);
      await logCommand(userId, username, text);
      return true;

    case 'unban':
      if (!isAdmin(userId)) return false;
      await handleUnban(chatId, msg, args, false);
      await logCommand(userId, username, text);
      return true;

    case 'chkban':
      if (!isAdmin(userId)) return false;
      await handleChkban(chatId, args);
      await logCommand(userId, username, text);
      return true;

    case 'logs':
      if (!isAdmin(userId)) return false;
      await handleLogs(chatId, args);
      await logCommand(userId, username, text);
      return true;

    case 'idlist':
      if (!isAdmin(userId)) return false;
      await handleIdlist(chatId);
      await logCommand(userId, username, text);
      return true;

    case 'key':
      if (!isAdmin(userId)) return false;
      await handleKey(chatId);
      await logCommand(userId, username, text);
      return true;

    case 'tex':
      if (!isAdmin(userId)) return false;
      await handleTex(chatId, args);
      await logCommand(userId, username, text);
      return true;

    default:
      return false;
  }
}

// ─── Обработка сообщений ───

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;
  const firstName = msg.from.first_name;
  const text = msg.text || '';
  const chatType = msg.chat.type;

  await checkExpiredBans();

  // Ждём ввода данных для функции
  if (awaitingInput.has(userId) && text && !text.startsWith('/') && !text.startsWith('.')) {
    const funcId = awaitingInput.get(userId);
    awaitingInput.delete(userId);

    await tryDeleteMessage(chatId, msg.message_id);

    let headerText, resultText;
    if (funcId === 'func1') {
      headerText = 'ОБРАБОТКА ЗАПРОСА';
      resultText = formatResult1(text);
    } else if (funcId === 'func2') {
      headerText = 'ПРОВЕРКА ДАННЫХ';
      resultText = formatResult2(text);
    } else if (funcId === 'func3') {
      headerText = 'ФОРМИРОВАНИЕ ОТЧЁТА';
      resultText = formatResult3(text);
    }

    await sendProcessingAnimation(chatId, headerText);
    await bot.sendMessage(chatId, resultText, { parse_mode: 'HTML' });
    await logCommand(userId, username, `[Функция ${funcId === 'func1' ? '1' : funcId === 'func2' ? '2' : '3'}] ${text}`);
    return;
  }

  if (!text) return;

  // Бизнес-команды (в приватных чатах через Business API)
  if (chatType === 'private' && text.startsWith('.')) {
    await processBusinessCommand(chatId, text, userId, username, firstName, msg);
    return;
  }

  // Команды ЛС
  if (text.startsWith('/')) {
    await processDmCommand(chatId, text, userId, username, firstName, msg);
    return;
  }
});

// ─── Обработка callback (кнопки) ───

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const msgId = query.message.message_id;

  const funcMap = {
    'func1': { text: 'Функция 1', id: 'func1' },
    'func2': { text: 'Функция 2', id: 'func2' },
    'func3': { text: 'Функция 3', id: 'func3' }
  };

  if (funcMap[data]) {
    const func = funcMap[data];
    await tryDeleteMessage(chatId, msgId);
    const promptMsg = await bot.sendMessage(chatId, `Действие выбрано: ${func.text}. Пришлите данные для обработки:`);

    awaitingInput.set(userId, func.id);

    setTimeout(async () => {
      if (awaitingInput.has(userId)) {
        awaitingInput.delete(userId);
        try { await bot.deleteMessage(chatId, promptMsg.message_id); } catch (e) { }
        await bot.sendMessage(chatId, '⏰ Время ожидания истекло. Используйте /menu снова.');
      }
    }, 60000);
  }

  bot.answerCallbackQuery(query.id);
});

// ─── Запуск ───

async function startup() {
  console.log('Бот запущен...');
  await checkExpiredBans();
  const tech = await getTechWorks();
  if (tech.active) {
    console.log('Тех-работы активны до:', tech.until);
  }
  console.log('Админ ID:', ADMIN_ID);
}

startup();

setInterval(async () => {
  await checkExpiredBans();
  await getTechWorks();
}, 60000);

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('SIGTERM', () => {
  console.log('Получен SIGTERM, остановка...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Получен SIGINT, остановка...');
  bot.stopPolling();
  process.exit(0);
});
