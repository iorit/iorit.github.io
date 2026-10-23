# iorit 的博客 — 项目说明（给 DSH / AI 协作）

个人静态博客，Hugo + PaperMod 主题，部署在 GitHub Pages：<https://iorit.github.io/>。
仓库：`https://github.com/iorit/iorit.github.io`（本地目录 `E:\blog`，分支 `main`）。
内容以中文为主，作者的沟通语言是中文。

本项目此前由 opencode 的 vibe coding 建立，现在由 DSH 接手维护。下文是交接时整理的事实与约定，改动前请先读完。

## 技术栈与工具链

| 组件 | 版本 / 位置 |
| --- | --- |
| Hugo | 0.165.0 **extended**（`%LOCALAPPDATA%\hugo\hugo.exe`，或 PATH 里的 `hugo`；CI 用同版本） |
| Node.js | v24（跑 `scripts/` 下的两个转换脚本） |
| 主题 | PaperMod，以完整源码放在 `themes/PaperMod/`（`go.mod` 无版本号，即本地引入） |
| 部署 | `.github/workflows/hugo.yaml`：push 到 `main` → Actions 构建 → GitHub Pages |

## 目录结构与各自的职责

```
hugo.yaml                 站点配置（baseURL、菜单、params、goldmark、module mounts）
content/
  文章/                   算法与数据结构学习笔记（少量，带图）
    image/<主题名>/        文章配图，通过 module mount 映射成 assets/image
    *.pdf                  Obsidian 导出的 PDF，.gitignore 忽略，仅本地留存
  过往/                   从 cnblogs 迁移过来的 143 篇旧文
  随笔/                   生活随笔（含 page bundle 目录 PKU伙食大测评/）
  about.md, archives.md   固定页面（archives.md 用 layout: archives）
assets/
  css/extended/*.css      PaperMod 的「extended」约定：这里的 CSS 自动打进全站
  wallpaper/              动态壁纸（可选，见下文），可能为空
layouts/                  仅 4 个文件，覆盖主题默认行为：
  index.html              首页改成「文件夹网格」入口（folder-grid）
  _markup/render-image.html  图片渲染：按 `{width=NNN}` 出 2 倍图、PNG 转 WebP、超 1600px 兜底缩放
  partials/extend_head.html  MathJax 3（CDN）
  partials/extend_footer.html  全站动态壁纸的挂载点
scripts/
  gen-tree.js             扫描 content/ 生成 static/tree/index.html（「文件结构」页）
  fix-obsidian-links.js   把 Obsidian 图片语法转成 Hugo 可识别的形式
  fix-post-images.js      图片归位 + 单文件文章转文章文件夹 + 裂图拦截
  publish.ps1             一键发布（补 front matter → 构建检查 → git push）
  set-wallpaper.ps1       把视频/图片处理成 assets/wallpaper/wallpaper.<ext>
publish.cmd / set-wallpaper.cmd   双击入口，只是 powershell -File 的包装
static/                   favicon 系列 + 生成的 tree/index.html
themes/PaperMod/          上游主题源码，**不要直接改**（改了就同步不回去了）
public/ resources/        构建产物，已被 .gitignore 忽略
```

## 发布流程（最重要）

`scripts/publish.ps1` 就是这套流程的唯一入口，等价于：

1. 扫描 `content/**/*.md`，给缺 front matter 的文章补 `title` / `date`（取文件修改时间）/ `draft: false`；
2. `node scripts/fix-obsidian-links.js` —— 把 `![[x|400]]`、`![](x|400)` 转成 `![](x)` + 下一行 `{width=400}`；
3. `node scripts/fix-post-images.js` —— **图片归位**：把 Obsidian 存到别处的图片按文件名找回并搬进文章文件夹；带图的单文件 md 自动转成文章文件夹（`x.md` → `x/index.md`，URL 不变）；**找不到任何图片就以非 0 退出，publish 中止**，绝不会发布裂图；
4. `node scripts/gen-tree.js` —— 重新生成 `static/tree/index.html`（**它已被 git 跟踪，忘了跑就会留下过期 diff**；必须在第 3 步之后，结构可能变了）；
5. `hugo --gc --minify` 本地构建，**构建失败就中止，不提交**；
6. `git add -A` → `git commit -m "publish: YYYY-MM-DD HH:mm"` → `git push`（脚本会自动读 Windows 系统代理，重试 3 次）。

在 DSH 里发布时按同样的顺序手动执行即可。提交信息沿用 `publish: <时间>` 的格式，历史全是这个风格。

```powershell
node scripts/fix-obsidian-links.js
node scripts/fix-post-images.js
node scripts/gen-tree.js
& "$env:LOCALAPPDATA\hugo\hugo.exe" --gc --minify
git add -A; git commit -m "publish: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"; git push
```

## 内容约定

- **front matter**：`title` / `date`（+08:00）/ `draft: false` 是常态；`过往/` 下的旧文还有 `source: <原 cnblogs 链接>`；目录用 `description`，固定页会用 `layout` / `url` / `summary`。
- **新增文章**：放 `content/文章/`、`content/随笔/` 或 `content/过往/`。`_index.md` 负责该分区的标题与描述，不要删。
- **配图**：两种放法都行，`fix-post-images.js` 会自动判位。
  - **文章文件夹（推荐，Obsidian 拖图即用）**：`content/随笔/某篇/index.md` 旁边放图，正文写裸文件名 `![](abc.png)`。注意 `.md` 必须是 `index.md`，改名就散架。
  - **共享图库**：`content/文章/image/<主题>/`，正文写 `image/<主题>/<文件名>`，经 `hugo.yaml` 的 mount 映射成 `assets/image`。
  - **显示尺寸**：正文写 `{width=400}` 时，`render-image.html` 按 2 倍（800px）出图保证高分屏清晰，PNG 自动转 WebP；不写则超过 1600px 才缩。
- **Obsidian 附件位置**：两个 vault（`content/随笔`、`content/文章`）的 `.obsidian/app.json` 都设了 `"attachmentFolderPath": "./"`，即「存到当前笔记所在文件夹」。这样拖图进 bundle 文章就直接落在文章目录里。改这个设置前先关掉 Obsidian，否则退出时会覆盖回去。
- **数学公式**：goldmark `passthrough` 已开（`$...$`、`$$...$$`、`\(...\)`、`\[...\]`），前端由 MathJax 渲染。注意正文里大量用 `$1.$`、`$2.2.1.$` 这种编号写法，别随手把 `$` 配对搞坏。
- **Obsidian 痕迹**：文章目录里的 `.obsidian/`、`*.base`、`*.canvas`、`test*.md` 都是本地残留，`.gitignore` 已忽略，不要提交、也不要当正文处理。`content/文章/test'.md` 是 0 字节空文件。
- **front matter 之后的正文**不要加一级标题（PaperMod 会自己渲染 title），旧文里有 `# ABC211 Solution` 这类由脚本补的标题，属于既有遗留，新文不必模仿。

## 容易踩的坑

- **编码**：所有 `.md`/`.yaml` 都是 UTF-8（无 BOM）。Windows PowerShell 5.1 的 `Get-Content` / `Out-File` 默认不是 UTF-8，会把中文写成乱码 —— 读写一律用 `-Encoding UTF8`，或 `[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)`。`scripts/publish.ps1` 开头设置 `[Console]::OutputEncoding = UTF8` 就是为此。
- **`.ps1` 必须带 UTF-8 BOM**：`publish.cmd` 用 `powershell`（5.1）执行。**没有 BOM 的 .ps1 会被按 GBK 解析，中文注释读乱后直接语法报错**（"缺少右 }"）。改这两个脚本时务必保留 BOM；写完用 `[System.Management.Automation.Language.Parser]::ParseFile()` 验一遍再收工。
- **别改 `themes/PaperMod/`**：样式放 `assets/css/extended/`，布局覆盖放 `layouts/`，这样主题可以整体替换。
- **`static/tree/index.html` 是生成物**：只改 `scripts/gen-tree.js`，再重新生成，不要手工编辑这个 HTML。
- **不要提交** `public/`、`resources/`、`.hugo_build.lock`、`.obsidian/`、`content/**/*.pdf`（`.gitignore` 已覆盖）。
- **深色模式**：`assets/css/extended/dark-text.css` 把深色模式的文字强制提亮成纯白；改配色时注意别把对比度改坏。
- **壁纸**：`assets/wallpaper/` 里存在 `wallpaper.mp4`（约 2.1 MB 动态壁纸），`extend_footer.html` 会自动套用。想换则跑 `set-wallpaper.cmd`（拖入视频/图片；视频会转成无声 H.264、最长 30 秒、最长边 1920px）；想取消就删掉该目录下的文件再发布。

## 完成后怎么验证

- 构建必须干净通过：`hugo --gc --minify`（CI 用 production 环境，`HUGO_VERSION: 0.165.0`）。
- 本地看效果：`hugo server -D`，默认 <http://localhost:1313/>。
- 上线判断：push 到 `main` 后 Actions 约 1~2 分钟部署，地址 <https://iorit.github.io/>。
- 首页是文件夹网格（`.folder-grid`），改首页结构时同时确认 `layouts/index.html` 与 `assets/css/extended/folder-grid.css`。
