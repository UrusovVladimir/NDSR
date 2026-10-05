// socket/handlers/chat.js — чат и онлайн-пользователи: get_chat_history,
// chat_message, user_typing, user_stop_typing, disconnect.
// История и онлайн живут только в памяти процесса.
import { on } from '../wrap.js';
import { users } from '../../devices.js';

let chatHistory = [];
const onlineUsers = new Set();

export function register(socket, io) {
  on(socket, 'get_chat_history', () => {
    socket.emit('chat_history', chatHistory)
  }, { ack: false })

  function getUserNameByIp(ip) {
    if (!ip || ip === 'unknown') return 'Unknown User';
    
    const user = users.find(u => u.ip === ip);
    if (user && user.name) {
      return user.name;
    }
    
    const ipParts = ip.split('.');
    const lastPart = ipParts.length > 0 ? ipParts[ipParts.length - 1] : 'Unknown';
    return `User_${lastPart}`;
  }
  
  on(socket, 'chat_message', (messageData) => {
    const clientIp = socket.clientIp || 'unknown';
    const senderName = getUserNameByIp(clientIp);
    console.log('📨 Creating message:', {
      clientIp: clientIp,
      senderName: senderName,
      text: messageData.text,
      users: users.length
    });
    const message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      text: messageData.text,
      senderType: messageData.senderType || 'user',
      senderName: senderName,
      senderIp: clientIp,
      timestamp: new Date(),
      clientIp: clientIp,
      targetIp: messageData.targetIp || null,
      isMention: messageData.isMention || false,
      notifyAll: messageData.notifyAll || false
    };
    
    chatHistory.push(message)
    if (chatHistory.length > 100) {
      chatHistory = chatHistory.slice(-100)
    }
    
    io.emit('chat_message', message)
    socket.emit('message_sent', message)
  }, { ack: false })

  on(socket, 'user_typing', () => {
    socket.broadcast.emit('user_typing', {
      clientIp: socket.clientIp,
      userId: socket.id
    })
  }, { ack: false })

  on(socket, 'user_stop_typing', () => {
    socket.broadcast.emit('user_stop_typing', {
      clientIp: socket.clientIp,
      userId: socket.id
    })
  }, { ack: false })

  onlineUsers.add(socket.clientIp)

  const user = users.find(u => u.ip === socket.clientIp);
  const userName = user ? user.name : `User_${socket.clientIp?.split('.')?.pop() || 'Unknown'}`;

  io.emit('online_users', {
    size: onlineUsers.size,
    users: Array.from(onlineUsers)
  })

  io.emit('system_message', {
    text: `${userName} подключился к чату. Онлайн: ${onlineUsers.size}`
  })

  on(socket, 'disconnect', () => {
    onlineUsers.delete(socket.clientIp)
    
    const user = users.find(u => u.ip === socket.clientIp);
    const userName = user ? user.name : `User_${socket.clientIp?.split('.')?.pop() || 'Unknown'}`;
    
    io.emit('online_users', {
      size: onlineUsers.size,
      users: Array.from(onlineUsers)
    })
    
    io.emit('system_message', {
      text: `${userName} отключился от чата. Онлайн: ${onlineUsers.size}`
    })
  }, { ack: false })
}
