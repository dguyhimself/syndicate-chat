const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

// --- User Data Persistence ---
const USERS_DB_PATH = path.join(__dirname, 'users.json');

// Function to read users from the JSON file
const readUsers = () => {
    try {
        if (fs.existsSync(USERS_DB_PATH)) {
            const data = fs.readFileSync(USERS_DB_PATH);
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Error reading users.json:", error);
    }
    // If file doesn't exist or is empty, return a default list
    return {
        'Architect': { passwordHash: null, rank: 'architect' }, // Example admin without a real password
        'Nyx': { passwordHash: null, rank: 'enforcer' }
    };
};

// Function to write users to the JSON file
const writeUsers = (users) => {
    try {
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error("Error writing to users.json:", error);
    }
};

let usersDB = readUsers();

// In-memory storage for chat history
const chatHistory = {
    general: [],
    operations: [],
    'intel-drops': [],
    'proof-of-work': []
};
const MAX_HISTORY = 100;
const typingUsers = {};

// Serve the main index.html file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- Authentication Events ---
    socket.on('register', async (data) => {
        const { username, password, inviteCode } = data;

        // 1. Validate Invite Code
        if (inviteCode !== '123') {
            return socket.emit('register error', 'Invalid Invitation Code.');
        }
        // 2. Check if username is already taken
        if (usersDB[username]) {
            return socket.emit('register error', 'Alias is already in use.');
        }
        
        // 3. Hash the password and save the new user
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        
        usersDB[username] = { passwordHash, rank: 'soldier' };
        writeUsers(usersDB); // Save to file

        const userData = { alias: username, rank: 'soldier' };
        socket.emit('register success', userData);
        
        // Assign data to the socket for this session
        socket.username = userData.alias;
        socket.rank = userData.rank;
    });

    socket.on('login', async (data) => {
        const { username, password } = data;
        const user = usersDB[username];

        // 1. Check if user exists
        if (!user || !user.passwordHash) {
            return socket.emit('login error', 'Invalid credentials.');
        }

        // 2. Compare password with the stored hash
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return socket.emit('login error', 'Invalid credentials.');
        }

        const userData = { alias: username, rank: user.rank };
        socket.emit('login success', userData);

        // Assign data to the socket for this session
        socket.username = userData.alias;
        socket.rank = userData.rank;
    });

    // --- Chat Logic Events ---
    socket.on('user joined', (data) => {
        socket.username = data.alias;
        socket.rank = data.rank;
        socket.emit('channel history', { channel: 'general', history: chatHistory.general });
    });

    socket.on('switch channel', (channel) => {
        socket.emit('channel history', { channel: channel, history: chatHistory[channel] });
    });

    socket.on('chat message', (msg) => {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const completeMsg = { ...msg, timestamp };

        chatHistory[msg.channel].push(completeMsg);
        if (chatHistory[msg.channel].length > MAX_HISTORY) {
            chatHistory[msg.channel].shift();
        }
        socket.broadcast.emit('chat message', completeMsg);
    });
    
    socket.on('user typing', (data) => {
        typingUsers[socket.id] = { username: socket.username, channel: data.channel };
        socket.broadcast.emit('typing broadcast', typingUsers);
    });

    socket.on('user stopped typing', () => {
        delete typingUsers[socket.id];
        socket.broadcast.emit('typing broadcast', typingUsers);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete typingUsers[socket.id];
        socket.broadcast.emit('typing broadcast', typingUsers);
    });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
