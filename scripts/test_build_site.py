import json
from pathlib import Path
import tempfile
import unittest

from build_site import BuildError, END, MARKER, START, build, local_path, srcset_references


class BuildSiteTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.write('index.html', f'<!doctype html><html><body>{START}placeholder{END}</body></html>')
        self.directory = 'core_chapters/example'
        self.course(self.directory)

    def write(self, path, content):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding='utf-8')
        return file

    def course(self, directory, **changes):
        data = {'title': '示例章节', 'description': '交互实验', 'order': 10, 'published': True}
        data.update(changes)
        self.write(f'{directory}/course.json', json.dumps(data, ensure_ascii=False))
        entry = self.root / directory / data.get('entry', 'index.html')
        if not entry.exists():
            self.write(f'{directory}/index.html', '<!doctype html><a href="../../index.html">目录</a>')

    def output(self, path='index.html'):
        return self.root / '_site' / path

    def test_build_preserves_html_and_only_publishes_dependencies(self):
        source = '<!doctype html><link href="styles.css" rel="stylesheet"><script src="app.js"></script>'
        self.write(f'{self.directory}/index.html', source)
        self.write(f'{self.directory}/styles.css', '@font-face{src:url("fonts/test.ttf?v=3")}')
        self.write(f'{self.directory}/fonts/test.ttf', 'font-fixture')
        self.write(f'{self.directory}/app.js', 'document.title = "interactive";')
        self.write(f'{self.directory}/private.html', 'not linked')
        self.write(f'{self.directory}/private.json', '{"secret":true}')
        self.write('.codebuddy/private.txt', 'keep local')
        before = (self.root / 'index.html').read_bytes()
        result = build(self.root)
        self.assertEqual(result['published'], 1)
        self.assertEqual(self.output(f'{self.directory}/index.html').read_text(), source)
        self.assertTrue(self.output(f'{self.directory}/fonts/test.ttf').exists())
        self.assertFalse(self.output(f'{self.directory}/private.html').exists())
        self.assertFalse(self.output(f'{self.directory}/private.json').exists())
        self.assertFalse(self.output(f'{self.directory}/course.json').exists())
        self.assertFalse(self.output('.codebuddy').exists())
        self.assertTrue((self.root / '.codebuddy/private.txt').exists())
        self.assertEqual((self.root / 'index.html').read_bytes(), before)
        self.assertTrue(self.output('.nojekyll').exists())

    def test_order_supplements_and_escaped_metadata(self):
        self.course(self.directory, title='<script>bad</script>', supplements=[{'title': 'A & B', 'path': 'notes.html#section'}])
        self.write(f'{self.directory}/notes.html', '<h1 id="section">补充</h1>')
        self.course('core_chapters/first', title='First', order=0)
        self.course('special_topics/last', title='Last', order=-1)
        build(self.root)
        home = self.output().read_text()
        self.assertLess(home.index('First'), home.index('&lt;script&gt;'))
        self.assertLess(home.index('&lt;script&gt;'), home.index('Last'))
        self.assertIn('A &amp; B', home)
        self.assertIn('notes.html#section', home)
        self.assertTrue(self.output(f'{self.directory}/notes.html').exists())

    def test_draft_removes_previously_published_files(self):
        build(self.root)
        self.course(self.directory, published=False)
        (self.root / self.directory / 'index.html').unlink()
        result = build(self.root)
        self.assertEqual(result['drafts'], 1)
        self.assertFalse(self.output(self.directory).exists())
        self.assertIn('尚无已发布章节', self.output().read_text())

    def test_link_to_draft_fails_instead_of_leaking_it(self):
        self.course('special_topics/draft', published=False)
        self.write(f'{self.directory}/index.html', '<a href="../../special_topics/draft/index.html">draft</a>')
        with self.assertRaisesRegex(BuildError, '未发布目录'):
            build(self.root)

    def test_missing_resource_preserves_previous_output(self):
        build(self.root)
        before = self.output().read_bytes()
        self.write(f'{self.directory}/index.html', '<img src="missing.png">')
        with self.assertRaisesRegex(BuildError, 'missing.png'):
            build(self.root)
        self.assertEqual(self.output().read_bytes(), before)
        self.assertFalse(list(self.root.glob('_site-tmp-*')))

    def test_check_does_not_write_output(self):
        result = build(self.root, check=True)
        self.assertEqual(result['published'], 1)
        self.assertFalse(self.output().exists())

    def test_unmanaged_output_is_never_deleted(self):
        self.write('_site/personal.txt', 'important')
        with self.assertRaisesRegex(BuildError, '防止覆盖'):
            build(self.root)
        self.assertEqual(self.output('personal.txt').read_text(), 'important')

    def test_symlink_output_is_rejected(self):
        (self.root / '_site').symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(BuildError):
            build(self.root)
        self.assertTrue((self.root / 'index.html').exists())

    def test_symlink_dependency_is_rejected(self):
        self.write('private.js', 'private')
        (self.root / self.directory / 'linked.js').symlink_to(self.root / 'private.js')
        self.write(f'{self.directory}/index.html', '<script src="linked.js"></script>')
        with self.assertRaisesRegex(BuildError, '符号链接'):
            build(self.root)

    def test_unknown_or_invalid_metadata_fails(self):
        cases = [{'published': 'false'}, {'order': True}, {'title': ''}, {'publish': True}, {'extra_files': 'data.json'}]
        for changes in cases:
            with self.subTest(changes=changes):
                self.course(self.directory, **changes)
                with self.assertRaises(BuildError):
                    build(self.root)

    def test_missing_manifest_is_not_silently_published(self):
        self.write('special_topics/unlisted/index.html', '<p>unlisted</p>')
        result = build(self.root)
        self.assertEqual(len(result['warnings']), 1)
        self.assertFalse(self.output('special_topics/unlisted').exists())

    def test_extra_files_include_dynamic_dependencies_and_license(self):
        self.course(self.directory, extra_files=['data.json', 'module.mjs', 'OFL.txt'])
        self.write(f'{self.directory}/data.json', '{"value":1}')
        self.write(f'{self.directory}/module.mjs', 'export const value = 1;')
        self.write(f'{self.directory}/OFL.txt', 'license')
        build(self.root)
        self.assertTrue(self.output(f'{self.directory}/data.json').exists())
        self.assertTrue(self.output(f'{self.directory}/module.mjs').exists())
        self.assertTrue(self.output(f'{self.directory}/OFL.txt').exists())

    def test_data_files_require_explicit_opt_in(self):
        self.write(f'{self.directory}/index.html', '<a href="data.json">data</a>')
        self.write(f'{self.directory}/data.json', '{}')
        with self.assertRaisesRegex(BuildError, 'extra_files'):
            build(self.root)
        self.course(self.directory, extra_files=['data.json'])
        build(self.root)
        self.assertTrue(self.output(f'{self.directory}/data.json').exists())

    def test_extra_files_cannot_publish_metadata_or_tools(self):
        for name in ['course.json', 'secret.py', '.env', '../other.html']:
            with self.subTest(name=name):
                self.course(self.directory, extra_files=[name])
                if name == 'secret.py':
                    self.write(f'{self.directory}/{name}', 'private')
                with self.assertRaises(BuildError):
                    build(self.root)

    def test_external_urls_data_and_fragments_are_not_files(self):
        html = '<a href="https://example.org/paper">source</a><img src="data:image/svg+xml;base64,AAAA"><a href="#dynamic/id">note</a><svg><use href="#shape"/></svg><div style="fill:url(#shape)"></div>'
        self.write(f'{self.directory}/index.html', html)
        build(self.root)

    def test_css_import_inline_styles_srcset_and_directory_links(self):
        self.write(f'{self.directory}/index.html', '<link href="css/main.css"><style>.a{background:url(bg.svg)}</style><img srcset="small.png 1x, large.png 2x"><a href="more/">more</a>')
        self.write(f'{self.directory}/css/main.css', '@import "other.css"; .a{background:url("../bg.svg")}')
        for path in ['css/other.css', 'bg.svg', 'small.png', 'large.png', 'more/index.html']:
            self.write(f'{self.directory}/{path}', '')
        build(self.root)
        for path in ['css/other.css', 'bg.svg', 'small.png', 'large.png', 'more/index.html']:
            self.assertTrue(self.output(f'{self.directory}/{path}').exists())

    def test_srcset_data_url_with_commas(self):
        self.assertEqual(srcset_references('data:image/png;base64,AAAA 1x, a.png 2x'), ['data:image/png;base64,AAAA', 'a.png'])
        self.assertEqual(srcset_references('a.png, b.png'), ['a.png', 'b.png'])
        self.assertEqual(srcset_references('plot,wide.png 1x'), ['plot,wide.png'])
        self.assertEqual(srcset_references('a.png,b.png'), ['a.png,b.png'])

    def test_image_set_and_comma_filename_resources(self):
        self.write(f'{self.directory}/index.html', '<style>.a{background:image-set("a.png" type("image/png") 1x, "b.png" type("image/png") 2x)}</style><img srcset="plot,wide.png 1x">')
        for name in ['a.png', 'b.png', 'plot,wide.png']:
            self.write(f'{self.directory}/{name}', '')
        build(self.root)
        for name in ['a.png', 'b.png', 'plot,wide.png']:
            self.assertTrue(self.output(f'{self.directory}/{name}').exists())

    def test_reject_root_localhost_file_and_encoded_escape_paths(self):
        for url in ['/img.png', 'file:///tmp/a.png', 'http://localhost:8000/a', '%2Fdata/a', '..%2F..%2F..%2Fprivate', '..\\private']:
            with self.subTest(url=url), self.assertRaises(BuildError):
                local_path(Path('core_chapters/example/index.html'), url)

    def test_no_base_tag_or_hidden_dependencies(self):
        for html in ['<base href="/site/">', '<img src=".private/p.png">']:
            self.write(f'{self.directory}/index.html', html)
            with self.assertRaises(BuildError):
                build(self.root)

    def test_deterministic_output(self):
        build(self.root)
        first = {p.relative_to(self.output('')): p.read_bytes() for p in self.output('').rglob('*') if p.is_file()}
        build(self.root)
        second = {p.relative_to(self.output('')): p.read_bytes() for p in self.output('').rglob('*') if p.is_file()}
        self.assertEqual(first, second)
        self.assertIn(Path(MARKER), first)


if __name__ == '__main__':
    unittest.main()
