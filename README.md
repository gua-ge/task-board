# 任务看板

一个面向个人使用的轻量任务看板。需求、BUG、客服三个工作分区始终在同一个页面中展示，方便快速查看未完成事项，并通过任务详情记录处理过程和解决方案。

## 功能

- 三栏看板：固定展示需求、BUG、客服，桌面端并列显示，移动端横向滚动。
- 状态管理：支持待处理、进行中、已完成、停滞四种状态，可在卡片或详情中切换。
- 完成任务：未完成和已完成视图独立切换，已完成任务可按近一周、近一月、全部或自定义日期范围筛选。
- 时间记录：自动记录创建时间；任务完成时自动记录完成时间，也可以在详情中手动调整。
- 任务详情：支持标题、分类、状态、任务描述和解决方案。
- 客服人员：BUG 和客服任务可关联一位自定义客服人员，并在看板卡片中显示。
- 图片附件：可从任务描述或解决方案输入框粘贴 JPG、PNG、GIF、WebP 图片，支持预览和删除，单张最大 10 MB。
- 文档链接：可保存 `http` 或 `https` 外部链接及链接名称，不直接上传 PDF、Word 等文档。
- 本地存储：任务数据使用 SQLite 保存，图片存储在本地数据目录中。

## 运行要求

- Node.js 22.13 或更高版本（项目使用 Node 内置的 `node:sqlite`）
- npm 10 或更高版本

## 本地开发

```bash
git clone git@gitpull-cr.datacaciques.com:tangdonghua/task-board.git
cd task-board
npm ci
npm run dev
```

打开 <http://localhost:3000>。

提交代码前可以运行完整检查：

```bash
npm test
npm run lint
npm run build
```

## 使用说明

1. 点击需求、BUG 或客服分区标题右侧的 `+`，创建对应分类的任务。
2. 点击任务卡片打开详情，可编辑任务描述、解决方案、状态、分类和完成时间。
3. BUG 和客服任务可以在详情中选择客服；没有合适人员时，可直接输入姓名并添加到全局客服名单。
4. 新任务需要先保存，再在任务描述或解决方案输入框粘贴图片；图片统一显示在图片附件区域。
5. 文档通过详情中的文档链接区域添加，保存后可从任务详情直接打开。
6. 顶部可切换未完成和已完成视图；已完成视图默认显示最近 7 天完成的任务。

## 生产部署

以下方式直接运行 Next.js Node.js 服务，不需要 Docker 或额外的运行时依赖。

### 1. 安装和构建

```bash
git clone git@gitpull-cr.datacaciques.com:tangdonghua/task-board.git
cd task-board
npm ci
npm run build
```

建议将生产数据放在代码目录之外。例如先创建 `/var/lib/task-board`，并确保运行应用的系统用户对该目录具有读写权限。

### 2. 启动服务

```bash
TASK_BOARD_DATA_DIR=/var/lib/task-board npm start -- -H 127.0.0.1 -p 3000
```

生产环境应使用现有的进程管理工具（例如 systemd 或 Supervisor）保持服务运行，并在其环境配置中持久设置 `TASK_BOARD_DATA_DIR`。如果不设置该变量，数据默认写入项目根目录的 `.data/`。

### 3. 配置反向代理

可以使用 Nginx 将域名转发到本地的 `3000` 端口：

```nginx
server {
    listen 80;
    server_name task-board.example.com;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

图片单张限制为 10 MB，因此反向代理的请求体限制需要略高于 10 MB。正式环境建议同时配置 HTTPS。

> 当前版本没有登录和权限控制。请不要将服务直接暴露到不受信任的公网；应通过内网、VPN、防火墙白名单或反向代理认证限制访问。

## 数据与持久化

默认数据目录为项目根目录下的 `.data/`，也可以通过 `TASK_BOARD_DATA_DIR` 指定绝对路径：

```text
.data/
├── task-board.sqlite  # 任务、客服、链接和图片元数据
└── uploads/           # 粘贴上传的图片文件
```

SQLite 运行期间可能同时生成 `task-board.sqlite-wal` 和 `task-board.sqlite-shm`。这些文件属于正常运行数据，不应单独删除。

### 备份

1. 停止应用，避免备份过程中仍有数据写入。
2. 复制整个 `TASK_BOARD_DATA_DIR`，不要只复制 SQLite 主文件。
3. 将备份保存到独立磁盘或其他受保护的位置。

### 恢复

1. 停止应用。
2. 使用备份替换整个数据目录，并确认目录所有者和读写权限正确。
3. 重新启动应用，检查任务、链接和图片是否能够正常访问。

### 升级

```bash
git pull --ff-only
npm ci
npm run build
```

升级前应先备份数据目录，构建完成后再重启服务。数据库结构会在应用启动时进行兼容迁移，但不会替代数据备份。

## 当前限制

- 面向单机、单用户使用，不包含登录、权限和多人协作。
- 不包含评论、通知、统计、云端同步和拖拽排序。
- 客服名单目前只支持新增，不支持改名、删除或停用。
- 文档仅保存外部链接，不上传 PDF、Word 等文件。
- Git 仓库不会跟踪 `.data/`；迁移或重新部署时需要单独备份和恢复数据目录。
