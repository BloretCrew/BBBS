let currentUser = null;
let boardStructure = {};
let currentView = 'today';
let currentActiveBoard = null;
let userFollows = { boards: [], sections: [] };

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await checkLogin();
    if(currentUser) await loadFollows();
    await loadStructure();
    loadPage('today');
});

// 动画过渡辅助函数
async function transitionTo(renderFn) {
    const container = document.getElementById('main-container');
    container.style.opacity = '0';
    container.style.transform = 'translateY(10px)';
    container.style.transition = 'opacity 0.2s, transform 0.2s';
    
    await new Promise(r => setTimeout(r, 200));
    await renderFn();

    container.style.opacity = '0';
    container.style.transform = 'translateY(10px)';
    
    requestAnimationFrame(() => {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
    });
}

// 加载用户关注列表
async function loadFollows() {
    const res = await fetch('/api/user/follows');
    userFollows = await res.json();
}

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
    
    // 1. 渲染关注的分区/板块
    if (userFollows.boards.length > 0 || userFollows.sections.length > 0) {
        const followTitle = document.createElement('div');
        followTitle.className = 'nav-title';
        followTitle.innerText = '我的关注';
        container.appendChild(followTitle);

        userFollows.boards.forEach(b => {
            const el = document.createElement('div');
            el.className = 'nav-item';
            el.innerHTML = `<span class="nav-icon">⭐</span> ${b}`;
            el.onclick = () => loadBoard(b);
            container.appendChild(el);
        });

        userFollows.sections.forEach(s => {
            const [b, sec] = s.split('/');
            const el = document.createElement('div');
            el.className = 'nav-item';
            el.innerHTML = `<span class="nav-icon">📍</span> ${sec}`;
            el.onclick = () => loadPosts(b, sec);
            container.appendChild(el);
        });
        
        // container.appendChild(document.createElement('hr'));
    }

    // 2. 渲染常规板块列表
    const allTitle = document.createElement('div');
    allTitle.className = 'nav-title';
    allTitle.innerText = '板块与分区';
    container.appendChild(allTitle);

    for (const [board, sections] of Object.entries(boardStructure)) {
        const boardEl = document.createElement('div');
        boardEl.className = 'nav-item';
        boardEl.innerHTML = `<span class="nav-icon">📁</span> ${board}`;
        boardEl.onclick = (e) => {
            loadBoard(board);
            toggleSections(board, true);
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            boardEl.classList.add('active');
        };
        container.appendChild(boardEl);

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

function toggleSections(board, forceOpen = false) {
    const el = document.getElementById(`group-${board}`);
    if (forceOpen) el.style.display = 'block';
    else el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function loadBoard(board) {
    currentActiveBoard = board;
    await transitionTo(async () => {
        const container = document.getElementById('main-container');
        const sections = boardStructure[board] || [];
        const isFollowed = userFollows.boards.includes(board);
        
        // 获取该板块下的热门帖子
        const postsRes = await fetch('/api/all-posts');
        const all = await postsRes.json();
        const boardPosts = all.filter(p => p.board === board).sort((a,b) => (b.likes?.length||0) - (a.likes?.length||0)).slice(0, 3);

        container.innerHTML = `
            <div class="hero-section">
                <span class="section-date">板块目录</span>
                <div class="section-header" style="padding:0; margin-bottom: 30px; align-items: center;">
                    <div class="section-title">${board}</div>
                    <div style="display:flex; gap:10px;">
                        <button class="follow-btn" onclick="showBoardManage('${board}')">⚙️ 管理</button>
                        <button class="follow-btn ${isFollowed ? 'active' : ''}" onclick="toggleFollow('board', '${board}', this)">
                            ${isFollowed ? '已关注' : '+ 关注板块'}
                        </button>
                    </div>
                </div>

                ${boardPosts.length ? `
                    <div class="nav-title" style="margin-bottom: 15px;">🏆 热门帖子</div>
                    <div class="card-grid" style="margin-bottom: 40px;">
                        ${boardPosts.map(p => createPostCardHTML(p)).join('')}
                    </div>
                ` : ''}
                
                <div class="nav-title" style="margin-bottom: 15px;">全部分区</div>
                <div class="card-grid">
                    ${sections.map(sec => `
                        <div class="fluent-card" onclick="loadPosts('${board}', '${sec}')" style="height: 180px; background: white;">
                            <div style="padding: 20px;">
                                <div class="card-category">Section</div>
                                <div class="card-title" style="color: #000; font-size: 24px;">${sec}</div>
                                <div class="card-desc" style="color: #666;">点击进入分区查看帖子</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        const infoRes = await fetch(`/api/board/info?board=${encodeURIComponent(board)}`);
        const info = await infoRes.json();
        document.getElementById('menu-new-section').style.display = (currentUser && info.owner === currentUser.username) ? 'flex' : 'none';
    });
}

// 提取内容中第一张图片
function extractFirstImage(content) {
    const imgRegex = /!\[.*?\]\((.*?)\)/;
    const match = content.match(imgRegex);
    return match ? match[1] : null;
}

// 通用帖子卡片生成
function createPostCardHTML(post, category = "") {
    const img = extractFirstImage(post.content);
    const style = img ? `background-image: url('${img}'); background-size: cover;` : `background: linear-gradient(45deg, #0078d4, #00c6ff);`;
    return `
        <div class="fluent-card" onclick="showPostDetailWrapper('${post.filename}', '${post.board}', '${post.section}')">
            <div class="card-image" style="${style}"></div>
            <div class="card-overlay">
                <div class="card-category">${category || post.section}</div>
                <div class="card-title">${post.title}</div>
                <div class="card-desc">by ${post.author} • ${post.likes?.length || 0} 👍</div>
            </div>
        </div>
    `;
}

// 页面渲染逻辑
async function loadPage(pageType) {
    currentView = pageType;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    await transitionTo(async () => {
        const container = document.getElementById('main-container');
        const res = await fetch('/api/all-posts');
        const allPosts = await res.json();

        if (pageType === 'today') {
            const todayStr = new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' });
            
            // 热门 (赞最多)
            const hotPosts = [...allPosts].sort((a,b) => (b.likes?.length||0) - (a.likes?.length||0)).slice(0, 3);
            // 关注 (如果登录)
            const followedPosts = allPosts.filter(p => userFollows.sections.includes(`${p.board}/${p.section}`) || userFollows.boards.includes(p.board)).slice(0, 3);
            // 最新
            const latestPosts = [...allPosts].sort((a,b) => b.time - a.time).slice(0, 3);

            container.innerHTML = `
                <div class="hero-section">
                    <span class="section-date">${todayStr}</span>
                    <div class="section-title">Today</div>
                    
                    <div class="nav-title" style="margin: 30px 0 15px;">🔥 热门推荐</div>
                    <div class="card-grid">${hotPosts.map(p => createPostCardHTML(p)).join('')}</div>

                    ${followedPosts.length ? `
                        <div class="nav-title" style="margin: 30px 0 15px;">⭐ 我的关注</div>
                        <div class="card-grid">${followedPosts.map(p => createPostCardHTML(p)).join('')}</div>
                    ` : ''}

                    <div class="nav-title" style="margin: 30px 0 15px;">🚀 最新发布</div>
                    <div class="list-view">
                        ${latestPosts.map(p => `
                            <div class="list-item" onclick="showPostDetailWrapper('${p.filename}', '${p.board}', '${p.section}')">
                                <div class="list-icon">✨</div>
                                <div class="list-details"><div class="list-title">${p.title}</div><div class="list-subtitle">${p.board} / ${p.section}</div></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (pageType === 'all-posts') {
            const latest = [...allPosts].sort((a,b) => b.time - a.time);
            container.innerHTML = `
                <div class="hero-section">
                    <div class="section-title">最新发布</div>
                    <div class="card-grid" style="margin-top:20px;">
                        ${latest.map(p => createPostCardHTML(p)).join('')}
                    </div>
                </div>
            `;
        }
    });
}

async function loadPosts(board, section) {
    currentActiveBoard = board;
    
    await transitionTo(async () => {
        const container = document.getElementById('main-container');
        const target = `${board}/${section}`;
        const isFollowed = userFollows.sections.includes(target);

        container.innerHTML = `
            <div style="padding:40px;">
                <div class="back-btn" onclick="loadBoard('${board}')">← 返回 ${board}</div>
                <div class="section-header" style="padding:0; margin-bottom: 20px; align-items: center;">
                    <div class="section-title">${section}</div>
                    <button class="follow-btn ${isFollowed ? 'active' : ''}" onclick="toggleFollow('section', '${target}', this)">
                        ${isFollowed ? '已关注' : '+ 关注分区'}
                    </button>
                </div>
                <div class="card-grid" id="top-posts-grid" style="margin-bottom: 30px; padding: 0;"></div>
                <div class="nav-title" style="margin-bottom: 15px;">所有帖子</div>
                <div class="list-view" id="post-list">加载中...</div>
            </div>
        `;

        const infoRes = await fetch(`/api/board/info?board=${encodeURIComponent(board)}`);
        const info = await infoRes.json();
        document.getElementById('menu-new-section').style.display = (currentUser && info.owner === currentUser.username) ? 'flex' : 'none';

        const res = await fetch(`/api/posts?board=${encodeURIComponent(board)}&section=${encodeURIComponent(section)}`);
        const posts = await res.json();
        const list = document.getElementById('post-list');
        const grid = document.getElementById('top-posts-grid');
        
        list.innerHTML = '';
        if(posts.length === 0) { 
            list.innerHTML = '<div style="text-align:center; color:#888;">暂无帖子</div>'; 
            return; 
        }

        posts.sort((a, b) => (b.likes ? b.likes.length : 0) - (a.likes ? a.likes.length : 0));

        // 提取最热门的一个帖子（如果有）
        if (posts.length > 0 && posts[0].likes && posts[0].likes.length > 0) {
            const topPost = posts[0];
            const img = extractFirstImage(topPost.content);
            const imgStyle = img ? `background-image: url('${img}'); background-size: cover;` : `background: linear-gradient(135deg, var(--primary-color), #005a9e);`;
            
            grid.innerHTML = `
                <div class="fluent-card highlight-post" onclick="showPostDetailWrapper('${topPost.filename}', '${board}', '${section}')">
                    <div class="card-image" style="${imgStyle}"></div>
                    <div class="card-overlay">
                        <div class="card-category">🔥 热门推荐 • ${topPost.likes.length} 人点赞</div>
                        <div class="card-title">${topPost.title}</div>
                        <div class="card-desc">${topPost.author} 发布于 ${new Date(topPost.time).toLocaleDateString()}</div>
                    </div>
                </div>
            `;
        } else {
            grid.style.display = 'none'; // 没有特别热门的就不显示大卡片
        }

        posts.forEach(post => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.onclick = () => showPostDetail(post, board, section);
            item.innerHTML = `
                <div class="list-icon">📝</div>
                <div class="list-details">
                    <div class="list-title">${post.title}</div>
                    <div class="list-subtitle">${post.author} • ${post.likes ? post.likes.length : 0} 👍</div>
                </div>
                <button class="btn-get">查看</button>`;
            list.appendChild(item);
        });
    });
}

async function showPostDetailWrapper(filename, board, section) {
    const res = await fetch(`/api/posts?board=${encodeURIComponent(board)}&section=${encodeURIComponent(section)}`);
    const posts = await res.json();
    const post = posts.find(p => p.filename === filename);
    if(post) showPostDetail(post, board, section);
}

function showPostDetail(post, board, section) {
    transitionTo(async () => {
        const container = document.getElementById('main-container');
        const htmlContent = marked.parse(post.content);
        
        const isLiked = currentUser && post.likes && post.likes.includes(currentUser.username);
        const likeCount = post.likes ? post.likes.length : 0;

        container.innerHTML = `
            <div class="post-detail-container">
                <div class="back-btn" onclick="loadPosts('${board}', '${section}')">← 返回分区</div>
                <div class="post-detail-title">${post.title}</div>
                <div class="post-meta">
                    <span>👤 ${post.author}</span>
                    <span style="margin: 0 10px;">•</span>
                    <span>🕒 ${new Date(post.time).toLocaleString()}</span>
                </div>
                <div class="post-body">${htmlContent}</div>
                <div class="action-bar">
                    <button class="action-btn ${isLiked ? 'active' : ''}" onclick="toggleLike('${board}', '${section}', '${post.filename}', this)">
                        <span>${isLiked ? '❤️' : '🤍'}</span> 
                        <span class="like-count">${likeCount}</span>
                    </button>
                    <button class="action-btn share" onclick="sharePost(this)">
                        <span>🔗</span> 分享
                    </button>
                </div>
            </div>
        `;
    });
}

async function toggleLike(board, section, filename, btn) {
    if(!currentUser) return alert('请先登录');
    const res = await fetch('/api/post/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, section, filename })
    });
    const data = await res.json();
    if(data.success) {
        const countSpan = btn.querySelector('.like-count');
        const iconSpan = btn.querySelector('span:first-child');
        countSpan.innerText = data.count;
        if(data.liked) {
            btn.classList.add('active');
            iconSpan.innerText = '❤️';
        } else {
            btn.classList.remove('active');
            iconSpan.innerText = '🤍';
        }
    } else { alert(data.error); }
}

async function sharePost(btn) {
    const shareData = {
        title: document.title,
        text: '来看看百络谷上的这篇帖子！',
        url: window.location.href
    };

    try {
        if (navigator.share) {
            await navigator.share(shareData);
        } else {
            // 回退到剪贴板
            await navigator.clipboard.writeText(window.location.href);
            const original = btn.innerHTML;
            btn.innerHTML = '<span>✅</span> 链接已复制';
            setTimeout(() => btn.innerHTML = original, 2000);
        }
    } catch (err) {
        console.log('Share failed', err);
    }
}

// 管理功能 (演示)
async function showBoardManage(board) {
    const adminName = prompt("请输入要添加的管理员用户名:");
    if(!adminName) return;
    const res = await fetch('/api/board/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, adminName, action: 'add' })
    });
    const data = await res.json();
    if(data.success) alert("设置成功！");
    else alert(data.error);
}

async function toggleFollow(type, target, btn) {
    if(!currentUser) return alert('请先登录');
    const res = await fetch('/api/user/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, target })
    });
    const data = await res.json();
    if(data.success) {
        if(data.isFollowing) {
            btn.classList.add('active');
            btn.innerText = '已关注';
            if(type === 'board') userFollows.boards.push(target);
            else userFollows.sections.push(target);
        } else {
            btn.classList.remove('active');
            btn.innerText = type === 'board' ? '+ 关注板块' : '+ 关注分区';
            const list = type === 'board' ? userFollows.boards : userFollows.sections;
            const idx = list.indexOf(target);
            if(idx > -1) list.splice(idx, 1);
        }
    } else { alert(data.error); }
}

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

async function handleAutoUpload(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('image', file);
    const upRes = await fetch('/api/upload-proxy', { method: 'POST', body: formData });
    const upData = await upRes.json();
    if (upData.success) {
        const textarea = document.getElementById('post-content');
        textarea.value += `\n![${file.name}](${config.image_host}${upData.data.url})\n`;
        input.value = '';
    } else { alert('上传失败: ' + upData.message); }
}

async function submitPost() {
    const board = document.getElementById('post-board-select').value;
    const section = document.getElementById('post-section-select').value;
    const title = document.getElementById('post-title').value;
    const content = document.getElementById('post-content').value;
    if (!board || !section || !title || !content) { alert('请填写完整信息'); return; }
    const res = await fetch('/api/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, section, title, content })
    });
    const result = await res.json();
    if (result.success) {
        closeModal('post-modal');
        document.getElementById('post-title').value = '';
        document.getElementById('post-content').value = '';
        alert('发布成功！');
        loadPosts(board, section);
    } else { alert('发布失败: ' + result.error); }
}

const config = { image_host: "http://pcfs.eno.ink:28888" };