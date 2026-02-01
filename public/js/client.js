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

    // 点击页面其他地方关闭搜索下拉框
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            document.getElementById('search-suggest-box').style.display = 'none';
        }
    });
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
            <div style="margin-left: auto; color: red; font-size: 12px; cursor:pointer;" onclick="location.href='/logout'">退出</div>
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
    }

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
    if(!el) return;
    if (forceOpen) el.style.display = 'block';
    else el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function extractFirstImage(content) {
    const imgRegex = /!\[.*?\]\((.*?)\)/;
    const match = content.match(imgRegex);
    return match ? match[1] : null;
}

function createPostCardHTML(post, category = "") {
    const img = extractFirstImage(post.content);
    const style = img ? `background-image: url('${img}'); background-size: cover;` : `background: linear-gradient(45deg, #0078d4, #00c6ff);`;
    return `
        <div class="fluent-card" onclick="showPostDetailWrapper('${post.filename}', '${post.board}', '${post.section}')">
            <div class="card-image" style="${style}"></div>
            <div class="card-overlay">
                <div class="card-category">${category || post.section}</div>
                <div class="card-title">${post.title}</div>
                <div class="card-desc">${post.author} • ${post.likes?.length || 0} ❤️</div>
            </div>
        </div>
    `;
}

async function loadPage(pageType) {
    currentView = pageType;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    await transitionTo(async () => {
        const container = document.getElementById('main-container');
        const res = await fetch('/api/all-posts');
        const allPosts = await res.json();

        if (pageType === 'today') {
            const todayStr = new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' });
            const hotPosts = [...allPosts].sort((a,b) => (b.likes?.length||0) - (a.likes?.length||0)).slice(0, 3);
            const followedPosts = allPosts.filter(p => userFollows.sections.includes(`${p.board}/${p.section}`) || userFollows.boards.includes(p.board)).slice(0, 3);
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

async function loadBoard(board) {
    currentActiveBoard = board;
    await transitionTo(async () => {
        const container = document.getElementById('main-container');
        const sections = boardStructure[board] || [];
        const isFollowed = userFollows.boards.includes(board);
        
        const postsRes = await fetch('/api/all-posts');
        const all = await postsRes.json();
        const boardPosts = all.filter(p => p.board === board).sort((a,b) => (b.likes?.length||0) - (a.likes?.length||0)).slice(0, 3);

        container.innerHTML = `
            <div class="hero-section">
                <span class="section-date">板块目录</span>
                <div class="section-header" style="padding:0; margin-bottom: 30px; align-items: center;">
                    <div class="section-title">${board}</div>
                    <div style="display:flex; gap:10px;">
                        <button class="follow-btn" onclick="showManagement('${board}')">⚙️ 管理</button>
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
    });
}

async function loadPosts(board, section) {
    currentActiveBoard = board;
    await transitionTo(async () => {
        const container = document.getElementById('main-container');
        const target = `${board}/${section}`;
        const isFollowed = userFollows.sections.includes(target);

        const infoRes = await fetch(`/api/board/manage-info?board=${encodeURIComponent(board)}`);
        const info = await infoRes.json();
        const canManage = currentUser && (info.owner === currentUser.username || info.sectionAdmins?.[section]?.includes(currentUser.username));

        container.innerHTML = `
            <div style="padding:40px;">
                <div class="back-btn" onclick="loadBoard('${board}')">← 返回 ${board}</div>
                <div class="section-header" style="padding:0; margin-bottom: 20px; align-items: center;">
                    <div class="section-title">${section}</div>
                    <div style="display:flex; gap:10px;">
                        ${canManage ? `<button class="follow-btn" onclick="showManagement('${board}', '${section}')">⚙️ 管理</button>` : ''}
                        <button class="follow-btn ${isFollowed ? 'active' : ''}" onclick="toggleFollow('section', '${target}', this)">
                            ${isFollowed ? '已关注' : '+ 关注分区'}
                        </button>
                    </div>
                </div>
                <div class="card-grid" id="top-posts-grid" style="margin-bottom: 30px; padding: 0;"></div>
                <div class="nav-title" style="margin-bottom: 15px;">所有帖子</div>
                <div class="list-view" id="post-list">加载中...</div>
            </div>
        `;

        const res = await fetch(`/api/posts?board=${encodeURIComponent(board)}&section=${encodeURIComponent(section)}`);
        const posts = await res.json();
        const list = document.getElementById('post-list');
        const grid = document.getElementById('top-posts-grid');
        
        list.innerHTML = '';
        if(posts.length === 0) { 
            list.innerHTML = '<div style="text-align:center; color:#888;">暂无帖子</div>'; 
            return; 
        }

        posts.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));

        if (posts.length > 0 && posts[0].likes?.length > 0) {
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
            grid.style.display = 'none';
        }

        posts.forEach(post => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.onclick = () => showPostDetail(post, board, section);
            item.innerHTML = `
                <div class="list-icon">📝</div>
                <div class="list-details">
                    <div class="list-title">${post.title}</div>
                    <div class="list-subtitle">${post.author} • ${post.likes?.length || 0} 👍</div>
                </div>
                <div style="display:flex; gap:5px;">
                    ${canManage ? `<button class="btn-get" style="color:red;" onclick="event.stopPropagation(); if(confirm('确定删除?')) updateManage('${board}', '${section}', 'deletePost', {filename: '${post.filename}'})">🗑️</button>` : ''}
                    <button class="btn-get">查看</button>
                </div>`;
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
        const isLiked = currentUser && post.likes?.includes(currentUser.username);
        const likeCount = post.likes?.length || 0;

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

async function showManagement(board, section = null) {
    const res = await fetch(`/api/board/manage-info?board=${encodeURIComponent(board)}`);
    const info = await res.json();
    
    const modal = document.getElementById('manage-modal');
    const body = document.getElementById('manage-body');
    
    document.getElementById('manage-title').innerText = section ? `分区管理: ${section}` : `板块管理: ${board}`;
    modal.classList.add('active');

    const currentBlacklist = section ? (info.sectionSettings?.[section]?.blacklist || []) : (info.blacklist || []);
    const isMuted = section ? (info.sectionSettings?.[section]?.muted) : info.muted;

    let html = `
        <div class="form-group">
            <label>状态控制</label>
            <button class="btn-get" onclick="updateManage('${board}', ${section ? `'${section}'` : 'null'}, 'setMuted', {muted: ${!isMuted}})">
                ${isMuted ? '🔴 已禁言 (点击解除)' : '🟢 运行中 (点击禁言)'}
            </button>
        </div>
        <div class="form-group">
            <label>黑名单管理</label>
            <div style="display:flex; gap:10px; margin-bottom:10px;">
                <input type="text" id="bl-user" class="form-control" placeholder="输入用户名">
                <button class="btn-get" onclick="const u=document.getElementById('bl-user').value; if(u) updateManage('${board}', ${section ? `'${section}'` : 'null'}, 'updateBlacklist', {type:'add', user: u})">添加</button>
            </div>
            <div class="list-view">
                ${currentBlacklist.map(u => `<div class="list-item" style="padding:5px 15px;">${u} <button class="btn-get" style="color:red; margin-left:auto;" onclick="updateManage('${board}', ${section ? `'${section}'` : 'null'}, 'updateBlacklist', {type:'remove', user:'${u}'})">移除</button></div>`).join('')}
            </div>
        </div>
    `;

    if (!section && currentUser && info.owner === currentUser.username) {
        const sections = boardStructure[board] || [];
        html += `
            <div class="form-group">
                <label>分区高级管理 (排序、图片、管理员)</label>
                <div class="list-view">
                    ${sections.map((sec, index) => {
                        const admins = info.sectionAdmins?.[sec] || [];
                        return `
                        <div class="list-item" style="flex-direction:column; align-items:flex-start; gap:10px; padding: 15px;">
                            <div style="width: 100%; display: flex; justify-content: space-between; align-items: center;">
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <div style="display:flex; flex-direction:column; gap:2px;">
                                        <button class="btn-get" style="padding:2px 5px; font-size:10px;" onclick="moveSection('${board}', ${index}, -1)" ${index === 0 ? 'disabled' : ''}>▲</button>
                                        <button class="btn-get" style="padding:2px 5px; font-size:10px;" onclick="moveSection('${board}', ${index}, 1)" ${index === sections.length - 1 ? 'disabled' : ''}>▼</button>
                                    </div>
                                    <b>${sec}</b>
                                </div>
                                <button class="btn-get" style="font-size: 12px;" onclick="const u=prompt('输入要添加的管理员用户名:'); if(u) updateManage('${board}', '${sec}', 'manageSecAdmin', {type:'add', user: u})">➕ 添加管理员</button>
                            </div>
                            
                            <div style="display:flex; gap:10px; width:100%;">
                                <input type="text" class="form-control" placeholder="封面图链接" value="${info.sectionSettings?.[sec]?.image || ''}" onchange="updateManage('${board}', '${sec}', 'sectionConfig', {image: this.value})">
                            </div>

                            <div style="width:100%; display:flex; flex-wrap:wrap; gap:5px;">
                                <span style="font-size:12px; color:#666; width:100%;">现有管理员:</span>
                                ${admins.length > 0 ? admins.map(admin => `
                                    <span class="nav-item" style="padding: 2px 8px; font-size: 12px; background: rgba(0,0,0,0.05); display: flex; align-items: center; gap: 5px;">
                                        ${admin}
                                        <span style="color:red; cursor:pointer; font-weight:bold;" onclick="if(confirm('移除管理员 ${admin} ?')) updateManage('${board}', '${sec}', 'manageSecAdmin', {type:'remove', user: '${admin}'})">×</span>
                                    </span>
                                `).join('') : '<span style="font-size:12px; color:#999;">暂无</span>'}
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
            <div class="form-group" style="border-top: 1px solid #eee; padding-top: 15px; margin-top: 15px;">
                <label>🆕 新建分区</label>
                <div style="display:flex; gap:10px;">
                    <input type="text" id="new-section-name-manage" class="form-control" placeholder="输入新分区名称">
                    <button class="btn-get" onclick="const n=document.getElementById('new-section-name-manage').value; if(n) createSectionInManage('${board}', n)">创建</button>
                </div>
            </div>
        `;
    }
    body.innerHTML = html;
}

async function createSectionInManage(board, name) {
    const res = await fetch('/api/section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, name })
    });
    const result = await res.json();
    if(result.success) {
        // alert("创建成功");
        await loadStructure(); // 刷新侧边栏结构
        showManagement(board); // 刷新管理界面
    } else {
        alert(result.error || "创建失败");
    }
}

async function moveSection(board, index, direction) {
    const sections = [...boardStructure[board]];
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sections.length) return;

    // 交换位置
    [sections[index], sections[newIndex]] = [sections[newIndex], sections[index]];

    const res = await fetch('/api/manage/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            board, 
            section: null, 
            action: 'reorderSections', 
            data: { newOrder: sections } 
        })
    });
    
    if ((await res.json()).success) {
        await loadStructure(); // 更新内存中的 boardStructure
        showManagement(board); // 重新渲染管理界面
    }
}

async function updateManage(board, section, action, data) {
    const res = await fetch('/api/manage/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, section, action, data })
    });
    const result = await res.json();
    if(result.success) {
        // alert("操作成功");
        if(action === 'deletePost') loadPosts(board, section);
        else showManagement(board, section);
    } else {
        alert(result.error);
    }
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
        if(data.liked) { btn.classList.add('active'); iconSpan.innerText = '❤️'; }
        else { btn.classList.remove('active'); iconSpan.innerText = '🤍'; }
    } else { alert(data.error); }
}

async function sharePost(btn) {
    const shareData = { title: document.title, text: '来看看百络谷上的这篇帖子！', url: window.location.href };
    try {
        if (navigator.share) await navigator.share(shareData);
        else {
            await navigator.clipboard.writeText(window.location.href);
            const original = btn.innerHTML;
            btn.innerHTML = '<span>✅</span> 链接已复制';
            setTimeout(() => btn.innerHTML = original, 2000);
        }
    } catch (err) { console.log('Share failed', err); }
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
    if((await res.json()).success) { location.reload(); } else { alert('创建失败'); }
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
        // alert('发布成功！');
        loadPosts(board, section);
    } else { alert('发布失败: ' + result.error); }
}

// 处理搜索建议
async function handleSearchSuggest(q) {
    const box = document.getElementById('search-suggest-box');
    if (!q.trim()) {
        box.style.display = 'none';
        return;
    }

    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    
    // 合并结果展示在气泡中（取前8条）
    let combined = [
        ...data.users.slice(0, 2).map(u => ({ type: '👤', name: u.username, action: `alert('用户资料开发中')` })),
        ...data.boards.slice(0, 2).map(b => ({ type: '📁', name: b.name, action: `loadBoard('${b.name}')` })),
        ...data.sections.slice(0, 2).map(s => ({ type: '📍', name: s.name, action: `loadPosts('${s.board}', '${s.name}')` })),
        ...data.posts.slice(0, 4).map(p => ({ type: '📝', name: p.title, action: `showPostDetailWrapper('${p.filename}', '${p.board}', '${p.section}')` }))
    ];

    if (combined.length === 0) {
        box.innerHTML = '<div class="bubble-item" style="color:#999; font-size:13px;">未找到相关内容</div>';
    } else {
        box.innerHTML = combined.map(item => `
            <div class="bubble-item" onclick="${item.action}; document.getElementById('search-suggest-box').style.display='none';">
                <span class="bubble-icon" style="font-size:14px; width:20px;">${item.type}</span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</span>
            </div>
        `).join('') + `<div class="bubble-item" style="border-top:1px solid #eee; font-size:12px; color:var(--primary-color); justify-content:center;" onclick="executeFullSearch('${q}')">查看全部结果 (Enter)</div>`;
    }
    box.style.display = 'flex';
}

// 执行完整搜索页渲染
async function executeFullSearch(q) {
    if (!q.trim()) return;
    document.getElementById('search-suggest-box').style.display = 'none';
    
    await transitionTo(async () => {
        const container = document.getElementById('main-container');
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();

        container.innerHTML = `
            <div class="hero-section">
                <span class="section-date">搜索结果</span>
                <div class="section-title">"${q}"</div>
                
                ${data.users.length ? `
                    <div class="nav-title" style="margin-top:30px;">用户</div>
                    <div class="list-view">${data.users.map(u => `<div class="list-item"><div class="list-icon">👤</div><div class="list-details"><b>${u.username}</b></div><button class="btn-get">主页</button></div>`).join('')}</div>
                ` : ''}

                ${data.boards.length || data.sections.length ? `
                    <div class="nav-title" style="margin-top:30px;">板块与分区</div>
                    <div class="card-grid">
                        ${data.boards.map(b => `
                            <div class="fluent-card" style="height:120px; background:#fff;" onclick="loadBoard('${b.name}')">
                                <div style="padding:15px;"><div class="card-category">板块</div><div class="card-title" style="color:#000; font-size:18px;">${b.name}</div></div>
                            </div>
                        `).join('')}
                        ${data.sections.map(s => `
                            <div class="fluent-card" style="height:120px; background:#fff;" onclick="loadPosts('${s.board}', '${s.name}')">
                                <div style="padding:15px;"><div class="card-category">分区 @ ${s.board}</div><div class="card-title" style="color:#000; font-size:18px;">${s.name}</div></div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <div class="nav-title" style="margin-top:30px;">帖子 (${data.posts.length})</div>
                <div class="card-grid">
                    ${data.posts.map(p => createPostCardHTML(p)).join('')}
                </div>
                ${data.posts.length === 0 && !data.users.length ? '<div style="padding:50px; text-align:center; color:#999;">空空如也</div>' : ''}
            </div>
        `;
    });
}

const config = { image_host: "http://pcfs.eno.ink:28888" };