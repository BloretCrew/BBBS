# Bloret BBS 开放平台 API 文档

本文档提供了 Bloret BBS 的所有公开接口说明。开发者可以使用这些 API 开发第三方客户端、统计机器人或进行数据分析。

## 基础信息

*   **API 根路径**: `http://<your-domain>:21111/api`
*   **认证方式**: Cookie Session (需要在浏览器环境或请求头携带 `session` cookie)。
*   **数据格式**: JSON

---

## 1. 基础数据接口

### 1.1 获取板块结构
获取论坛所有的板块及下属分区结构。

*   **URL**: `/structure`
*   **Method**: `GET`
*   **Auth**: 不需要
*   **Response**:
    ```json
    {
        "技术交流": ["NodeJS", "Python", "Frontend"],
        "生活闲聊": ["灌水区", "摄影分享"]
    }
    ```

### 1.2 获取所有帖子 (全量)
获取全站所有帖子信息（用于首页瀑布流或统计）。

*   **URL**: `/all-posts`
*   **Method**: `GET`
*   **Auth**: 不需要
*   **Response**: Array
    ```json
    [
        {
            "filename": "17000000.json",
            "board": "技术交流",
            "section": "NodeJS",
            "title": "如何使用 Express",
            "author": "Admin",
            "time": 1700000000000,
            "likes": ["user1", "user2"],
            "content": "..."
        },
        ...
    ]
    ```

### 1.3 搜索帖子
根据关键词搜索帖子标题或内容。

*   **URL**: `/search`
*   **Method**: `GET`
*   **Auth**: 不需要
*   **Params**:
    *   `q` (必填): 搜索关键词
*   **Response**: Array
    ```json
    [
        {
            "board": "技术交流",
            "section": "NodeJS",
            "title": "Express 中间件详解",
            "preview": "中间件是 Express 的核心...",
            "likes": 5
        }
    ]
    ```

### 1.4 系统状态
获取论坛的运行统计数据。

*   **URL**: `/system/stats`
*   **Method**: `GET`
*   **Auth**: 不需要
*   **Response**:
    ```json
    {
        "version": "1.0.0",
        "stats": {
            "boards": 5,
            "sections": 12,
            "posts": 340
        },
        "server_time": 1700000000000
    }
    ```

---

## 2. 帖子交互接口

### 2.1 获取分区帖子列表
*   **URL**: `/posts`
*   **Method**: `GET`
*   **Params**:
    *   `board` (必填): 板块名
    *   `section` (必填): 分区名
*   **Response**: Array (帖子对象列表)

### 2.2 发布帖子
*   **URL**: `/post`
*   **Method**: `POST`
*   **Auth**: 需要登录
*   **Body**:
    ```json
    {
        "board": "技术交流",
        "section": "NodeJS",
        "title": "我的新发现",
        "content": "Markdown 内容...",
        "tags": []
    }
    ```

### 2.3 点赞/取消点赞
*   **URL**: `/post/like`
*   **Method**: `POST`
*   **Auth**: 需要登录
*   **Body**:
    ```json
    {
        "board": "技术交流",
        "section": "NodeJS",
        "filename": "1700000.json"
    }
    ```
*   **Response**:
    ```json
    {
        "success": true,
        "liked": true, // true 表示点赞成功，false 表示取消点赞
        "count": 10    // 当前总赞数
    }
    ```

---

## 3. 用户与管理接口

### 3.1 获取当前登录用户
*   **URL**: `/user`
*   **Method**: `GET`
*   **Response**:
    ```json
    {
        "username": "Admin",
        "email": "admin@example.com",
        "admin": true
    }
    ```
    *(未登录返回 `null`)*

### 3.2 用户公开资料
查询指定用户的发帖统计和最近动态。

*   **URL**: `/user/profile/:username`
*   **Method**: `GET`
*   **Example**: `/api/user/profile/Admin`
*   **Response**:
    ```json
    {
        "username": "Admin",
        "postCount": 42,
        "receivedLikes": 156,
        "recentPosts": [
            { "title": "最新公告", "board": "公告", "time": 17000... }
        ]
    }
    ```

### 3.3 关注/取关 (板块或分区)
*   **URL**: `/user/follow`
*   **Method**: `POST`
*   **Auth**: 需要登录
*   **Body**:
    ```json
    {
        "type": "board", // 或 "section"
        "target": "技术交流" // 或 "技术交流/NodeJS"
    }
    ```

### 3.4 管理操作 (综合接口)
执行禁言、黑名单、分区管理等操作。

*   **URL**: `/manage/update`
*   **Method**: `POST`
*   **Auth**: 需要登录 (且具有 Owner 或 Admin 权限)
*   **Body Action 类型**:
    1.  `setMuted`: 禁言设置 `{"muted": true}`
    2.  `updateBlacklist`: 黑名单 `{"type": "add", "user": "badguy"}`
    3.  `manageSecAdmin`: 设置分区管理员 `{"type": "add", "user": "mod"}`
    4.  `sectionConfig`: 修改分区图片 `{"image": "http..."}`
    5.  `deletePost`: 删除帖子 `{"filename": "..."}`
    6.  `reorderSections`: 排序 `{"newOrder": ["A", "B"]}`

---

## 4. 工具接口

### 4.1 图片上传 (代理)
将图片上传到 Bloret Image Host。

*   **URL**: `/upload-proxy`
*   **Method**: `POST`
*   **Content-Type**: `multipart/form-data`
*   **Param**: `image` (文件)
*   **Response**:
    ```json
    {
        "success": true,
        "data": { "url": "/img/..." }
    }
    ```