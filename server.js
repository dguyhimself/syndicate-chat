const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// Serve the main index.html file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// In-memory storage for chat history (last 100 messages per channel)
const chatHistory = {
    general: [],
    operations: [],
    'intel-drops': [],
    'proof-of-work': []
};
const MAX_HISTORY = 100;

// Object to track who is typing in which channel
const typingUsers = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // When a user logs in, send them the history for the default channel
    socket.on('user joined', (data) => {
        socket.username = data.alias;
        socket.rank = data.rank;
        socket.emit('channel history', { channel: 'general', history: chatHistory.general });
    });

    // Listen for a user switching channels
    socket.on('switch channel', (channel) => {
        socket.emit('channel history', { channel: channel, history: chatHistory[channel] });
    });

    // Listen for a new chat message
    socket.on('chat message', (msg) => {
        // Add timestamp to the message object
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const completeMsg = { ...msg, timestamp };

        // Store message in history
        chatHistory[msg.channel].push(completeMsg);
        if (chatHistory[msg.channel].length > MAX_HISTORY) {
            chatHistory[msg.channel].shift(); // Remove the oldest message
        }

        // Broadcast the message to everyone else in the room
        socket.broadcast.emit('chat message', completeMsg);
    });
    
    // Listen for "is typing" event
    socket.on('user typing', (data) => {
        typingUsers[socket.id] = { username: socket.username, channel: data.channel };
        // Broadcast to everyone except the sender
        socket.broadcast.emit('typing broadcast', typingUsers);
    });

    // Listen for "stopped typing" event
    socket.on('user stopped typing', () => {
        delete typingUsers[socket.id];
        socket.broadcast.emit('typing broadcast', typingUsers);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Make sure to remove user from typing list if they disconnect
        delete typingUsers[socket.id];
        socket.broadcast.emit('typing broadcast', typingUsers);
    });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
