# 大模型学习笔记

一份持续更新的大模型交互式教程。通过与 AI 对话生成独立的 HTML 页面，用图表、滑块和实验理解概念；不要求将教程正文写成 Markdown，也不限制每章的布局与交互。

**[在线阅读](https://rayleizhu.github.io/llm-learning-notes/)** · **[发布状态](https://github.com/rayleizhu/llm-learning-notes/actions/workflows/pages.yml)**

目前包含 Scaling Law、DeepSeek-V4.1、Looped Transformer 及相关补充阅读。首页采用书籍目录样式，由各章的 `course.json` 自动生成。

## 本地预览

需要 **Python 3.10+**，只使用标准库，无需安装 npm 或 pip 依赖。

在项目根目录运行：

```bash
python3 scripts/build_site.py --serve
```

打开 <http://127.0.0.1:8000/>。端口被占用时加上 `--port 8001`。修改文件后，按 `Ctrl+C` 停止，再运行一次以重新构建。

> 根目录 `index.html` 是首页模板，实际站点生成在 `_site/`。不要直接把源码根目录当成发布站点，也不要手工修改 `_site/`。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `core_chapters/<章节>/` | 核心章节：HTML、资源文件和 `course.json` |
| `special_topics/<专题>/` | 专题解读，结构同上 |
| `index.html`、`assets/` | 首页模板与公共资源 |
| `scripts/build_site.py` | 自动收录、资源检查、构建与预览 |
| `scripts/course.schema.json` | 章节元数据规范 |
| `.github/workflows/pages.yml` | GitHub Pages 自动发布流程 |
| `_site/` | 生成的发布目录，已被 Git 忽略 |

## 维护流程

**与 AI 生成或修改 HTML → 更新章节信息 → 本地检查与预览 → 提交并推送 → 自动上线。**

### 1. 新增或更新章节

在 `core_chapters/` 或 `special_topics/` 下创建一个章节目录，生成 `index.html` 及所需的 CSS、JavaScript、图片等。也可以将样式和脚本内嵌在单个 HTML 中。

同时创建或更新 `course.json`，可直接参考[现有章节配置](core_chapters/scaling_law/course.json)：

| 字段 | 说明 |
| --- | --- |
| `title` | 必填，目录中显示的章节标题 |
| `order` | 必填，同分类内从小到大排序；建议使用 10、20、30 |
| `published` | 必填，`true` 发布，`false` 为草稿 |
| `description` | 可选，一句话简介 |
| `entry` | 可选，默认 `index.html` |
| `supplements` | 可选，补充阅读列表，每项包含 `title` 和 `path` |
| `extra_files` | 可选，需要额外发布的文件路径列表 |

路径相对于章节目录。补充阅读可以指向 `notes.html#section`。页面资源使用相对路径，章节入口保留指向 `../../index.html` 的“返回总目录”链接。

可以直接给 AI 这样的要求：

> 在指定分类下生成独立交互式 HTML 教程，同步创建或更新 `course.json`，参照现有章节与元数据规范。使用相对资源路径，提供返回总目录的链接，登记补充阅读与运行时资源，不手改首页目录。

无需手工登记首页：构建器会扫描两个分类下的章节目录，收录 `published: true` 的教程。没有 `course.json` 的章节不会收录。

### 2. 检查与预览

```bash
python3 scripts/build_site.py --check
python3 scripts/build_site.py --serve
```

构建器检查本地文件引用；图表、滑块、公式和动画仍需在浏览器中确认。草稿不会进入 `_site/`；需要预览未发布草稿时，可单独打开它的 HTML，依赖 HTTP 加载的页面需使用本地静态服务器。

如修改了构建器，运行回归测试：

```bash
python3 -m unittest discover -s scripts -p 'test_*.py' -v
```

### 3. 提交与发布

确认待提交文件后，通过 Git 提交源码并推送到 `main`。例如仅修改一个章节时：

```bash
git status
git add core_chapters/你的章节目录/
git diff --cached --stat
git commit -m "Update tutorial"
git push origin main
```

GitHub Actions 自动执行 **测试 → 收录与构建 → 上传 `_site/` → 部署 Pages**。PR 只检查，不发布。若失败，在[工作流页面](https://github.com/rayleizhu/llm-learning-notes/actions/workflows/pages.yml)查看日志；测试或构建失败不会继续部署。

删除章节或设为 `published: false`，下一次成功发布会从目录和网站中移除该章；同时要更新其他页面指向它的链接。

## 首次启用 GitHub Pages

仓库 **Settings → Pages → Source** 选择 **GitHub Actions**，不要选择直接从分支发布。随后推送到 `main`，或在 **Actions → Build and publish tutorials → Run workflow** 手动运行。

如果更换仓库名称或发布分支，需要相应调整链接、工作流中的分支条件及 Pages 环境设置。

## 注意事项

- 教程 HTML/CSS/JS 原样保留；构建只生成首页并收集发布所需资源。
- HTML/CSS 中的常见静态引用会自动收集；JS 的 `fetch`、模块导入、Worker 等动态依赖及其间接依赖，需要逐个登记到 `extra_files`。JSON、CSV、下载资料也需明确登记。
- 不自动检查外链可用性或动态锚点，部分教程仍依赖外部 CDN。
- 不提交 `_site/`、`.codebuddy/`、测试日志、密钥或私人资料。`published: false` 只控制网站发布，**公开仓库中的草稿源码仍然可见**。
- 保留所使用字体等第三方资源的许可证。

更完整的操作说明与检查边界见 [scripts/USAGE.txt](scripts/USAGE.txt)。
