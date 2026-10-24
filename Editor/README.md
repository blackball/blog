# blackball 编辑室

本地网页编辑器。它只监听 `127.0.0.1`，读写 `posts/*.md`，点击发布时调用根目录的
`build.py`，生成或更新 `index.html`、`html/*.html` 和 `404.html`。它不会自动 commit
或 push。

## 启动

只需要 Python：

```bash
python -m pip install -r Editor/requirements.txt
python Editor/server.py
```

Windows 下也可以直接双击 `Editor/start.cmd`。默认打开
<http://127.0.0.1:8787/>。常用参数：

```bash
# 换端口
python Editor/server.py --port 8899

# 不自动打开浏览器
python Editor/server.py --no-open
```

编辑器顶部有三个区域：

### 文章

- **新建**：填写标题、日期、URL、作者、年份和正文，然后点右上角「发布」。
- **修改**：从左侧选择文章，修改后点「发布」。
- **删除**：打开文章，点底部「删除文章」，确认后会删除 Markdown 并重新构建。
- **插入图片**：点正文上方的「插入图片」，上传后会在光标处插入
  `![图片](../imgs/文件名)`。
- **预览**：右上角「预览站点」或文章底部的「查看文章」。
- **发布后**：本地文件已经更新，但还需要你自己执行 `git push`。

### 站点

修改站名、标语、作者、页脚箴言、站点简介和 404 标题/文案。保存并发布后会更新
`site.json` 并重建全站。logo 可以在「图片」里更换。

### 图片

- 上传 PNG、JPG、JPEG、WebP、GIF，单张最大 8 MB。
- 复制图片 Markdown。
- 把图片插入当前文章。
- 将图片设为站点 logo，保存到 `site.json` 的 `logo` 字段并重建全站。
- 删除未被文章、站点配置使用的图片；使用中的图片会被拒绝删除。

图片文件保存在 `imgs/`，文章内引用路径是 `../imgs/文件名`。logo 路径和 404 文案
也会由 `build.py` 注入模板。

快捷键：`Ctrl/Cmd + S` 等同于点击当前区域的「发布」或「保存并发布」。

## 前端开发

仓库已经包含构建好的 `Editor/frontend/dist`，日常使用不需要 Node。

如果要改编辑器界面：

```bash
cd Editor/frontend
pnpm install
pnpm dev      # Vite 开发服务器，代理 /api 到 Flask
pnpm build    # 重新生成 dist
```

`Editor/` 不会进入 GitHub Pages 的发布产物。

## 安全边界

- Flask 只绑定 `127.0.0.1`，不要把它暴露到公网。
- 所有写操作都要求启动时生成的随机 token；页面通过 `/api/bootstrap` 获取。
- 删除和发布都会操作真实本地文件，使用前请确认当前目录是博客仓库。
- 上传图片只按扩展名和大小校验；请只上传自己的图片。
- 编辑器不会执行 git 命令，提交和推送始终由你决定。
