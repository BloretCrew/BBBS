let currentUser = null;
let boardStructure = {};
let currentView = 'today';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await checkLogin();
    await loadStructure();
    loadPage('today');
});

// 检查登录状态
async function checkLogin() {
    const res = await fetch('/api/user');
    currentUser = await res.json();
    renderUserZone();
}

function renderUserZone() {
    const zone = document.getElementById('user-zone');
    if (currentUser) {
        zone.innerHTML = `
            <img src="https://ui-avatars.com/api/?name=${currentUser.username}&background=random" alt="Avatar">
            <div class="user-info-text">
                <div>${currentUser.username}</div>
                <div>${currentUser.email || '已登录'}</div>
            </div>
            <div style="margin-left: auto; color: red; font-size: 12px;" onclick="location.href='/logout'">退出</div>
        `;
    } else {
        zone.innerHTML = `<div class="nav-item" onclick="location.href='/login'" style="width:100%; justify-content:center;">🔑 登录 PassPort</div>`;
    }
}

// 加载板块结构
async function loadStructure() {
    const res = await fetch('/api/structure');
    boardStructure = await res.json();
    renderSidebarBoards();
}

function renderSidebarBoards() {
    const container = document.getElementById('board-list');
    container.innerHTML = '';
    
    for (const [board, sections] of Object.entries(boardStructure)) {
        // 板块标题
        const boardEl = document.createElement('div');
        boardEl.className = 'nav-item';
        boardEl.innerHTML = `<span class="nav-icon">📁</span> ${board}`;
        boardEl.onclick = () => toggleSections(board);
        container.appendChild(boardEl);

        // 分区 (默认隐藏或缩进)
        const sectionContainer = document.createElement('div');
        sectionContainer.id = `group-${board}`;
        sectionContainer.style.display = 'none';
        sectionContainer.style.paddingLeft = '20px';
        
        sections.forEach(section => {
            const secEl = document.createElement('div');
            secEl.className = 'nav-item';
            secEl.style.fontSize = '13px';
            secEl.innerText = section;
            secEl.onclick = () => loadPosts(board, section);
            sectionContainer.appendChild(secEl);
        });
        container.appendChild(sectionContainer);
    }
}

function toggleSections(board) {
    const el = document.getElementById(`group-${board}`);
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// 页面渲染逻辑
async function loadPage(pageType) {
    const container = document.getElementById('main-container');
    container.innerHTML = '';
    currentView = pageType;

    // 清除侧边栏高亮
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (pageType === 'today') {
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        
        container.innerHTML = `
            <div class="hero-section">
                <span class="section-date">${today}</span>
                <div class="section-header" style="padding:0; margin-bottom: 20px;">
                    <div class="section-title">Today</div>
                </div>
            </div>
            <div class="card-grid" id="featured-grid">
                <!-- 占位符 -->
                <div class="fluent-card" style="background: linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%);">
                    <div class="card-overlay">
                        <div class="card-category">欢迎</div>
                        <div class="card-title">Bloret BBS 全新上线</div>
                        <div class="card-desc">探索 Microsoft Fluent Design 设计风格的现代论坛体验。</div>
                    </div>
                </div>
                 <div class="fluent-card" style="background-image: url('https://picsum.photos/800/600');">
                    <div class="card-overlay">
                        <div class="card-category">推荐</div>
                        <div class="card-title">摄影精选</div>
                        <div class="card-desc">查看本周最热门的摄影作品。</div>
                    </div>
                </div>
            </div>
        `;
    }
}

async function loadPosts(board, section) {
    const container = document.getElementById('main-container');
    container.innerHTML = `<div style="padding:40px;"><h2>${section} <span style="font-size:14px; color:#888;">${board}</span></h2><div class="list-view" id="post-list">加载中...</div></div>`;
    
    const res = await fetch(`/api/posts?board=${encodeURIComponent(board)}&section=${encodeURIComponent(section)}`);
    const posts = await res.json();
    
    const list = document.getElementById('post-list');
    list.innerHTML = '';

    if(posts.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:#888;">暂无帖子</div>';
        return;
    }

    posts.forEach(post => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.onclick = () => showPostDetail(post);
        item.innerHTML = `
            <div class="list-icon">📝</div>
            <div class="list-details">
                <div class="list-title">${post.title}</div>
                <div class="list-subtitle">${post.author} • ${new Date(post.time).toLocaleDateString()}</div>
            </div>
            <button class="btn-get">查看</button>
        `;
        list.appendChild(item);
    });
}

function showPostDetail(post) {
    const container = document.getElementById('main-container');
    // 简单的 Markdown 渲染
    const htmlContent = marked.parse(post.content);
    
    container.innerHTML = `
        <div class="post-detail-container">
            <div class="back-btn" onclick="loadPosts('x', 'x')">← 返回列表</div> <!-- 简化逻辑，实际应记录上一级 -->
            <div class="post-detail-title">${post.title}</div>
            <div class="post-meta">
                <span>👤 ${post.author}</span>
                <span style="margin: 0 10px;">•</span>
                <span>🕒 ${new Date(post.time).toLocaleString()}</span>
            </div>
            <div class="post-body">
                ${htmlContent}
            </div>
        </div>
    `;
}

// --- 发帖逻辑 ---

let currentActiveBoard = null;

function toggleNewMenu() {
    const menu = document.getElementById('new-menu');
    menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

async function showModal(id) {
    if(!currentUser) return location.href = '/login';
    document.getElementById('new-menu').style.display = 'none';
    document.getElementById(id).classList.add('active');
    if(id === 'section-modal') {
        document.getElementById('current-board-name').innerText = currentActiveBoard;
    }
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function showPostModal() {
    if(!currentUser) return location.href = '/login';
    document.getElementById('new-menu').style.display = 'none';
    document.getElementById('post-modal').classList.add('active');
    const boardSelect = document.getElementById('post-board-select');
    boardSelect.innerHTML = '<option value="">选择板块</option>';
    for(const board in boardStructure) {
        boardSelect.innerHTML += `<option value="${board}">${board}</option>`;
    }
    if(currentActiveBoard) boardSelect.value = currentActiveBoard;
    updateSectionSelect();
}

async function loadPosts(board, section) {
    currentActiveBoard = board;
    const container = document.getElementById('main-container');
    container.innerHTML = `<div style="padding:40px;"><h2>${section} <span style="font-size:14px; color:#888;">${board}</span></h2><div class="list-view" id="post-list">加载中...</div></div>`;
    
    // 检查所有权以显示新建分区按钮
    const infoRes = await fetch(`/api/board/info?board=${encodeURIComponent(board)}`);
    const info = await infoRes.json();
    document.getElementById('menu-new-section').style.display = (currentUser && info.owner === currentUser.username) ? 'block' : 'none';

    const res = await fetch(`/api/posts?board=${encodeURIComponent(board)}&section=${encodeURIComponent(section)}`);
    const posts = await res.json();
    const list = document.getElementById('post-list');
    list.innerHTML = '';
    if(posts.length === 0) { list.innerHTML = '<div style="text-align:center; color:#888;">暂无帖子</div>'; return; }
    posts.forEach(post => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.onclick = () => showPostDetail(post);
        item.innerHTML = `<div class="list-icon">📝</div><div class="list-details"><div class="list-title">${post.title}</div><div class="list-subtitle">${post.author} • ${new Date(post.time).toLocaleDateString()}</div></div><button class="btn-get">查看</button>`;
        list.appendChild(item);
    });
}

async function submitBoard() {
    const name = document.getElementById('board-name').value;
    if(!name) return;
    const res = await fetch('/api/board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    if((await res.json()).success) { location.reload(); } else { alert('创建失败'); }
}

async function submitSection() {
    const name = document.getElementById('section-name').value;
    if(!name || !currentActiveBoard) return;
    const res = await fetch('/api/section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: currentActiveBoard, name })
    });
    if((await res.json()).success) { location.reload(); } else { alert('创建失败，可能您不是该板块创建者'); }
}

function updateSectionSelect() {
    const board = document.getElementById('post-board-select').value;
    const sectionSelect = document.getElementById('post-section-select');
    sectionSelect.innerHTML = '';
    
    if(board && boardStructure[board]) {
        boardStructure[board].forEach(sec => {
            sectionSelect.innerHTML += `<option value="${sec}">${sec}</option>`;
        });
    }
}

async function submitPost() {
    const board = document.getElementById('post-board-select').value;
    const section = document.getElementById('post-section-select').value;
    const title = document.getElementById('post-title').value;
    let content = document.getElementById('post-content').value;
    const fileInput = document.getElementById('post-image');

    if(!board || !section || !title || !content) {
        alert('请填写完整信息');
        return;
    }

    // 处理图片上传
    if(fileInput.files.length > 0) {
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        
        try {
            const upRes = await fetch('/api/upload-proxy', {
                method: 'POST',
                body: formData
            });
            const upData = await upRes.json();
            if(upData.success) {
                // 将图片插入内容末尾
                content += `\n\n![Image](${config.image_host}${upData.data.url})`;
            } else {
                alert('图片上传失败: ' + upData.message);
                return;
            }
        } catch(e) {
            console.error(e);
            alert('图片上传出错');
            return;
        }
    }

    // 提交帖子
    const res = await fetch('/api/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, section, title, content })
    });

    const result = await res.json();
    if(result.success) {
        closePostModal();
        alert('发布成功！');
        loadPosts(board, section);
    } else {
        alert('发布失败: ' + result.error);
    }
}

// 注入配置给前端 (简单处理)
const config = {
    image_host: "http://pcfs.eno.ink:28888" 
};