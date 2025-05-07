const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const TELEGRAM_TOKEN = '7812145059:AAH375hTnRtYzrfmpKI9g-YjB90Z8JbAgtI';
const TELEGRAM_CHAT_ID = '729406890';
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const clients = new Map();

const messageUserMap = new Map();

const bannedUsers = new Set();


if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}


wss.on('connection', (ws, req) => {
  const userId = new URLSearchParams(req.url.split('?')[1]).get('userId') || 'default';
  clients.set(userId, ws);
  console.log(`Client connected: ${userId}`);

  ws.on('message', (data) => {
    const { text, userId } = JSON.parse(data);
    if (bannedUsers.has(userId)) {
      ws.send(JSON.stringify({ type: 'bot', text: 'Вы заблокированы и не можете отправлять сообщения.' }));
      return;
    }
    bot.sendMessage(TELEGRAM_CHAT_ID, `Сообщение от ${userId}: ${text}`).then((sentMessage) => {
      messageUserMap.set(sentMessage.message_id, userId);
      console.log(`Saved: message_id=${sentMessage.message_id}, userId=${userId}`);
    });
  });

  ws.on('close', () => {
    clients.delete(userId);
    console.log(`Client disconnected: ${userId}`);
  });
});

app.post('/send-message', (req, res) => {
  const { message, userId } = req.body;
  if (!message || !userId) {
    return res.status(400).json({ success: false, error: 'Missing message or userId' });
  }
  if (bannedUsers.has(userId)) {
    return res.status(403).json({ success: false, error: 'User is banned' });
  }
  bot.sendMessage(TELEGRAM_CHAT_ID, `Сообщение от ${userId}: ${message}`).then((sentMessage) => {
    messageUserMap.set(sentMessage.message_id, userId);
  });
  res.json({ success: true });
});

app.post('/send-image', upload.single('image'), (req, res) => {
  const { userId } = req.body;
  const file = req.file;
  if (!file || !userId) {
    if (file) {
      fs.unlinkSync(file.path);
    }
    return res.status(400).json({ success: false, error: 'Missing image or userId' });
  }
  if (bannedUsers.has(userId)) {
    fs.unlinkSync(file.path); 
    return res.status(403).json({ success: false, error: 'User is banned' });
  }
  bot.sendPhoto(TELEGRAM_CHAT_ID, file.path, { caption: `Изображение от ${userId}` }).then((sentMessage) => {
    messageUserMap.set(sentMessage.message_id, userId);
    fs.unlinkSync(file.path); 
  }).catch((error) => {
    console.error('Error sending photo to Telegram:', error);
    fs.unlinkSync(file.path); 
    return res.status(500).json({ success: false, error: 'Failed to send image' });
  });
  res.json({ success: true });
});


bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;


  if (chatId == TELEGRAM_CHAT_ID && msg.from.is_bot) {
    return;
  }

  if (chatId == TELEGRAM_CHAT_ID) {
    if (text.startsWith('/ban')) {
      const userId = text.split(' ')[1];
      if (userId) {
        bannedUsers.add(userId);
        const ws = clients.get(userId);
        if (ws) {
          ws.send(JSON.stringify({ type: 'ban' }));
        }
        bot.sendMessage(TELEGRAM_CHAT_ID, `Пользователь ${userId} заблокирован.`);
      } else {
        bot.sendMessage(TELEGRAM_CHAT_ID, 'Укажите userId: /ban <userId>');
      }
      return;
    }

    if (text.startsWith('/unban')) {
      const userId = text.split(' ')[1];
      if (userId) {
        bannedUsers.delete(userId);
        const ws = clients.get(userId);
        if (ws) {
          ws.send(JSON.stringify({ type: 'unban' }));
        }
        bot.sendMessage(TELEGRAM_CHAT_ID, `Пользователь ${userId} разблокирован.`);
      } else {
        bot.sendMessage(TELEGRAM_CHAT_ID, 'Укажите userId: /unban <userId>');
      }
      return;
    }

    if (msg.reply_to_message) {
      const repliedMessageId = msg.reply_to_message.message_id;
      const userId = messageUserMap.get(repliedMessageId);
      if (userId) {
        const ws = clients.get(userId);
        if (ws) {
          ws.send(JSON.stringify({ type: 'bot', text: text }));
          console.log(`Sent reply to client ${userId}: ${text}`);
        } else {
          bot.sendMessage(TELEGRAM_CHAT_ID, `Ошибка: Клиент ${userId} не подключен`);
        }
      } else {
        bot.sendMessage(TELEGRAM_CHAT_ID, `Ошибка: Не найден userId для сообщения с ID ${repliedMessageId}`);
      }
    } else {
      bot.sendMessage(TELEGRAM_CHAT_ID, `Пожалуйста, используйте "Ответить" (смахните влево на сообщение), чтобы отправить ответ клиенту.`);
    }
  }
});


server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
