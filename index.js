const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// 1. Database Connection Pool (Handles reconnections automatically)
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'task_manager_db',
    port: process.env.DB_PORT || 3306,
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// CREATE TABLES AUTOMATICALLY ON STARTUP
const initSchema = `
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    profileImage VARCHAR(255) DEFAULT NULL,
    bio TEXT DEFAULT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userId INT,
    title VARCHAR(255) NULL,
    description TEXT NULL,
    status VARCHAR(50) DEFAULT 'Pending',
    priority VARCHAR(50) DEFAULT 'Medium',
    dueDate DATE DEFAULT NULL,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
`;

db.query(initSchema, (err) => {
    if (err) {
        console.error('Error initializing database tables:', err.message);
    } else {
        console.log('MySQL Connected and tables are ready.');
    }
});

// --- AUTHENTICATION ENDPOINTS ---

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)';
        db.query(sql, [username, email, hashedPassword], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: "Username or Email already exists" });
            res.json({ success: true, message: "User Registered Successfully" });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const sql = 'SELECT * FROM users WHERE username = ?';
    db.query(sql, [username], async (err, results) => {
        if (err) return res.status(500).json({ success: false, message: "Database error" });
        if (results.length > 0) {
            const match = await bcrypt.compare(password, results[0].password);
            if (match) {
                const { password, ...userWithoutPassword } = results[0];
                res.json({ success: true, user: userWithoutPassword });
            } else {
                res.json({ success: false, message: "Incorrect password" });
            }
        } else {
            res.json({ success: false, message: "User not found" });
        }
    });
});

// --- TASK CRUD ENDPOINTS ---

// Get a specific task by ID (MOVED UP)
app.get('/api/tasks/:id', (req, res) => {
    console.log(`GET Task ID: ${req.params.id}`);
    db.query('SELECT * FROM tasks WHERE id = ?', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (results.length > 0) {
            res.json({ success: true, task: results[0] });
        } else {
            res.status(404).json({ success: false, message: "Task not found" });
        }
    });
});

app.get('/api/tasks', (req, res) => {
    const userId = req.query.userId;
    db.query('SELECT * FROM tasks WHERE userId = ? ORDER BY createdAt DESC', [userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, tasks: results });
    });
});

app.post('/api/tasks', (req, res) => {
    const { userId, title, description, status } = req.body;
    const sql = 'INSERT INTO tasks (userId, title, description, status) VALUES (?, ?, ?, ?)';
    db.query(sql, [userId, title, description, status], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({
            success: true,
            message: "Task created successfully",
            taskId: result.insertId
        });
    });
});

app.put('/api/tasks/:id', (req, res) => {
    const { title, description, status } = req.body;
    const sql = 'UPDATE tasks SET title = ?, description = ?, status = ? WHERE id = ?';
    db.query(sql, [title, description, status, req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Task updated successfully" });
    });
});

app.delete('/api/tasks/:id', (req, res) => {
    db.query('DELETE FROM tasks WHERE id = ?', [req.params.id], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Task deleted successfully" });
    });
});

// --- PROFILE ENDPOINTS ---

app.get('/api/profile/:userId', (req, res) => {
    db.query('SELECT id, username, email, profileImage, bio FROM users WHERE id = ?', [req.params.userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        if (results.length > 0) {
            res.json({ success: true, user: results[0] });
        } else {
            res.status(404).json({ success: false, message: "User not found" });
        }
    });
});

app.put('/api/profile/:userId', (req, res) => {
    const { email, bio } = req.body;
    const sql = 'UPDATE users SET email = ?, bio = ? WHERE id = ?';
    db.query(sql, [email, bio, req.params.userId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Profile updated successfully" });
    });
});

app.post('/api/profile/:userId/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    const sql = 'UPDATE users SET profileImage = ? WHERE id = ?';
    db.query(sql, [imageUrl, req.params.userId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Image uploaded successfully", profileImage: imageUrl });
    });
});

// Dashboard Summary
app.get('/api/dashboard/:userId', (req, res) => {
    const sql = `SELECT 
        COUNT(*) as total, 
        IFNULL(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) as pending,
        IFNULL(SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END), 0) as in_progress,
        IFNULL(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) as completed
        FROM tasks WHERE userId = ?`;
    db.query(sql, [req.params.userId], (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(results[0] || { total: 0, pending: 0, in_progress: 0, completed: 0 });
    });
});

// --- DEBUG ENDPOINT: SEE ALL USERS ---
app.get('/api/debug/users', (req, res) => {
    db.query('SELECT id, username, email, createdAt FROM users', (err, results) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, users: results });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Server is running on port ${PORT}`);
});
