const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000; // Important for Render

// --- User Data Persistence ---
const USERS_DB_PATH = path.join(__dirname, 'users.json');

const readUsers = () => {
    try {
        if (fs.existsSync(USERS_DB_PATH)) {
            const data = fs.readFileSync(USERS_DB_PATH);
            return JSON.parse(data);
        }
    } catch (error) { console.error("Error reading users.json:", error); }
    // If file doesn't exist, create it with Architect as the first user
    const initialUser = { 'Architect': { passwordHash: null, rank: 'architect' } };
    writeUsers(initialUser);
    return initialUser;
};

const writeUsers = (users) => {
    try {
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2));
    } catch (error) { console.error("Error writing to users.json:", error); }
};

let usersDB = readUsers();

// --- In-Memory State ---
const chatHistory = { general: [], operations: [], 'intel-drops': [], 'proof-of-work': [] };
const MAX_HISTORY = 100;
const typingUsers = {};
let onlineUsers = {}; // Tracks currently online users: { username: 'rank' }

// --- System Data Broadcasting ---
const broadcastSystemData = () => {
    // 1. Get total user count
    const totalUsers = Object.keys(usersDB).length;

    // 2. Create the full user roster, ensuring Architect is first
    const userRoster = Object.keys(usersDB).map(username => ({
        alias: username,
        rank: usersDB[username].rank
    })).sort((a, b) => {
        if (a.alias === 'Architect') return -1;
        if (b.alias === 'Architect') return 1;
        return a.alias.localeCompare(b.alias);
    });

    // 3. Get list of online usernames
    const onlineUsernames = Object.keys(onlineUsers);

    const systemData = { totalUsers, userRoster, onlineUsernames };
    io.emit('system update', systemData);
};

// Serve the main index.html file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- Authentication ---
    const handleSuccessfulAuth = (userData) => {
        socket.username = userData.alias;
        socket.rank = userData.rank;
        onlineUsers[socket.username] = socket.rank;
        broadcastSystemData(); // Broadcast update to everyone
    };

    socket.on('register', async (data) => {
        const { username, password, inviteCode } = data;
        if (inviteCode !== '123') return socket.emit('register error', 'Invalid Invitation Code.');
        if (usersDB[username]) return socket.emit('register error', 'Alias is already in use.');
        
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        
        usersDB[username] = { passwordHash, rank: 'soldier' };
        writeUsers(usersDB);

        const userData = { alias: username, rank: 'soldier' };
        socket.emit('register success', userData);
        handleSuccessfulAuth(userData);
    });

    socket.on('login', async (data) => {
        const { username, password } = data;
        const user = usersDB[username];
        if (!user || !user.passwordHash) return socket.emit('login error', 'Invalid credentials.');

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) return socket.emit('login error', 'Invalid credentials.');

        const userData = { alias: username, rank: user.rank };
        socket.emit('login success', userData);
        handleSuccessfulAuth(userData);
    });

    // --- Chat Logic ---
    socket.on('user joined', () => {
        // When a user joins, send them the latest system data
        const totalUsers = Object.keys(usersDB).length;
        const userRoster = Object.keys(usersDB).map(username => ({ alias: username, rank: usersDB[username].rank })).sort((a, b) => a.alias === 'Architect' ? -1 : 1);
        const onlineUsernames = Object.keys(onlineUsers);
        socket.emit('system update', { totalUsers, userRoster, onlineUsernames });
        socket.emit('channel history', { channel: 'general', history: chatHistory.general });
    });

    socket.on('switch channel', (channel) => {
        socket.emit('channel history', { channel, history: chatHistory[channel] || [] });
    });

    socket.on('chat message', (msg) => {
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const completeMsg = { ...msg, timestamp };
        if (!chatHistory[msg.channel]) chatHistory[msg.channel] = [];
        chatHistory[msg.channel].push(completeMsg);
        if (chatHistory[msg.channel].length > MAX_HISTORY) chatHistory[msg.channel].shift();
        socket.broadcast.emit('chat message', completeMsg);
    });
    
    socket.on('user typing', (data) => {
        if (!socket.username) return;
        typingUsers[socket.id] = { username: socket.username, channel: data.channel };
        socket.broadcast.emit('typing broadcast', typingUsers);
    });

    socket.on('user stopped typing', () => {
        delete typingUsers[socket.id];
        socket.broadcast.emit('typing broadcast', typingUsers);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (socket.username) {
            delete onlineUsers[socket.username];
            broadcastSystemData(); // Broadcast update when a user logs off
        }
        delete typingUsers[socket.id];
        socket.broadcast.emit('typing broadcast', typingUsers);
    });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
