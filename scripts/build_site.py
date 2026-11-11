#!/usr/bin/env python3
"""Build a static HTML book without transforming chapter contents (Python 3.10+)."""

import argparse
from collections import deque
from dataclasses import dataclass
from functools import partial
from html import escape
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
GROUPS = (("core_chapters", "I", "核心章节"), ("special_topics", "II", "专题解读"))
START = "<!-- CATALOG:START -->"
END = "<!-- CATALOG:END -->"
MARKER = ".build-site"
OWNER = "llm-learning-notes/static-build-v1\n"
WEB_TYPES = {
    ".html", ".htm", ".css", ".js", ".mjs", ".svg", ".png", ".jpg", ".jpeg",
    ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf",
    ".mp4", ".webm", ".mp3", ".wav", ".ogg", ".vtt", ".wasm", ".glb", ".gltf",
}
EXPLICIT_TYPES = WEB_TYPES | {".json", ".csv", ".tsv", ".txt", ".pdf"}
LICENSES = {"OFL.txt", "LICENSE", "LICENSE.txt"}
FIELDS = {"$schema", "title", "description", "order", "published", "entry", "supplements", "extra_files"}
CSS_URL = re.compile(r"url\(\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s)]+))\s*\)", re.I)
CSS_IMPORT = re.compile(r"@import\s+['\"]([^'\"]+)['\"]", re.I)


class BuildError(Exception):
    pass


@dataclass
class Course:
    directory: Path
    group: str
    title: str
    description: str
    order: int
    published: bool
    entry: str
    supplements: list
    extra_files: list


def safe_file(root, path):
    try:
        relative = path.relative_to(root)
    except ValueError:
        raise BuildError(f"文件越出项目边界：{path}") from None
    current = root
    for part in relative.parts:
        current /= part
        if current.is_symlink():
            raise BuildError(f"不发布符号链接：{relative}")
        if part.startswith('.') or part in {"node_modules", "__pycache__"}:
            raise BuildError(f"不发布隐藏文件或工具目录：{relative}")
    if not path.is_file():
        raise BuildError(f"本地文件不存在：{relative}")
    return path


def local_path(source, value):
    value = value.strip()
    if '\\' in value or any(ord(char) < 32 for char in value):
        raise BuildError(f"{source}: 非法 URL {value!r}")
    try:
        url = urlsplit(value)
    except ValueError as error:
        raise BuildError(f"{source}: 无效 URL {value!r}") from error
    if url.scheme.lower() in {"http", "https"} or (url.netloc and value.startswith('//')):
        if url.hostname in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
            raise BuildError(f"{source}: 不能发布本机服务地址 {value}")
        return None
    if url.scheme.lower() in {"data", "mailto", "tel"}:
        return None
    if url.scheme:
        raise BuildError(f"{source}: 不支持的协议 {value}")
    path = unquote(url.path)
    if not path:
        return None
    if path.startswith('/') or '\\' in path or any(ord(char) < 32 for char in path):
        raise BuildError(f"{source}: 请使用相对路径，不能使用站点根路径或本机路径：{value}")
    parts = list(source.parent.parts)
    for part in PurePosixPath(path).parts:
        if part == '..':
            if not parts:
                raise BuildError(f"{source}: 路径越界：{value}")
            parts.pop()
        elif part != '.':
            parts.append(part)
    return Path(*parts)


def metadata_path(value, label, html=False):
    if not isinstance(value, str) or not value.strip():
        raise BuildError(f"{label}: 路径不能为空")
    url = urlsplit(value)
    if (url.scheme or url.netloc or url.query or value.startswith('/')
            or '\\' in value or '%' in value or '..' in PurePosixPath(url.path).parts
            or any(part.startswith('.') for part in PurePosixPath(url.path).parts)):
        raise BuildError(f"{label}: 必须使用教程目录内的相对路径：{value}")
    if not url.path or (html and Path(url.path).suffix.lower() not in {'.html', '.htm'}):
        raise BuildError(f"{label}: 必须指向 HTML 文件：{value}")
    return value


def load_courses(root):
    courses = []
    warnings = []
    for group, _, _ in GROUPS:
        base = root / group
        if base.is_symlink():
            raise BuildError(f"教程分类目录不能是符号链接：{group}")
        if not base.exists():
            continue
        for directory in sorted(base.iterdir()):
            if directory.name.startswith('.') or not directory.is_dir():
                continue
            if directory.is_symlink():
                raise BuildError(f"教程目录不能是符号链接：{directory}")
            manifest = directory / 'course.json'
            if not manifest.exists():
                if (directory / 'index.html').exists():
                    warnings.append(f"未收录 {directory.relative_to(root)}：缺少 course.json")
                continue
            safe_file(root, manifest)
            label = str(manifest.relative_to(root))
            try:
                data = json.loads(manifest.read_text(encoding='utf-8'))
            except (ValueError, UnicodeError) as error:
                raise BuildError(f"{label}: JSON 格式错误：{error}") from error
            if not isinstance(data, dict) or set(data) - FIELDS:
                raise BuildError(f"{label}: 元数据必须是对象，且不能包含未知字段；参见 scripts/course.schema.json")
            if not isinstance(data.get('title'), str) or not data['title'].strip():
                raise BuildError(f"{label}: title 必须为非空字符串")
            if type(data.get('order')) is not int or type(data.get('published')) is not bool:
                raise BuildError(f"{label}: order 必须为整数，published 必须明确为 true/false")
            description = data.get('description', '')
            if not isinstance(description, str):
                raise BuildError(f"{label}: description 必须为字符串")
            entry = metadata_path(data.get('entry', 'index.html'), label, html=True)
            if urlsplit(entry).fragment:
                raise BuildError(f"{label}: entry 不能带锚点")
            supplements = data.get('supplements', [])
            if not isinstance(supplements, list):
                raise BuildError(f"{label}: supplements 必须为数组")
            for item in supplements:
                if (not isinstance(item, dict) or set(item) != {'title', 'path'}
                        or not isinstance(item['title'], str) or not item['title'].strip()):
                    raise BuildError(f"{label}: 每篇补充阅读需要 title 和 path")
                metadata_path(item['path'], label, html=True)
            extras = data.get('extra_files', [])
            if not isinstance(extras, list):
                raise BuildError(f"{label}: extra_files 必须为数组")
            for value in extras:
                metadata_path(value, label)
                if urlsplit(value).fragment:
                    raise BuildError(f"{label}: extra_files 不接受锚点")
            courses.append(Course(directory.relative_to(root), group, data['title'], description,
                                  data['order'], data['published'], entry, supplements, extras))
    return sorted(courses, key=lambda course: (course.order, course.directory.as_posix())), warnings


def course_url(course, value):
    path, separator, fragment = value.partition('#')
    result = quote((course.directory / path).as_posix(), safe='/')
    return result + ('#' + quote(fragment, safe='/') if separator else '')


def render_home(template, courses):
    if template.count(START) != 1 or template.count(END) != 1 or template.index(START) > template.index(END):
        raise BuildError("index.html 必须包含一对 CATALOG:START / CATALOG:END 标记")
    active = [course for course in courses if course.published]
    total = sum(len(course.supplements) for course in active)
    lines = [f'<div class="catalog-heading"><h2>目录</h2><p>{len(active)} 个章节 · {total} 篇补充阅读</p></div>']
    number = 0
    for group, numeral, title in GROUPS:
        selected = [course for course in active if course.group == group]
        if not selected:
            continue
        lines += [f'<section class="part" aria-labelledby="{group}">',
                  f'<div class="part-heading"><span>PART {numeral}</span><h3 id="{group}">{title}</h3></div>',
                  '<ol class="chapters">']
        for course in selected:
            number += 1
            lines += ['<li class="chapter">',
                      f'<a class="chapter-link" href="{escape(course_url(course, course.entry))}">'
                      f'<span class="chapter-number">{number:02d}</span>'
                      f'<span class="chapter-title">{escape(course.title)}</span>'
                      '<span class="chapter-leader" aria-hidden="true"></span>'
                      '<span class="chapter-arrow" aria-hidden="true">↗</span></a>']
            if course.description:
                lines.append(f'<p class="chapter-description">{escape(course.description)}</p>')
            if course.supplements:
                lines.append('<ul class="supplements">')
                for index, item in enumerate(course.supplements, 1):
                    lines.append(f'<li><a href="{escape(course_url(course, item["path"]))}">'
                                 f'<span class="supplement-label">补充 {index}</span>'
                                 f'<span>{escape(item["title"])}</span></a></li>')
                lines.append('</ul>')
            lines.append('</li>')
        lines += ['</ol>', '</section>']
    if not active:
        lines.append('<p class="empty">尚无已发布章节。</p>')
    before, remainder = template.split(START)
    _, after = remainder.split(END)
    return before + START + '\n' + '\n'.join(lines) + '\n' + END + after


def css_references(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    urls = [next(value for value in match.groups() if value is not None) for match in CSS_URL.finditer(text)]
    urls.extend(CSS_IMPORT.findall(text))
    image_sets = re.finditer(
        r'''(?:-webkit-)?image-set\(((?:[^()'"]+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\([^()]*\))*)\)''',
        text, re.I,
    )
    for image_set in image_sets:
        urls.extend(match.group(2) for match in re.finditer(r'''(?:^|,)\s*(['"])(.*?)\1''', image_set.group(1)))
    return urls


def srcset_references(text):
    urls = []
    while text.strip(' ,\t\n\r'):
        text = text.lstrip(' ,\t\n\r')
        match = re.match(r'\S+', text)
        value = match.group()
        text = text[len(value):]
        urls.append(value.rstrip(','))
        if not value.endswith(','):
            _, separator, text = text.partition(',')
            if not separator:
                break
    return urls


class References(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.urls = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'base':
            raise BuildError("不支持 <base>；请使用相对路径，保证仓库子路径可部署")
        self.in_style = self.in_style or tag == 'style'
        for name in ('href', 'src', 'poster', 'xlink:href'):
            if values.get(name):
                self.urls.append(values[name])
        if tag == 'object' and values.get('data'):
            self.urls.append(values['data'])
        for name in ('srcset', 'imagesrcset'):
            if values.get(name):
                self.urls.extend(srcset_references(values[name]))
        if values.get('style'):
            self.urls.extend(css_references(values['style']))
        if values.get('srcdoc'):
            nested = References()
            nested.feed(values['srcdoc'])
            self.urls.extend(nested.urls)

    def handle_endtag(self, tag):
        if tag == 'style':
            self.in_style = False

    def handle_data(self, data):
        if self.in_style:
            self.urls.extend(css_references(data))


def collect_files(root, courses, home):
    directories = {course.directory for course in courses if course.published}
    explicit = set()
    queue = deque([Path('index.html')])
    shared_license = Path('assets/fonts/OFL.txt')
    if (root / shared_license).exists():
        explicit.add(shared_license)
    for course in courses:
        if not course.published:
            continue
        queue.append(course.directory / course.entry)
        queue.extend(course.directory / urlsplit(item['path']).path for item in course.supplements)
        explicit.update(course.directory / value for value in course.extra_files)
    queue.extend(sorted(explicit))
    files = {}
    while queue:
        relative = queue.popleft()
        if relative in files:
            continue
        if relative != Path('index.html') and not (relative.is_relative_to('assets') or any(relative.is_relative_to(directory) for directory in directories)):
            raise BuildError(f"链接指向未发布目录（可能是草稿或缺少元数据）：{relative}")
        source = safe_file(root, root / relative)
        suffix = source.suffix.lower()
        if source.name == 'course.json' or (suffix not in WEB_TYPES and relative not in explicit and source.name not in LICENSES):
            raise BuildError(f"不自动发布此类文件：{relative}；确需公开的数据请加入所属章节 extra_files")
        if relative in explicit and suffix not in EXPLICIT_TYPES and source.name not in LICENSES:
            raise BuildError(f"不允许发布源码或配置文件：{relative}")
        data = home.encode('utf-8') if relative == Path('index.html') else source.read_bytes()
        files[relative] = data
        urls = []
        if suffix in {'.html', '.htm', '.svg', '.css'}:
            text = data.decode('utf-8')
            if suffix == '.css':
                urls = css_references(text)
            else:
                parser = References()
                try:
                    parser.feed(text)
                except BuildError as error:
                    raise BuildError(f"{relative}: {error}") from error
                urls = parser.urls
        for value in urls:
            target = local_path(relative, value)
            if target is None:
                continue
            if (root / target).is_dir():
                target /= 'index.html'
            try:
                safe_file(root, root / target)
            except BuildError as error:
                raise BuildError(f"{relative} 引用 {value!r}: {error}") from error
            queue.append(target)
    return files


def build(root=ROOT, check=False):
    root = root.resolve()
    courses, warnings = load_courses(root)
    template = safe_file(root, root / 'index.html').read_text(encoding='utf-8')
    home = render_home(template, courses)
    files = collect_files(root, courses, home)
    output = root / '_site'
    if not check:
        if output.is_symlink() or (output.exists() and (not output.is_dir() or not (output / MARKER).is_file()
                or (output / MARKER).read_text(encoding='utf-8') != OWNER)):
            raise BuildError("_site 已存在但不是本工具生成的目录；请先手动改名，防止覆盖个人文件")
        with tempfile.TemporaryDirectory(prefix='_site-tmp-', dir=root) as temporary:
            stage = Path(temporary) / 'site'
            stage.mkdir()
            for relative, content in sorted(files.items()):
                destination = stage / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
            (stage / '.nojekyll').write_text('', encoding='utf-8')
            (stage / MARKER).write_text(OWNER, encoding='utf-8')
            if output.exists():
                shutil.rmtree(output)
            stage.rename(output)
    return {'published': sum(course.published for course in courses),
            'drafts': sum(not course.published for course in courses),
            'files': len(files) + 1, 'warnings': warnings, 'output': output}


def main():
    parser = argparse.ArgumentParser(
        description='自动收录独立 HTML 教程，校验本地资源并生成 _site/。不改写章节正文。',
        epilog='新增章节：在 core_chapters/<目录>/ 或 special_topics/<目录>/ 添加 course.json；'
               '参照 scripts/course.schema.json 和现有章节。published=false 为草稿。'
               'HTML/CSS 的静态引用自动收集；JS 动态加载、模块导入及数据文件需登记 extra_files。'
               '不联网检查外链，不验证动态锚点或执行交互。源码根首页是模板，请预览 _site/。')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='仅校验，不生成或覆盖 _site/')
    mode.add_argument('--serve', action='store_true', help='构建并预览 _site/；修改后 Ctrl+C 并重新运行')
    parser.add_argument('--port', type=int, default=8000, help='本地预览端口（默认 8000）')
    args = parser.parse_args()
    try:
        result = build(check=args.check)
        for warning in result['warnings']:
            print(f'警告：{warning}', file=sys.stderr)
        print(f"{'检查通过' if args.check else '构建完成'}：{result['published']} 个章节，"
              f"{result['drafts']} 个草稿（不发布），{result['files']} 个发布文件。", flush=True)
        if not args.check:
            print(f"输出：{result['output']}", flush=True)
        if args.serve:
            handler = partial(SimpleHTTPRequestHandler, directory=str(result['output']))
            with ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
                print(f'预览：http://127.0.0.1:{server.server_port}/  （Ctrl+C 停止）', flush=True)
                server.serve_forever()
    except KeyboardInterrupt:
        return 0
    except (BuildError, OSError, UnicodeError, ValueError) as error:
        print(f'构建失败：{error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
