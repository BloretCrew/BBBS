const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cookieSession = require('cookie-session');
const multer = require('multer');
const FormData = require('form-data');
const config = require('./config.json');

const app = express();
const upload = multer(); // 用于处理内存中的文件上传

// 中间件配置
app.use(express.json());
app.use(express.static('public'));
app.use(cookieSession({
    name: 'session',
    keys: ['key1', 'key2'], // 生产环境请修改为随机字符串
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

// 初始化数据目录
function initDataDir() {
    if (!fs.existsSync(config.data_dir)) {
        fs.mkdirSync(config.data_dir, { recursive: true });
        // 创建示例数据
        const demoPath = path.join(config.data_dir, '技术交流', 'NodeJS');
        fs.mkdirSync(demoPath, { recursive: true });
        fs.writeFileSync(path.join(demoPath, 'Hello_World.json'), JSON.stringify({
            title: "Hello World",
            author: "Admin",
            content: "欢迎来到 Bloret BBS！这是一个基于文件的论坛系统。",
            time: Date.now(),
            tags: ["置顶", "公告"]
        }));
    }
}
initDataDir();

// --- 路由: OAuth 登录 ---

app.get('/login', (req, res) => {
    const authUrl = `${config.passport_host}/app/oauth?app_id=${config.app_id}&redirect_uri=${encodeURIComponent(config.callback_url)}`;
    res.redirect(authUrl);
});

app.get('/login/BPoauth', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('登录失败: 缺少 Code');

    try {
        // 换取用户信息
        const verifyUrl = `${config.passport_host}/app/verify?app_id=${config.app_id}&app_secret=${config.app_secret}&code=${code}`;
        const response = await axios.get(verifyUrl);

        if (response.data.error) {
            return res.status(401).send(response.data.error);
        }

        // 存储 Session
        req.session.user = response.data;
        res.redirect('/'); // 回到首页
    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).send('认证服务器连接失败');
    }
});

app.get('/api/user', (req, res) => {
    res.json(req.session.user || null);
});

app.get('/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
});

// --- 路由: 数据 API (板块 -> 分区 -> 帖子) ---

// 获取完整的板块结构
app.get('/api/structure', (req, res) => {
    const structure = {};
    
    try {
        const boards = fs.readdirSync(config.data_dir);
        boards.forEach(board => {
            const boardPath = path.join(config.data_dir, board);
            if (fs.statSync(boardPath).isDirectory()) {
                structure[board] = [];
                const sections = fs.readdirSync(boardPath);
                sections.forEach(section => {
                    const sectionPath = path.join(boardPath, section);
                    if (fs.statSync(sectionPath).isDirectory()) {
                        structure[board].push(section);
                    }
                });
            }
        });
        res.json(structure);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 获取特定分区下的帖子列表
app.get('/api/posts', (req, res) => {
    const { board, section } = req.query;
    if (!board || !section) return res.status(400).json({ error: 'Missing params' });

    const dirPath = path.join(config.data_dir, board, section);
    if (!fs.existsSync(dirPath)) return res.json([]);

    const files = fs.readdirSync(dirPath);
    const posts = files.map(file => {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf8'));
            return { filename: file, ...content };
        } catch (e) { return null; }
    }).filter(p => p !== null);

    res.json(posts);
});

// 获取板块信息（包含所有者）
app.get('/api/board/info', (req, res) => {
    const { board } = req.query;
    if (!board) return res.status(400).json({ error: 'Missing board' });
    const ownerFile = path.join(config.data_dir, board, 'owner.json');
    if (fs.existsSync(ownerFile)) {
        res.json(JSON.parse(fs.readFileSync(ownerFile, 'utf8')));
    } else {
        res.json({ owner: 'system' });
    }
});

// 新建板块 (任何人)
app.post('/api/board', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { name } = req.body;
    if (!name || name.includes('..')) return res.status(400).json({ error: '无效名称' });
    const boardPath = path.join(config.data_dir, name);
    if (fs.existsSync(boardPath)) return res.status(400).json({ error: '板块已存在' });
    fs.mkdirSync(boardPath, { recursive: true });
    fs.writeFileSync(path.join(boardPath, 'owner.json'), JSON.stringify({ owner: req.session.user.username }));
    res.json({ success: true });
});

// 新建分区 (仅限板块创建者)
app.post('/api/section', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, name } = req.body;
    const ownerFile = path.join(config.data_dir, board, 'owner.json');
    if (!fs.existsSync(ownerFile)) return res.status(403).json({ error: '无法验证所有权' });
    const info = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    if (info.owner !== req.session.user.username) return res.status(403).json({ error: '只有板块创建者可以新建分区' });
    const sectionPath = path.join(config.data_dir, board, name);
    if (fs.existsSync(sectionPath)) return res.status(400).json({ error: '分区已存在' });
    fs.mkdirSync(sectionPath, { recursive: true });
    res.json({ success: true });
});

app.post('/api/post', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, title, content, tags } = req.body;
    if (board.includes('..') || section.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    const dirPath = path.join(config.data_dir, board, section);
    if (!fs.existsSync(dirPath)) return res.status(400).json({ error: '分区不存在' });
    const filename = `${Date.now()}_${Math.random().toString(36).substr(2, 5)}.json`;
    const postData = {
        title,
        content,
        author: req.session.user.username,
        author_email: req.session.user.email,
        time: Date.now(),
        tags: tags || []
    };
    fs.writeFileSync(path.join(dirPath, filename), JSON.stringify(postData));
    res.json({ success: true, filename });
});

// --- 路由: 图片上传代理 ---
app.post('/api/upload-proxy', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "No file" });

    try {
        const form = new FormData();
        form.append('image', req.file.buffer, req.file.originalname);

        const response = await axios.post(`${config.image_host}/api/upload`, form, {
            headers: { ...form.getHeaders() }
        });

        res.json(response.data);
    } catch (error) {
        console.error("Image Upload Error:", error.message);
        res.status(500).json({ success: false, message: "Upload failed" });
    }
});

app.listen(config.port, () => {
    console.log(`Bloret BBS running at http://localhost:${config.port}`);
});