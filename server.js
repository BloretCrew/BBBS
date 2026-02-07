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

// 修复前端 Bug：拦截首页请求，将列表点击事件替换为 Wrapper 调用，以触发置顶权限检查
app.get('/', (req, res, next) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, 'utf8');
        // 将 item.onclick = () => showPostDetail(...) 替换为 item.onclick = () => showPostDetailWrapper(...)
        html = html.replace(
            /item\.onclick\s*=\s*\(\)\s*=>\s*showPostDetail\(post,\s*board,\s*section\);/g,
            'item.onclick = () => showPostDetailWrapper(post.filename, board, section);'
        );
        res.send(html);
    } else {
        next();
    }
});

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
            tags: ["置顶", "公告"],
            likes: [], // 存储点赞用户名的数组
            shares: 0
        }));
    }
}

// 初始化用户数据目录
function initUserDir() {
    const userDir = path.join(config.data_dir, '..', 'users'); // data/users
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}

initDataDir();
const userDir = initUserDir();

// 路由: 辅助工具页面
app.get('/get-token.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'get-token.html'));
});

// 路由: 资源 public/res/*
app.get('/res/*', (req, res) => {
    const resourcePath = path.join(__dirname, 'public', req.path);
    if (fs.existsSync(resourcePath)) {
        res.sendFile(resourcePath);
    } else {
        res.status(404).send('资源未找到');
    }
});



// 路由：OAuth 登录

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
    if (!req.session.user) return res.json(null);
    const user = { ...req.session.user };
    // 在返回用户信息时，根据配置文件判断其是否为超级管理员
    user.isSuperAdmin = config.super_admins?.includes(user.username);
    res.json(user);
});

// 新增 API: 获取用户所有权限
app.get('/api/user/permissions', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const username = req.session.user.username;

    const result = {
        isSuperAdmin: config.super_admins?.includes(username) || false,
        ownedBoards: [],
        adminBoards: [],
        sectionAdmins: []
    };

    try {
        const boards = fs.readdirSync(config.data_dir);
        boards.forEach(board => {
            const boardPath = path.join(config.data_dir, board);
            if (!fs.statSync(boardPath).isDirectory()) return;

            const infoFile = path.join(boardPath, 'owner.json');
            if (fs.existsSync(infoFile)) {
                try {
                    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
                    if (info.owner === username) result.ownedBoards.push(board);
                    if (info.admins?.includes(username)) result.adminBoards.push(board);
                    if (info.sectionAdmins) {
                        Object.entries(info.sectionAdmins).forEach(([sec, admins]) => {
                            if (admins.includes(username)) result.sectionAdmins.push({ board, section: sec });
                        });
                    }
                } catch (e) { }
            }
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
});

// --- 路由: 数据 API (板块 -> 分区 -> 帖子) ---

// 获取完整的板块结构 (支持自定义排序)
app.get('/api/structure', (req, res) => {
    const structure = {};
    try {
        const boards = fs.readdirSync(config.data_dir);
        boards.forEach(board => {
            const boardPath = path.join(config.data_dir, board);
            if (fs.statSync(boardPath).isDirectory()) {
                // 读取排序配置
                let orderedSections = [];
                const infoFile = path.join(boardPath, 'owner.json');
                if (fs.existsSync(infoFile)) {
                    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
                    orderedSections = info.sectionsOrder || [];
                }

                const actualSections = fs.readdirSync(boardPath).filter(f => fs.statSync(path.join(boardPath, f)).isDirectory());

                // 按照 orderedSections 排序，没在排序列表里的放后面
                actualSections.sort((a, b) => {
                    const idxA = orderedSections.indexOf(a);
                    const idxB = orderedSections.indexOf(b);
                    if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });

                structure[board] = actualSections;
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
            if (!content.likes) content.likes = [];
            if (!content.shares) content.shares = 0;
            return { filename: file, board, section, filename: file, ...content };
        } catch (e) { return null; }
    }).filter(p => p !== null);

    res.json(posts);
});

// --- 新增 API: 获取全局所有帖子 (用于 Today 和 最新) ---
app.get('/api/all-posts', (req, res) => {
    let allPosts = [];
    const boards = fs.readdirSync(config.data_dir);
    boards.forEach(board => {
        const boardPath = path.join(config.data_dir, board);
        if (!fs.statSync(boardPath).isDirectory()) return;
        const sections = fs.readdirSync(boardPath);
        sections.forEach(section => {
            const sectionPath = path.join(boardPath, section);
            if (!fs.statSync(sectionPath).isDirectory()) return;
            const files = fs.readdirSync(sectionPath);
            files.forEach(file => {
                if (!file.endsWith('.json') || file === 'owner.json') return;
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(sectionPath, file), 'utf8'));
                    allPosts.push({ ...content, board, section, filename: file });
                } catch (e) { }
            });
        });
    });
    res.json(allPosts);
});

// --- 新增 API: 板块管理 (设置管理员) ---
app.post('/api/board/admin', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, adminName, action } = req.body; // action: 'add' or 'remove'
    const infoFile = path.join(config.data_dir, board, 'owner.json');
    if (!fs.existsSync(infoFile)) return res.status(404).json({ error: '板块不存在' });

    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    if (info.owner !== req.session.user.username) return res.status(403).json({ error: '只有创建者可以管理管理员' });

    if (!info.admins) info.admins = [];
    if (action === 'add') {
        if (!info.admins.includes(adminName)) info.admins.push(adminName);
    } else {
        info.admins = info.admins.filter(a => a !== adminName);
    }

    fs.writeFileSync(infoFile, JSON.stringify(info));
    res.json({ success: true, admins: info.admins });
});

// --- 新增 API: 点赞 ---
app.post('/api/post/like', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, filename } = req.body;
    const filePath = path.join(config.data_dir, board, section, filename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '帖子不存在' });

    try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!content.likes) content.likes = [];
        if (!content.history) content.history = [];

        const username = req.session.user.username;
        const index = content.likes.indexOf(username);

        let liked = false;
        if (index === -1) {
            content.likes.push(username);
            liked = true;
            content.history.push({ type: 'like', user: username, time: Date.now() });
        } else {
            content.likes.splice(index, 1);
            liked = false;
        }

        fs.writeFileSync(filePath, JSON.stringify(content));
        res.json({ success: true, liked, count: content.likes.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- 新增 API: 关注板块/分区 ---
// 用户数据结构: data/users/username.json -> { following: { boards: [], sections: [] } }
app.post('/api/user/follow', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { type, target } = req.body; // type: 'board' or 'section', target: 'BoardName' or 'BoardName/SectionName'
    const username = req.session.user.username;
    const userFile = path.join(userDir, `${username}.json`);

    let userData = { following: { boards: [], sections: [] } };
    if (fs.existsSync(userFile)) {
        userData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
        if (!userData.following) userData.following = { boards: [], sections: [] };
    }

    const list = type === 'board' ? userData.following.boards : userData.following.sections;
    const index = list.indexOf(target);
    let isFollowing = false;

    if (index === -1) {
        list.push(target);
        isFollowing = true;
    } else {
        list.splice(index, 1);
        isFollowing = false;
    }

    fs.writeFileSync(userFile, JSON.stringify(userData));
    res.json({ success: true, isFollowing });
});

// 获取用户关注状态
app.get('/api/user/follows', (req, res) => {
    if (!req.session.user) return res.json({ boards: [], sections: [] });
    const userFile = path.join(userDir, `${req.session.user.username}.json`);
    if (fs.existsSync(userFile)) {
        const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
        res.json(data.following || { boards: [], sections: [] });
    } else {
        res.json({ boards: [], sections: [] });
    }
});

// 获取板块/分区完整管理信息
app.get('/api/board/manage-info', (req, res) => {
    const { board } = req.query;
    const infoFile = path.join(config.data_dir, board, 'owner.json');
    if (!fs.existsSync(infoFile)) return res.json({ owner: 'system', blacklist: [], sectionAdmins: {}, sectionSettings: {}, muted: false });
    res.json(JSON.parse(fs.readFileSync(infoFile, 'utf8')));
});

// 统一管理 API
app.post('/api/manage/update', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, action, data } = req.body;
    const infoFile = path.join(config.data_dir, board, 'owner.json');
    if (!fs.existsSync(infoFile)) return res.status(404).json({ error: '板块配置不存在' });

    let info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    const isOwner = info.owner === req.session.user.username;
    const isSecAdmin = section && info.sectionAdmins?.[section]?.includes(req.session.user.username);

    if (!isOwner && !isSecAdmin) return res.status(403).json({ error: '权限不足' });

    switch (action) {
        case 'setMuted': // 禁言
            if (section) {
                if (!info.sectionSettings) info.sectionSettings = {};
                if (!info.sectionSettings[section]) info.sectionSettings[section] = {};
                info.sectionSettings[section].muted = data.muted;
            } else {
                if (!isOwner) return res.status(403).json({ error: '仅限创建者' });
                info.muted = data.muted;
            }
            break;
        case 'updateBlacklist': // 黑名单
            let list = section ? (info.sectionSettings?.[section]?.blacklist || []) : (info.blacklist || []);
            if (data.type === 'add') {
                if (!list.includes(data.user)) list.push(data.user);
            } else {
                list = list.filter(u => u !== data.user);
            }
            if (section) {
                if (!info.sectionSettings) info.sectionSettings = {};
                if (!info.sectionSettings[section]) info.sectionSettings[section] = {};
                info.sectionSettings[section].blacklist = list;
            } else {
                info.blacklist = list;
            }
            break;
        case 'manageSecAdmin': // 分区管理员 (仅Owner)
            if (!isOwner) return res.status(403).json({ error: '仅限创建者' });
            if (!info.sectionAdmins) info.sectionAdmins = {};
            if (!info.sectionAdmins[section]) info.sectionAdmins[section] = [];
            if (data.type === 'add') {
                if (!info.sectionAdmins[section].includes(data.user)) info.sectionAdmins[section].push(data.user);
            } else {
                info.sectionAdmins[section] = info.sectionAdmins[section].filter(u => u !== data.user);
            }
            break;
        case 'sectionConfig': // 分区改名、图片、排序 (仅Owner)
            if (!isOwner) return res.status(403).json({ error: '仅限创建者' });
            if (!info.sectionSettings) info.sectionSettings = {};
            if (!info.sectionSettings[section]) info.sectionSettings[section] = {};
            Object.assign(info.sectionSettings[section], data);
            // 如果涉及物理改名
            if (data.newName && data.newName !== section) {
                const oldPath = path.join(config.data_dir, board, section);
                const newPath = path.join(config.data_dir, board, data.newName);
                if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath);
                info.sectionSettings[data.newName] = info.sectionSettings[section];
                delete info.sectionSettings[section];
            }
            break;
        case 'deleteSection': // 删除分区 (仅Owner)
            if (!isOwner) return res.status(403).json({ error: '仅限创建者' });
            const secPath = path.join(config.data_dir, board, data.sectionName);
            if (fs.existsSync(secPath)) {
                try {
                    fs.rmSync(secPath, { recursive: true, force: true });
                    // 清理元数据
                    if (info.sectionsOrder) info.sectionsOrder = info.sectionsOrder.filter(s => s !== data.sectionName);
                    if (info.sectionAdmins && info.sectionAdmins[data.sectionName]) delete info.sectionAdmins[data.sectionName];
                    if (info.sectionSettings && info.sectionSettings[data.sectionName]) delete info.sectionSettings[data.sectionName];
                } catch (e) {
                    return res.status(500).json({ error: '删除失败: ' + e.message });
                }
            } else {
                return res.status(404).json({ error: '分区不存在' });
            }
            break;
        case 'deletePost': // 删除帖子
            const postPath = path.join(config.data_dir, board, section, data.filename);
            if (fs.existsSync(postPath)) fs.unlinkSync(postPath);
            return res.json({ success: true });
        case 'reorderSections': // 重新排序分区
            if (!isOwner) return res.status(403).json({ error: '仅限创建者' });
            info.sectionsOrder = data.newOrder;
            break;
    }

    fs.writeFileSync(infoFile, JSON.stringify(info));
    res.json({ success: true, info });
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

app.post('/api/board/rename', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    if (!config.super_admins?.includes(req.session.user.username)) return res.status(403).json({ error: '仅限超级管理员' });
    const { oldName, newName } = req.body;
    if (!newName || newName.includes('..')) return res.status(400).json({ error: '无效名称' });
    const oldPath = path.join(config.data_dir, oldName);
    const newPath = path.join(config.data_dir, newName);
    if (fs.existsSync(newPath)) return res.status(400).json({ error: '新名称已存在' });
    if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: '原板块不存在' });
    }
});

app.post('/api/board/delete', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    if (!config.super_admins?.includes(req.session.user.username)) return res.status(403).json({ error: '仅限超级管理员' });
    const { board } = req.body;
    const boardPath = path.join(config.data_dir, board);

    if (fs.existsSync(boardPath)) {
        try {
            // 使用递归删除，并捕获可能的权限或占用错误
            fs.rmSync(boardPath, { recursive: true, force: true });
            res.json({ success: true });
        } catch (e) {
            console.error("Delete Board Error:", e);
            res.status(500).json({ error: '删除失败: 文件夹可能被占用或权限不足' });
        }
    } else {
        res.status(404).json({ error: '板块不存在' });
    }
});

// 新建分区 (支持超级管理员、板块创建者、板块管理员)
app.post('/api/section', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, name } = req.body;
    const username = req.session.user.username;

    const ownerFile = path.join(config.data_dir, board, 'owner.json');
    if (!fs.existsSync(ownerFile)) return res.status(403).json({ error: '无法验证所有权' });

    const info = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    const isSuper = config.super_admins?.includes(username);
    const isOwner = info.owner === username;
    const isAdmin = info.admins?.includes(username);

    if (!isSuper && !isOwner && !isAdmin) {
        return res.status(403).json({ error: '只有超级管理员、板块创建者或板块管理员可以新建分区' });
    }

    const sectionPath = path.join(config.data_dir, board, name);
    if (fs.existsSync(sectionPath)) return res.status(400).json({ error: '分区已存在' });
    fs.mkdirSync(sectionPath, { recursive: true });
    res.json({ success: true });
});

app.post('/api/post', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, title, content, tags } = req.body;

    const infoFile = path.join(config.data_dir, board, 'owner.json');
    if (fs.existsSync(infoFile)) {
        const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
        const user = req.session.user.username;
        if (info.muted || info.sectionSettings?.[section]?.muted) return res.status(403).json({ error: '该版块/分区目前处于禁言状态' });
        if (info.blacklist?.includes(user) || info.sectionSettings?.[section]?.blacklist?.includes(user)) {
            return res.status(403).json({ error: '您已被列入黑名单，无法操作' });
        }
    }
    if (board.includes('..') || section.includes('..')) return res.status(400).json({ error: 'Invalid path' });
    const dirPath = path.join(config.data_dir, board, section);
    if (!fs.existsSync(dirPath)) return res.status(400).json({ error: '分区不存在' });

    const now = Date.now();
    const filename = `${now}_${Math.random().toString(36).substr(2, 5)}.json`;
    const postData = {
        title,
        content,
        author: req.session.user.username,
        author_avatar: req.session.user.avatar, // 存储发帖人头像
        author_email: req.session.user.email,
        time: now,
        tags: tags || [],
        history: [{ type: 'publish', user: req.session.user.username, time: now }],
        comments: []
    };
    fs.writeFileSync(path.join(dirPath, filename), JSON.stringify(postData));
    res.json({ success: true, filename });
});

// 编辑帖子 API
app.post('/api/post/edit', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, filename, title, content } = req.body;
    const filePath = path.join(config.data_dir, board, section, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '帖子不存在' });

    const post = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const perm = getPermLevel(req.session.user.username, board, section);

    if (req.session.user.username !== post.author && perm < PERMS.SEC_ADMIN) {
        return res.status(403).json({ error: '权限不足' });
    }

    const now = Date.now();
    if (!post.history) post.history = [];
    // 记录编辑历史，保存旧版本内容
    post.history.push({
        type: 'edit',
        user: req.session.user.username,
        time: now,
        oldTitle: post.title,
        oldContent: post.content
    });

    post.title = title;
    post.content = content;
    fs.writeFileSync(filePath, JSON.stringify(post));
    res.json({ success: true });
});

// 移动帖子 API
app.post('/api/post/move', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, filename, newBoard, newSection } = req.body;
    const oldPath = path.join(config.data_dir, board, section, filename);
    const newDir = path.join(config.data_dir, newBoard, newSection);
    const newPath = path.join(newDir, filename);

    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: '帖子不存在' });
    if (!fs.existsSync(newDir)) return res.status(404).json({ error: '目标分区不存在' });

    const post = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    const perm = getPermLevel(req.session.user.username, board, section);

    if (req.session.user.username !== post.author && perm < PERMS.SEC_ADMIN) {
        return res.status(403).json({ error: '权限不足' });
    }

    if (!post.history) post.history = [];
    post.history.push({
        type: 'move',
        user: req.session.user.username,
        time: Date.now(),
        from: `${board}/${section}`,
        to: `${newBoard}/${newSection}`
    });

    fs.renameSync(oldPath, newPath);
    fs.writeFileSync(newPath, JSON.stringify(post));
    res.json({ success: true });
});

// 分享历史记录 API (新增)
app.post('/api/post/share-record', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, filename } = req.body;
    const filePath = path.join(config.data_dir, board, section, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '帖子不存在' });

    const post = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!post.history) post.history = [];
    post.history.push({ type: 'share', user: req.session.user.username, time: Date.now() });
    fs.writeFileSync(filePath, JSON.stringify(post));
    res.json({ success: true });
});

// 发表评论 API
app.post('/api/comment/add', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, filename, content } = req.body;
    const filePath = path.join(config.data_dir, board, section, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '帖子不存在' });

    const post = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!post.comments) post.comments = [];

    post.comments.push({
        author: req.session.user.username,
        author_avatar: req.session.user.avatar, // 存储评论人头像
        content: content,
        time: Date.now()
    });

    fs.writeFileSync(filePath, JSON.stringify(post));
    res.json({ success: true });
});

// 投票 API
app.post('/api/post/vote', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, filename, option } = req.body;
    const filePath = path.join(config.data_dir, board, section, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '帖子不存在' });

    const post = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!post.votes) post.votes = {}; // 结构: { "选项A": ["user1", "user2"], "选项B": [] }

    const username = req.session.user.username;

    // 检查是否投过票（单选逻辑）
    for (let opt in post.votes) {
        if (post.votes[opt].includes(username)) {
            return res.status(400).json({ error: '您已经投过票了' });
        }
    }

    if (!post.votes[option]) post.votes[option] = [];
    post.votes[option].push(username);

    if (!post.history) post.history = [];
    post.history.push({ type: 'vote', user: username, time: Date.now(), option: option });

    fs.writeFileSync(filePath, JSON.stringify(post));
    res.json({ success: true, votes: post.votes });
});

// --- 完善 API: 全局深度搜索 ---
app.get('/api/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: '缺少搜索关键词' });
    const query = q.toLowerCase();

    let results = {
        posts: [],
        users: [],
        boards: [],
        sections: []
    };

    // 1. 搜索板块与分区
    const boards = fs.readdirSync(config.data_dir);
    boards.forEach(board => {
        const boardPath = path.join(config.data_dir, board);
        if (!fs.statSync(boardPath).isDirectory()) return;

        if (board.toLowerCase().includes(query)) {
            results.boards.push({ name: board });
        }

        const sections = fs.readdirSync(boardPath);
        sections.forEach(section => {
            const sectionPath = path.join(boardPath, section);
            if (!fs.statSync(sectionPath).isDirectory()) return;

            if (section.toLowerCase().includes(query)) {
                results.sections.push({ name: section, board: board });
            }

            // 2. 搜索帖子
            const files = fs.readdirSync(sectionPath);
            files.forEach(file => {
                if (!file.endsWith('.json') || file === 'owner.json') return;
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(sectionPath, file), 'utf8'));
                    if (content.title.toLowerCase().includes(query) || content.content.toLowerCase().includes(query)) {
                        results.posts.push({
                            board, section, filename: file,
                            title: content.title, author: content.author,
                            time: content.time,
                            preview: content.content.substring(0, 50) + "...",
                            content: content.content // 必须包含此项，否则前端提取图片会崩溃
                        });
                    }
                } catch (e) { }
            });
        });
    });

    // 3. 搜索用户
    if (fs.existsSync(userDir)) {
        const userFiles = fs.readdirSync(userDir);
        userFiles.forEach(file => {
            const username = file.replace('.json', '');
            if (username.toLowerCase().includes(query)) {
                results.users.push({ username });
            }
        });
    }

    res.json(results);
});

// --- 新增 API: 用户公开资料与统计 ---
app.get('/api/user/profile/:username', (req, res) => {
    const targetUser = req.params.username;
    let stats = {
        username: targetUser,
        postCount: 0,
        receivedLikes: 0,
        recentPosts: []
    };

    const boards = fs.readdirSync(config.data_dir);
    boards.forEach(board => {
        const boardPath = path.join(config.data_dir, board);
        if (!fs.statSync(boardPath).isDirectory()) return;
        fs.readdirSync(boardPath).forEach(section => {
            const sectionPath = path.join(boardPath, section);
            if (!fs.statSync(sectionPath).isDirectory()) return;
            fs.readdirSync(sectionPath).forEach(file => {
                if (!file.endsWith('.json') || file === 'owner.json') return;
                try {
                    const p = JSON.parse(fs.readFileSync(path.join(sectionPath, file), 'utf8'));
                    if (p.author === targetUser) {
                        stats.postCount++;
                        if (p.likes) stats.receivedLikes += p.likes.length;
                        stats.recentPosts.push({
                            title: p.title,
                            board,
                            section,
                            time: p.time
                        });
                    }
                } catch (e) { }
            });
        });
    });

    // 按时间倒序，只保留最近5条
    stats.recentPosts.sort((a, b) => b.time - a.time);
    stats.recentPosts = stats.recentPosts.slice(0, 5);

    res.json(stats);
});

// 权限等级定义与校验
const PERMS = { NONE: 0, POSTER: 1, SEC_ADMIN: 2, BOARD_ADMIN: 3, BOARD_OWNER: 4, SUPER: 5 };
function getPermLevel(username, board, section) {
    if (config.super_admins?.includes(username)) return PERMS.SUPER;
    if (!board) return PERMS.POSTER;
    const infoFile = path.join(config.data_dir, board, 'owner.json');
    if (!fs.existsSync(infoFile)) return PERMS.POSTER;
    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    if (info.owner === username) return PERMS.BOARD_OWNER;
    if (info.admins?.includes(username)) return PERMS.BOARD_ADMIN;
    if (section && info.sectionAdmins?.[section]?.includes(username)) return PERMS.SEC_ADMIN;
    return PERMS.POSTER;
}

// 帖子置顶 API
app.post('/api/post/pin', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const { board, section, filename, level, duration } = req.body;
    const user = req.session.user.username;
    const perm = getPermLevel(user, board, section);

    if (level === 'today' && perm < PERMS.SUPER) return res.status(403).json({ error: '权限不足以置顶到首页' });
    if (level === 'board' && perm < PERMS.BOARD_ADMIN) return res.status(403).json({ error: '权限不足以置顶到板块' });
    if (level === 'section' && perm < PERMS.SEC_ADMIN) return res.status(403).json({ error: '权限不足以置顶到分区' });

    const filePath = path.join(config.data_dir, board, section, filename);
    const post = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    post.pinned = { level, expireAt: duration === -1 ? -1 : Date.now() + duration * 3600000 };

    if (!post.history) post.history = [];
    post.history.push({
        type: 'pin',
        user: req.session.user.username,
        time: Date.now(),
        level: level
    });

    fs.writeFileSync(filePath, JSON.stringify(post));
    res.json({ success: true });
});

// 排行榜 API (支持类型与时间筛选)
app.get('/api/leaderboard', (req, res) => {
    const { type, range, start, end } = req.query; // type: post, board, section, user; range: 7, 14, 30, 90, 365, all, custom
    let startTime = 0;
    const now = Date.now();

    if (range === 'custom') {
        startTime = parseInt(start) || 0;
    } else if (range !== 'all' && range) {
        startTime = now - parseInt(range) * 24 * 60 * 60 * 1000;
    }

    const endTime = (range === 'custom' && end) ? parseInt(end) : now;

    const stats = {
        users: {},
        boards: {},
        sections: {},
        posts: []
    };

    const boardDirs = fs.readdirSync(config.data_dir);
    boardDirs.forEach(board => {
        const bp = path.join(config.data_dir, board);
        if (!fs.statSync(bp).isDirectory() || board === '..') return;

        if (!stats.boards[board]) stats.boards[board] = { name: board, posts: 0, likes: 0 };

        fs.readdirSync(bp).forEach(section => {
            const sp = path.join(bp, section);
            if (!fs.statSync(sp).isDirectory()) return;

            const secKey = `${board}/${section}`;
            if (!stats.sections[secKey]) stats.sections[secKey] = { name: section, board, posts: 0, likes: 0 };

            fs.readdirSync(sp).forEach(f => {
                if (!f.endsWith('.json') || f === 'owner.json') return;
                try {
                    const p = JSON.parse(fs.readFileSync(path.join(sp, f)));
                    if (p.time >= startTime && p.time <= endTime) {
                        const likesCount = (p.likes?.length || 0);

                        // 用户统计
                        if (!stats.users[p.author]) stats.users[p.author] = { username: p.author, posts: 0, likes: 0 };
                        stats.users[p.author].posts++;
                        stats.users[p.author].likes += likesCount;

                        // 板块统计
                        stats.boards[board].posts++;
                        stats.boards[board].likes += likesCount;

                        // 分区统计
                        stats.sections[secKey].posts++;
                        stats.sections[secKey].likes += likesCount;

                        // 帖子统计
                        stats.posts.push({
                            title: p.title,
                            author: p.author,
                            board,
                            section,
                            filename: f,
                            likes: likesCount,
                            time: p.time
                        });
                    }
                } catch (e) { }
            });
        });
    });

    let result = [];
    if (type === 'user') {
        result = Object.values(stats.users).sort((a, b) => (b.likes * 2 + b.posts) - (a.likes * 2 + a.posts));
    } else if (type === 'board') {
        result = Object.values(stats.boards).sort((a, b) => (b.likes * 2 + b.posts) - (a.likes * 2 + a.posts));
    } else if (type === 'section') {
        result = Object.values(stats.sections).sort((a, b) => (b.likes * 2 + b.posts) - (a.likes * 2 + a.posts));
    } else { // post
        result = stats.posts.sort((a, b) => b.likes - a.likes);
    }

    res.json(result.slice(0, 50));
});

// 全站管理：调整板块顺序
app.post('/api/admin/reorder-boards', (req, res) => {
    if (!req.session.user || !config.super_admins?.includes(req.session.user.username)) {
        return res.status(403).json({ error: '权限不足' });
    }
    const { newOrder } = req.body;
    if (!Array.isArray(newOrder)) return res.status(400).json({ error: '无效数据' });

    // 我们将顺序存储在一个独立的文件中，或者直接更新 config.json (这里选择独立文件更安全)
    const orderFile = path.join(config.data_dir, 'boards_order.json');
    fs.writeFileSync(orderFile, JSON.stringify(newOrder));
    res.json({ success: true });
});

// 保存用户设置
app.post('/api/user/settings', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: '请先登录' });
    const userFile = path.join(userDir, `${req.session.user.username}.json`);
    let data = fs.existsSync(userFile) ? JSON.parse(fs.readFileSync(userFile)) : {};
    data.settings = req.body;
    fs.writeFileSync(userFile, JSON.stringify(data));
    res.json({ success: true });
});

app.get('/api/system/stats', (req, res) => {
    let totalPosts = 0;
    let totalBoards = 0;
    let totalSections = 0;

    const boards = fs.readdirSync(config.data_dir);
    totalBoards = boards.filter(b => fs.statSync(path.join(config.data_dir, b)).isDirectory()).length;

    boards.forEach(board => {
        const boardPath = path.join(config.data_dir, board);
        if (!fs.statSync(boardPath).isDirectory()) return;
        const sections = fs.readdirSync(boardPath).filter(s => fs.statSync(path.join(boardPath, s)).isDirectory());
        totalSections += sections.length;

        sections.forEach(section => {
            const files = fs.readdirSync(path.join(boardPath, section));
            totalPosts += files.filter(f => f.endsWith('.json') && f !== 'owner.json').length;
        });
    });

    res.json({
        version: "1.0.0",
        powered_by: "Bloret BBS",
        stats: {
            boards: totalBoards,
            sections: totalSections,
            posts: totalPosts
        },
        server_time: Date.now()
    });
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

// --- AI 每日总结功能 ---

// 获取每日数据
function gatherDailyData() {
    let allPosts = [];
    let users = {};
    const boards = fs.readdirSync(config.data_dir);

    // 遍历所有帖子
    boards.forEach(board => {
        const boardPath = path.join(config.data_dir, board);
        if (!fs.statSync(boardPath).isDirectory()) return;
        fs.readdirSync(boardPath).forEach(section => {
            const sectionPath = path.join(boardPath, section);
            if (!fs.statSync(sectionPath).isDirectory()) return;
            fs.readdirSync(sectionPath).forEach(file => {
                if (!file.endsWith('.json') || file === 'owner.json') return;
                try {
                    const content = JSON.parse(fs.readFileSync(path.join(sectionPath, file), 'utf8'));
                    content.board = board;
                    content.section = section;
                    allPosts.push(content);

                    // 统计用户数据
                    if (!users[content.author]) users[content.author] = { posts: 0, likes: 0 };
                    users[content.author].posts++;
                    users[content.author].likes += (content.likes?.length || 0);
                } catch (e) { }
            });
        });
    });

    const todayStart = new Date().setHours(0, 0, 0, 0);
    const todayPosts = allPosts.filter(p => p.time >= todayStart);

    // 1. 全站置顶 (level 'today')
    const pinned = allPosts.filter(p => p.pinned && p.pinned.level === 'today' && (p.pinned.expireAt === -1 || p.pinned.expireAt > Date.now()));

    // 2. 热门推荐 (按时间倒序取最近24小时，按点赞排序)
    // 为简化，取全局最热前5
    const hot = [...allPosts].sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0)).slice(0, 5);

    // 3. 最新发布 (按时间倒序取前5)
    const latest = [...allPosts].sort((a, b) => b.time - a.time).slice(0, 5);

    // 4. 排行榜
    const leaderboard = Object.entries(users)
        .map(([name, s]) => ({ username: name, ...s }))
        .sort((a, b) => (b.likes * 2 + b.posts) - (a.likes * 2 + a.posts))
        .slice(0, 5);

    return {
        date: new Date().toLocaleDateString(),
        pinned: pinned.map(p => p.title),
        hot: hot.map(p => `${p.title} (❤️${p.likes?.length || 0})`),
        latest: latest.map(p => `${p.title} (by ${p.author})`),
        leaderboard: leaderboard.map(u => `${u.username} (🔥${u.likes * 2 + u.posts})`)
    };
}

// 生成每日总结
async function generateDailySummary() {
    console.log("Starting daily summary generation...");
    const data = gatherDailyData();
    const prompt = `
    你是 Bloriko，Bloret BBS 的 AI 助手。请根据以下今日论坛数据，生成一份"今日总结"。
    
    数据如下：
    - 全站置顶：${data.pinned.join(', ') || '无'}
    - 热门推荐：${data.hot.join(', ') || '暂无'}
    - 最新发布：${data.latest.join(', ') || '暂无'}
    - 活跃榜单：${data.leaderboard.join(', ') || '暂无'}
    
    不要使用 Markdown 标题，直接给出文本内容。
    `;

    try {
        // 使用独立配置的 ai_host (默认为 http://localhost:20000) 避免混用 passport_host 导致协议/端口错误
        const aiHost = config.ai_host || "http://localhost:20000";

        const response = await axios.post(`${aiHost}/api/ai`, {
            pause: false,
            model: "Bloriko",
            OauthApp: {
                app_id: config.app_id,
                app_secret: config.app_secret
            },
            user: {
                name: config.ai_user_name || "System_Bot",
                token: config.ai_user_token || ""
            },
            context: [
                { role: "user", content: prompt }
            ]
        });

        if (response.data.status) {
            const summaryData = {
                date: new Date().toDateString(),
                content: response.data.content,
                generatedAt: Date.now()
            };
            fs.writeFileSync(path.join(config.data_dir, 'daily_summary.json'), JSON.stringify(summaryData));
            console.log("Daily summary generated successfully.");
        } else {
            console.error("AI Generation Failed:", response.data.error);
        }
    } catch (e) {
        console.error("Summary Generation Error:", e.message);
        if (e.response) console.error("API Response:", e.response.data);
    }
}

// API: 获取每日总结
app.get('/api/summary', (req, res) => {
    const summaryPath = path.join(config.data_dir, 'daily_summary.json');
    if (fs.existsSync(summaryPath)) {
        res.json(JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
    } else {
        res.json(null);
    }
});

// 测试 API: 手动触发生成 (仅限超管 或 token为空时调试用)
// app.get('/api/summary/generate', (req, res) => {
//     if (!config.ai_user_token) return res.status(500).json({ error: "Missing AI Token in config" });
//     // 异步执行
//     generateDailySummary();
//     res.json({ success: true, message: "Started generation task" });
// });

// 每日定时任务 (简单的 setInterval 实现)
setInterval(() => {
    const now = new Date();
    // 每天 08:00 运行
    if (now.getHours() === 8 && now.getMinutes() === 0) {
        const summaryPath = path.join(config.data_dir, 'daily_summary.json');
        let shouldRun = true;

        // 检查今天是否已经运行过
        if (fs.existsSync(summaryPath)) {
            const last = JSON.parse(fs.readFileSync(summaryPath));
            if (last.date === now.toDateString()) shouldRun = false;
        }

        if (shouldRun) {
            generateDailySummary();
        }
    }
}, 60000); // Check every minute

app.listen(config.port, () => {
    console.log(`Bloret BBS running at http://localhost:${config.port}`);
    console.log("Terminal Commands Enabled: Type 'Bloriko Daily' to manually generate summary.");
});

// 处理控制台命令
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
    const command = data.trim();
    if (command === 'Bloriko Daily') {
        console.log("Manual trigger: Generating daily summary...");
        generateDailySummary();
    } else if (command === 'help' || command === '?') {
        console.log("\n--- Available Commands ---");
        console.log("Bloriko Daily  - Manually trigger AI daily summary generation");
        console.log("help / ?       - Show this help message");
        console.log("---------------------------\n");
    }
});