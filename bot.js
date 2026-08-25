import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0', 10);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN не найден в переменных окружения');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Файлы для хранения данных
const DATA_FILES = {
  bans: 'banlist.json',
  logs: 'logs.json',
  users: 'idlist.json',
  keys: 'keys.json',
  settings: 'settings.json'
};

// Инициализация файлов
async function initFiles() {
  for (const [key, file] of Object.entries(DATA_FILES)) {
    try {
      await fs.access(file);
    } catch {
      if (key === 'bans' || key === 'logs') {
        await fs.writeFile(file, JSON.stringify([], null, 2));
      } else {
        await fs.writeFile(file, JSON.stringify({}, null, 2));
      }
    }
  }
}

// Чтение JSON
async function readJSON(file) {
  try {
    const data = await fs.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch {
    return file === 'banlist.json' || file === 'logs.json' ? [] : {};
  }
}

// Запись JSON
async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

const awaitingInput = new Map();
let maintenanceMode = false;
let maintenanceUntil = null;
let bannedNotified = new Set();

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Работа с данными ───

async function logCommand(userId, username, command) {
  try {
    const logs = await readJSON(DATA_FILES.logs);
    if (!logs[userId]) logs[userId] = [];
    logs[userId].push({
      time: new Date().toISOString(),
      command: command.slice(0, 500)
    });
    if (logs[userId].length > 1000) logs[userId] = logs[userId].slice(-1000);
    await writeJSON(DATA_FILES.logs, logs);
  } catch (e) {
    console.error('Ошибка логирования:', e.message);
  }
}

async function saveUser(userId, username, firstName) {
  try {
    const users = await readJSON(DATA_FILES.users);
    if (!users[userId]) {
      users[userId] = {
        username: username || null,
        first_name: firstName || null,
        last_seen: new Date().toISOString()
      };
      await writeJSON(DATA_FILES.users, users);
    }
  } catch (e) {
    console.error('Ошибка сохранения юзера:', e.message);
  }
}

async function isBanned(userId) {
  try {
    const bans = await readJSON(DATA_FILES.bans);
    const now = new Date().toISOString();
    for (const ban of bans) {
      if (ban.user_id === userId) {
        if (ban.forever) return ban;
        if (now < ban.unban_at) return ban;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function checkExpiredBans() {
  try {
    const bans = await readJSON(DATA_FILES.bans);
    const now = new Date().toISOString();
    const activeBans = bans.filter(b => b.forever || now < b.unban_at);
    if (activeBans.length !== bans.length) {
      await writeJSON(DATA_FILES.bans, activeBans);
    }
  } catch (e) {
    console.error('Ошибка проверки банов:', e.message);
  }
}

async function getTechWorks() {
  try {
    const settings = await readJSON(DATA_FILES.settings);
    if (settings.maintenance && settings.maintenance_until) {
      if (new Date(settings.maintenance_until) > new Date()) {
        return { active: true, until: settings.maintenance_until };
      } else {
        settings.maintenance = false;
        settings.maintenance_until = null;
        await writeJSON(DATA_FILES.settings, settings);
      }
    }
    return { active: false };
  } catch {
    return { active: false };
  }
}

async function setTechWorks(active, until) {
  try {
    const settings = await readJSON(DATA_FILES.settings);
    settings.maintenance = active;
    settings.maintenance_until = until || null;
    await writeJSON(DATA_FILES.settings, settings);
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
    text += `📡 Сервер #${i + 1}... ${bar} ${p}%${check}\n`;
  }
  if (stage.final) {
    text += `\n📊 Сбор данных...\n⏳ Формирование результата...`;
  } else {
    text += `\n⏳ Ожидайте...`;
  }
  return text;
}

// ─── Результаты функций ───

function formatResult1(data) {
  return `<b>✅ РЕЗУЛЬТАТ ПРОБИВА IP</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 IP-адрес: <code>${data || '185.234.xx.xx'}</code>
🌍 Город: Москва
🏙️ Область: Московская область
🇷🇺 Страна: Россия
📍 Координаты: 55.7558, 37.6173
🏠 Адрес: ул. Тверская, д. 1
📡 Оператор: ООО «Ростелеком»
🕒 Часовой пояс: Europe/Moscow
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ БЕЗОПАСНОСТЬ

⚠️ IP в чёрном списке: ❌ НЕТ
🚫 IP в базе мошенников: ❌ НЕТ
🕵️ IP в базе скамеров: ❌ НЕТ
✅ Доверенность IP: 95%
📊 Использовано серверов: 20/20
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function formatResult2(data) {
  return `<b>✅ РЕЗУЛЬТАТ ПРОБИВА НОМЕРА</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 Номер: <code>${data || '+7 999 123-45-67'}</code>
📡 Оператор: МТС
🌍 Регион: Московская область
🏙️ Город: Москва
📊 Тип номера: Мобильный
🕒 Часовой пояс: Europe/Moscow
🇷🇺 Страна: Россия
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ БЕЗОПАСНОСТЬ

⚠️ Номер в чёрном списке: ❌ НЕТ
🚫 Номер в базе мошенников: ❌ НЕТ
🕵️ Номер в базе скамеров: ❌ НЕТ
✅ Доверенность номера: 88%
📊 Использовано серверов: 20/20
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function formatResult3(data) {
  return `<b>✅ РЕЗУЛЬТАТ ПРОБИВА USERNAME</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Username: <code>${data || '@example_user'}</code>
🆔 ID: 123456789
📛 Имя: Алексей Смирнов
📅 Дата регистрации: 12.05.2020
🌍 Язык интерфейса: Русский
🔍 Активность: высокая
📱 Привязан к номеру: +7 999 123-45-67
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ БЕЗОПАСНОСТЬ

⚠️ Username в чёрном списке: ❌ НЕТ
🚫 Аккаунт в базе мошенников: ❌ НЕТ
🕵️ Аккаунт в базе скамеров: ❌ НЕТ
✅ Доверенность аккаунта: 82%
📊 Использовано серверов: 20/20
━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// ─── Клавиатуры ───

const menuKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '1️⃣ Пробив IP', callback_data: 'func1' }],
      [{ text: '2️⃣ Пробив номера', callback_data: 'func2' }],
      [{ text: '3️⃣ Пробив юзера (@)', callback_data: 'func3' }]
    ]
  }
};

const helpText = `📚 ДОСТУПНЫЕ КОМАНДЫ

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 ПРОБИВ

.whois ip [IP] — пробив IP-адреса
.whois n [номер] — пробив номера телефона
.whois qz [@username] — пробив Telegram-юзернейма

━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ ДОПОЛНИТЕЛЬНО

.help — справка

━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ НАКАЗАНИЯ (PLUS)

.ban (ID) (TIME) (REASON) — Выдать бан
  TIME: 30m, 2h, 1h30m, 7d, -1w (навсегда)
.unban (ID) (REASON) — Снять блокировку
.chkban (ID) — Проверить бан пользователя

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

// ─── Парсер времени ───

function parseDuration(durationStr) {
  if (durationStr === '-1w' || durationStr === 'forever' || durationStr === 'навсегда') {
    return -1; // Бесконечный бан
  }
  
  let totalMinutes = 0;
  const str = durationStr.toLowerCase();
  
  // Парсим часы
  const hMatch = str.match(/(\d+)h/);
  if (hMatch) totalMinutes += parseInt(hMatch[1]) * 60;
  
  // Парсим минуты
  const mMatch = str.match(/(\d+)m/);
  if (mMatch) totalMinutes += parseInt(mMatch[1]);
  
  // Парсим дни
  const dMatch = str.match(/(\d+)d/);
  if (dMatch) totalMinutes += parseInt(dMatch[1]) * 24 * 60;
  
  // Парсим недели
  const wMatch = str.match(/(\d+)w/);
  if (wMatch) totalMinutes += parseInt(wMatch[1]) * 7 * 24 * 60;
  
  if (totalMinutes === 0) {
    const num = parseInt(str);
    if (!isNaN(num)) return num;
    return null;
  }
  return totalMinutes;
}

// ─── Бан/Разбан ───

async function handleBan(chatId, msg, args, isBusiness) {
  if (args.length < 3) {
    await bot.sendMessage(chatId, '❌ Формат: .ban (ID) (ВРЕМЯ) (ПРИЧИНА)\nПримеры:\n.ban 123456789 30m Спам\n.ban 123456789 -1w Навсегда');
    return;
  }

  const targetId = parseInt(args[0], 10);
  const durationStr = args[1];
  const reason = args.slice(2).join(' ');

  const minutes = parseDuration(durationStr);
  if (minutes === null) {
    await bot.sendMessage(chatId, '❌ Неверный формат времени. Примеры: 30m, 2h, 1h30m, 7d, -1w');
    return;
  }

  const now = new Date();
  let unbanAt = null;
  let forever = false;

  if (minutes === -1) {
    forever = true;
  } else {
    unbanAt = new Date(now.getTime() + minutes * 60000);
  }

  try {
    const bans = await readJSON(DATA_FILES.bans);
    const newBan = {
      user_id: targetId,
      reason: reason,
      duration: durationStr,
      banned_at: now.toISOString(),
      unban_at: forever ? null : unbanAt.toISOString(),
      forever: forever,
      issued_by: msg.from.id
    };
    
    // Удаляем старый бан
    const filtered = bans.filter(b => b.user_id !== targetId);
    filtered.push(newBan);
    await writeJSON(DATA_FILES.bans, filtered);

    let banMsg = `✅ ПОЛЬЗОВАТЕЛЬ ЗАБАНЕН\n\n🆔 ID: <code>${targetId}</code>\n📌 Причина: ${reason}\n🕐 Дата: ${moscowTime()}`;
    if (forever) {
      banMsg += `\n⏳ БАН НАВСЕГДА`;
    } else {
      banMsg += `\n⏱ Время: ${durationStr}\n⏳ Бан активен до: ${unbanAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
    }

    await bot.sendMessage(chatId, banMsg, { parse_mode: 'HTML' });

    // Уведомляем пользователя
    try {
      let notifyMsg = `⛔ ВАС ЗАБЛОКИРОВАЛИ В БОТЕ\n\n📌 Причина: ${reason}`;
      if (forever) {
        notifyMsg += `\n⏳ БАН НАВСЕГДА`;
      } else {
        notifyMsg += `\n⏱ Длительность: ${durationStr}\n⏳ Разблокировка: ${unbanAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
      }
      await bot.sendMessage(targetId, notifyMsg, { parse_mode: 'HTML' });
    } catch (e) { }
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при выдаче бана.');
  }
}

async function handleUnban(chatId, msg, args, isBusiness) {
  if (args.length < 2) {
    await bot.sendMessage(chatId, '❌ Формат: .unban (ID) (ПРИЧИНА)\nПример: .unban 123456789 Ошибка');
    return;
  }

  const targetId = parseInt(args[0], 10);
  const reason = args.slice(1).join(' ');

  try {
    const bans = await readJSON(DATA_FILES.bans);
    const filtered = bans.filter(b => b.user_id !== targetId);
    
    if (filtered.length === bans.length) {
      await bot.sendMessage(chatId, `⛔ Данный ${targetId} не заблокирован.`);
      return;
    }

    await writeJSON(DATA_FILES.bans, filtered);

    const unbanMsg = `✅ ПОЛЬЗОВАТЕЛЬ РАЗБАНЕН\n\n🆔 ID: <code>${targetId}</code>\n📌 Причина разбана: ${reason}\n🕐 Дата: ${moscowTime()}\n🔓 Пользователь снова может пользоваться ботом`;

    await bot.sendMessage(chatId, unbanMsg, { parse_mode: 'HTML' });

    try {
      const notifyMsg = `✅ ВАС РАЗБЛОКИРОВАЛИ\n\n📌 Причина разблокировки: ${reason}\n🕐 Дата: ${moscowTime()}\n🔓 Теперь вы снова можете пользоваться ботом`;
      await bot.sendMessage(targetId, notifyMsg, { parse_mode: 'HTML' });
    } catch (e) { }
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при снятии бана.');
  }
}

async function handleChkban(chatId, args) {
  if (args.length < 1) {
    await bot.sendMessage(chatId, '❌ Формат: .chkban (ID)');
    return;
  }

  const targetId = parseInt(args[0], 10);

  try {
    const bans = await readJSON(DATA_FILES.bans);
    const ban = bans.find(b => b.user_id === targetId);
    
    if (!ban) {
      await bot.sendMessage(chatId, `⛔ Данный ${targetId} не заблокирован.`);
      return;
    }

    if (ban.forever) {
      const chkMsg = `---<code>${targetId}</code>---\n📌Причина: ${ban.reason}\n🕐Дата выдачи: ${new Date(ban.banned_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n⏳ БАН НАВСЕГДА`;
      await bot.sendMessage(chatId, chkMsg, { parse_mode: 'HTML' });
    } else {
      const now = new Date();
      const unbanDate = new Date(ban.unban_at);
      if (unbanDate < now) {
        await bot.sendMessage(chatId, `⛔ Данный ${targetId} не заблокирован.`);
        return;
      }
      const remaining = unbanDate - now;
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);

      const chkMsg = `---<code>${targetId}</code>---\n📌Причина: ${ban.reason}\n🕐Дата выдачи: ${new Date(ban.banned_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n🕐Дата снятия бана: ${unbanDate.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n🔓Осталось до окончания: ${hours}ч ${minutes}м ${seconds}с`;
      await bot.sendMessage(chatId, chkMsg, { parse_mode: 'HTML' });
    }
  } catch (e) {
    await bot.sendMessage(chatId, '❌ Ошибка при проверке бана.');
  }
}

async function handleLogs(chatId, args) {
  if (args.length < 2) {
    await bot.sendMessage(chatId, '❌ Формат: .logs (ID) (количество)\nПример: .logs 123456789 10');
    return;
  }

  const targetId = parseInt(args[0], 10);
  const limit = Math.min(parseInt(args[1], 10) || 10, 100);

  try {
    const logs = await readJSON(DATA_FILES.logs);
    const userLogs = (logs[targetId] || []).slice(-limit).reverse();

    if (userLogs.length === 0) {
      await bot.sendMessage(chatId, '📭 Логи не найдены для данного ID.');
      return;
    }

    let logsText = `📋 Логи пользователя <code>${targetId}</code> (последние ${userLogs.length})\n\n`;
    for (const log of userLogs) {
      logsText += `📝 ${log.command}\n🕐 ${new Date(log.time).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n\n`;
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
    const users = await readJSON(DATA_FILES.users);
    const entries = Object.entries(users);

    if (entries.length === 0) {
      await bot.sendMessage(chatId, '📭 Список ID пуст.');
      return;
    }

    let listText = `📋 Список пользователей (${entries.length})\n\n`;
    for (const [id, data] of entries) {
      const uname = data.username ? `@${data.username}` : 'нет username';
      listText += `👤 ${uname} → <code>${id}</code>\n`;
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

    const keys = await readJSON(DATA_FILES.keys);
    keys[key] = {
      created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      active: true
    };
    await writeJSON(DATA_FILES.keys, keys);

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
    await bot.sendMessage(chatId, '❌ Формат: .tex on (время) или .tex off');
    return;
  }

  const subCmd = args[0].toLowerCase();

  if (subCmd === 'on') {
    if (args.length < 2) {
      await bot.sendMessage(chatId, '❌ Укажите время: .tex on 30');
      return;
    }

    const minutes = parseInt(args[1]);
    if (isNaN(minutes) || minutes <= 0) {
      await bot.sendMessage(chatId, '❌ Неверный формат времени. Укажите минуты.');
      return;
    }

    const until = new Date(Date.now() + minutes * 60000);
    await setTechWorks(true, until.toISOString());

    await bot.sendMessage(chatId, `✅ ТЕХ-РАБОТЫ УСПЕШНО ВКЛЮЧЕНЫ\n🕐 Время работ: ${until.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
  } else if (subCmd === 'off') {
    await setTechWorks(false, null);
    await bot.sendMessage(chatId, '✅ ТЕХ-РАБОТЫ УСПЕШНО ВЫКЛЮЧЕНЫ');
  } else {
    await bot.sendMessage(chatId, '❌ Используйте: .tex on (минуты) или .tex off');
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

  const ban = await isBanned(userId);
  if (ban && !isAdmin(userId)) {
    await tryDeleteMessage(chatId, msg.message_id);
    let banMsg = `⛔ ВАС ЗАБЛОКИРОВАЛИ В БОТЕ\n\n📌 Причина: ${ban.reason}`;
    if (ban.forever) {
      banMsg += `\n⏳ БАН НАВСЕГДА`;
    } else {
      banMsg += `\n⏳ Разблокировка: ${new Date(ban.unban_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
    }
    await bot.sendMessage(chatId, banMsg);
    return true;
  }

  switch (cmd) {
    case 'help':
      await tryDeleteMessage(chatId, msg.message_id);
      await bot.sendMessage(chatId, helpText);
      return true;

    case 'whois':
      if (args.length < 2) {
        await bot.sendMessage(chatId, '❌ Укажите тип и данные для пробива.\n\nПримеры:\n.whois ip 8.8.8.8\n.whois n +79991234567\n.whois qz @username');
        return true;
      }
      await tryDeleteMessage(chatId, msg.message_id);
      const type = args[0];
      const data = args.slice(1).join(' ');
      
      if (type === 'ip') {
        await sendProcessingAnimation(chatId, 'ПРОВЕРКА IP');
        await bot.sendMessage(chatId, formatResult1(data), { parse_mode: 'HTML' });
      } else if (type === 'n') {
        await sendProcessingAnimation(chatId, 'ПРОВЕРКА НОМЕРА');
        await bot.sendMessage(chatId, formatResult2(data), { parse_mode: 'HTML' });
      } else if (type === 'qz') {
        await sendProcessingAnimation(chatId, 'ПРОВЕРКА USERNAME');
        await bot.sendMessage(chatId, formatResult3(data), { parse_mode: 'HTML' });
      } else {
        await bot.sendMessage(chatId, '❌ Неверный тип. Используйте: ip, n, qz');
      }
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
  if (techWorks.active && !isAdmin(userId)) {
    await bot.sendMessage(chatId, `🛠️ БОТ НА ТЕХНИЧЕСКИХ РАБОТАХ\n\n🕐 ВРЕМЯ: ${new Date(techWorks.until).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`);
    return true;
  }

  const ban = await isBanned(userId);
  if (ban && !isAdmin(userId)) {
    let banMsg = `⛔ ВЫ ЗАБЛОКИРОВАНЫ В БОТЕ\n\n📌 Причина: ${ban.reason}`;
    if (ban.forever) {
      banMsg += `\n⏳ БАН НАВСЕГДА`;
    } else {
      banMsg += `\n⏳ Разблокировка: ${new Date(ban.unban_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
    }
    await bot.sendMessage(chatId, banMsg);
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

    let headerText, resultText;
    if (funcId === 'func1') {
      headerText = 'ПРОВЕРКА IP';
      resultText = formatResult1(text);
    } else if (funcId === 'func2') {
      headerText = 'ПРОВЕРКА НОМЕРА';
      resultText = formatResult2(text);
    } else if (funcId === 'func3') {
      headerText = 'ПРОВЕРКА USERNAME';
      resultText = formatResult3(text);
    }

    await sendProcessingAnimation(chatId, headerText);
    await bot.sendMessage(chatId, resultText, { parse_mode: 'HTML' });
    await logCommand(userId, username, `[Функция ${funcId === 'func1' ? '1' : funcId === 'func2' ? '2' : '3'}] ${text}`);
    return;
  }

  if (!text) return;

  // Бизнес-команды
  if (text.startsWith('.')) {
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
    'func1': { text: 'Пробив IP', id: 'func1' },
    'func2': { text: 'Пробив номера', id: 'func2' },
    'func3': { text: 'Пробив юзера (@)', id: 'func3' }
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
  console.log('Инициализация файлов...');
  await initFiles();
  console.log('Бот запущен...');
  await checkExpiredBans();
  const tech = await getTechWorks();
  if (tech.active) {
    console.log('Тех-работы активны до:', tech.until);
  }
  console.log('Админ ID:', ADMIN_ID);
  console.log('Бот готов к работе!');
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
