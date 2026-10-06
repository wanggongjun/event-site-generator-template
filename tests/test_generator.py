"""Generator regression tests; edit XLSX XML fixtures without another authoring tool."""
from pathlib import Path
import io
import json
import shutil
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from generate import ConfigError, generate, load_config, event_facts, resource_destination
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def mutate_workbook(source, destination, sheet_name, updates=None, duplicate_row=None):
    """Patch only requested XML fixture cells; no spreadsheet app side effects."""
    with ZipFile(source) as z:
        files={name:z.read(name) for name in z.namelist()}
    workbook=ET.fromstring(files['xl/workbook.xml'])
    rid=None
    for sheet in workbook.findall('s:sheets/s:sheet',NS):
        if sheet.attrib['name']==sheet_name:
            rid=sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
    relationships=ET.fromstring(files['xl/_rels/workbook.xml.rels'])
    target=next(r.attrib['Target'] for r in relationships if r.attrib['Id']==rid)
    filename=target.lstrip('/') if target.startswith('/') else 'xl/'+target
    tree=ET.fromstring(files[filename]);data=tree.find('s:sheetData',NS)
    for cell in data.findall('s:row/s:c',NS):
        if cell.attrib['r'] in (updates or {}):
            value=updates[cell.attrib['r']]
            for child in list(cell):
                cell.remove(child)
            cell.attrib['t']='inlineStr'
            ET.SubElement(ET.SubElement(cell,'{'+NS['s']+'}is'),'{'+NS['s']+'}t').text=str(value)
    if duplicate_row:
        old=next(r for r in data if r.attrib['r']==str(duplicate_row))
        row=ET.fromstring(ET.tostring(old));number=max(int(r.attrib['r']) for r in data)+1
        row.attrib['r']=str(number)
        for c in row:
            if 'r' in c.attrib:
                c.attrib['r']=''.join(ch for ch in c.attrib['r'] if ch.isalpha())+str(number)
        data.append(row)
    files[filename]=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
    with ZipFile(destination,'w',ZIP_DEFLATED) as z:
        for name,content in files.items():
            z.writestr(name,content)


class GeneratorTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='event-generator-test-')
        self.base=Path(self.tmp.name)
        self.input=self.base/'input';shutil.copytree(ROOT/'input',self.input)
        self.workbook=self.input/'fictional-conference.xlsx'
        self.output=self.base/'event'
        self.template=self.base/'template';self.template.mkdir()
        (self.template/'package.json').write_text('{"scripts":{"start":"node backend/index.js"}}')
        (self.template/'backend').mkdir();(self.template/'backend/index.js').write_text('// runtime placeholder')
        (self.template/'backend/.env.example').write_text('PORT=3000\n')
        (self.template/'backend/data').mkdir();(self.template/'backend/data/SHOULD_NOT_COPY').write_text('business')
        (self.template/'node_modules').mkdir();(self.template/'node_modules/SHOULD_NOT_COPY').write_text('dependency')

    def tearDown(self):
        self.tmp.cleanup()

    def change(self,sheet,updates=None,duplicate_row=None):
        new=self.input/'changed.xlsx';mutate_workbook(self.workbook,new,sheet,updates,duplicate_row)
        return new

    def run_generate(self,workbook=None):
        return generate(workbook or self.workbook,self.output,self.template)

    def test_generation_independent_config_assets_and_materials(self):
        _,manifest=self.run_generate()
        self.assertEqual(manifest['eventSlug'],'aurora-research-forum-2027')
        config=json.loads((self.output/'config.json').read_text())
        self.assertEqual(config['files'],{'maxFileBytes':20971520,'maxAttachments':3,'allowedExtensions':['pdf','docx','pptx']})
        self.assertEqual(config['recordings'],[])
        self.assertTrue((self.output/'frontend/public/assets/hero.svg').exists())
        for mirror in ('frontend/public/config.json','frontend/src/config.generated.json'):
            self.assertEqual((self.output/mirror).read_bytes(),(self.output/'config.json').read_bytes())
        for name in ('poster.svg','conference-guide.docx','conference-guide.html','social-posts.txt'):
            self.assertTrue((self.output/'materials'/name).exists())
        self.assertFalse((self.output/'backend/data').exists())
        self.assertFalse((self.output/'node_modules').exists())

    def test_arbitrary_event_names_and_escaped_svg_html(self):
        workbook=self.change('event',{'B3':'新名 & <研究> 未来会议','B4':'未来','B9':'星河大厅'})
        self.run_generate(workbook)
        cfg=json.loads((self.output/'config.json').read_text())
        self.assertEqual(cfg['event']['title'],'新名 & <研究> 未来会议')
        svg=(self.output/'frontend/public/assets/hero.svg').read_text()
        self.assertIn('新名 &amp; &lt;研究&gt; 未来会议',svg)
        self.assertIn('星河大厅',svg)
        self.assertNotIn('磐石',svg)

    def test_recordings_toggle_default_off_and_explicit_on(self):
        cfg,_=load_config(self.workbook);self.assertFalse(cfg['event']['recordingsEnabled']);self.assertEqual(cfg['recordings'],[])
        cfg,_=load_config(self.change('event',{'B13':'true'}))
        self.assertTrue(cfg['event']['recordingsEnabled']);self.assertEqual(len(cfg['recordings']),1)

    def test_invalid_config_never_touches_output(self):
        for updates in ({'B10':'0'},{'B13':'maybe'},{'B8':'Mars/Unknown'},{'B17':'2028-01-01T00:00:00'},{'B12':'javascript:alert(1)'},{'B20':'../../secret.png'},{'A20':'smtp.password'}):
            with self.subTest(updates=updates):
                bad=self.change('event',updates)
                with self.assertRaises(ConfigError):
                    self.run_generate(bad)
                self.assertFalse(self.output.exists())

    def test_missing_required_and_duplicate_rows_rejected(self):
        for sheet,kwargs in [('event',{'updates':{'B3':''}}),('event',{'duplicate_row':3}),('agenda',{'duplicate_row':2}),('faqs',{'duplicate_row':2})]:
            with self.subTest(sheet=sheet,kwargs=kwargs):
                with self.assertRaises(ConfigError):
                    self.run_generate(self.change(sheet,**kwargs))
                self.assertFalse(self.output.exists())

    def test_unknown_directory_and_slug_change_rejected(self):
        self.output.mkdir();(self.output/'important.txt').write_text('keep')
        with self.assertRaises(ConfigError):self.run_generate()
        self.assertEqual((self.output/'important.txt').read_text(),'keep')
        shutil.rmtree(self.output)
        self.run_generate()
        with self.assertRaises(ConfigError):self.run_generate(self.change('event',{'B2':'another-event'}))
        self.assertEqual(json.loads((self.output/'manifest.json').read_text())['eventSlug'],'aurora-research-forum-2027')

    def test_regeneration_preserves_database_uploads_credentials_and_unknown_files(self):
        self.run_generate()
        protected={'backend/data/event.sqlite':b'BUSINESS-STATE','backend/uploads/a.pdf':b'PRIVATE-UPLOAD','backend/.env':b'DATABASE_URL=private','uploads/b.pdf':b'STORED','operator-notes.txt':b'KEEP'}
        for rel,content in protected.items():
            p=self.output/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
        self.run_generate(self.change('event',{'B3':'更新标题'}))
        for rel,content in protected.items():
            self.assertEqual((self.output/rel).read_bytes(),content)
        self.assertEqual(json.loads((self.output/'config.json').read_text())['event']['title'],'更新标题')

    def test_bad_regeneration_preserves_all_existing_files(self):
        self.run_generate()
        before={p.relative_to(self.output):p.read_bytes() for p in self.output.rglob('*') if p.is_file()}
        with self.assertRaises(ConfigError):self.run_generate(self.change('event',{'B6':'2029-01-01T09:00:00'}))
        self.assertEqual(before,{p.relative_to(self.output):p.read_bytes() for p in self.output.rglob('*') if p.is_file()})

    def test_repeat_generation_is_byte_identical(self):
        _,a=self.run_generate();_,b=self.run_generate()
        self.assertEqual(a,b)
        self.assertEqual(a['sha256'],b['sha256'])

    def test_shared_facts_across_all_materials(self):
        self.run_generate();cfg=json.loads((self.output/'config.json').read_text());facts=event_facts(cfg)
        svg=(self.output/'materials/poster.svg').read_text();hero=(self.output/'frontend/public/assets/hero.svg').read_text()
        posts=(self.output/'materials/social-posts.txt').read_text();guide=(self.output/'materials/conference-guide.html').read_text()
        with ZipFile(self.output/'materials/conference-guide.docx') as z:doc=z.read('word/document.xml').decode()
        for text in (facts['title'],facts['dates'],facts['location']):
            for artifact in (svg,hero,posts,guide,doc):self.assertIn(text,artifact)
        self.assertIn('20MB',posts+guide+doc)

    def test_resource_requires_exactly_one_destination(self):
        with self.assertRaises(ConfigError):self.run_generate(self.change('resources',{'C2':'https://example.org/two'}))
        with self.assertRaises(ConfigError):self.run_generate(self.change('resources',{'D2':'../outside.pdf'}))

    def test_late_registration_submissions_and_post_event_supplements_allowed(self):
        workbook=self.change('event',{'B15':'2027-03-19T17:00:00','B17':'2027-03-19T16:00:00','B18':'2027-04-02T23:59:00'})
        config,_=load_config(workbook)
        self.assertGreater(config['attendance']['closeAt'],config['event']['startAt'])
        self.assertGreater(config['submission']['closeAt'],config['event']['startAt'])
        self.assertGreater(config['submission']['supplementCloseAt'],config['event']['endAt'])
        self.run_generate(workbook)

    def test_optional_supplement_deadline_defaults_to_submission_close(self):
        config,_=load_config(self.change('event',{'B18':''}))
        self.assertEqual(config['submission']['supplementCloseAt'],config['submission']['closeAt'])
        self.run_generate(self.change('event',{'B18':''}))

    def test_v1_rejects_unsupported_english_interface(self):
        with self.assertRaises(ConfigError):
            load_config(self.change('event',{'B11':'en'}))

    def test_standalone_resource_link_and_canonical_workflow(self):
        config,_=load_config(self.workbook)
        resource=next(item for item in config['resources'] if item.get('asset'))
        self.assertEqual(resource_destination(config,resource),'https://conference.example.org'+resource['asset'])
        config['event']['siteUrl']=''
        self.assertIn('本地演示路径',resource_destination(config,resource))
        self.assertIn('需补材料',next(item['answer'] for item in config['faqs'] if item['question']=='如何补充投稿附件？'))
        default,_=load_config(self.change('event',{'B19':''}))
        self.assertEqual(default['branding']['primaryColor'],'#5b9bd5')

    def test_symlink_output_is_rejected(self):
        actual=self.base/'actual';actual.mkdir();self.output.symlink_to(actual,target_is_directory=True)
        with self.assertRaises(ConfigError):self.run_generate()
        self.assertEqual(list(actual.iterdir()),[])

if __name__=='__main__':unittest.main()
