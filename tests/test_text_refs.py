"""Fixed build-time prose references preserve one source for repeated facts."""
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
from text_refs import resolve_content_refs, date_range


def fixture():
    prose = '{{event.title}} {{event.shortTitle}} {{event.dateRange}} {{event.location}}（{{travel.address}}）由{{organizers.主办单位}}主办，联合{{organizers.协办单位}}；支持{{organizers.支持单位}}。'
    return {
        'event': {'title': '原活动全称', 'shortTitle': '原活动', 'startDate': '2026-09-04', 'endDate': '2026-09-08', 'location': '原主会场'},
        'home': {'intro': [prose], 'target': '', 'features': [{'title': '{{event.shortTitle}}', 'description': prose}],
                 'organizers': [{'role': '主办单位','name': '主办甲'}, {'role': '主办单位','name': '主办乙'}, {'role':'协办单位','name':'协办丙'}, {'role':'支持单位','name':'支持丁'}]},
        'travel': {'address': '原街道地址', 'directions': [{'title':'{{event.location}}交通', 'body': prose}]},
        **{name: [{field: prose for field in fields}] for name, fields in {
            'agenda': ('title','speaker','chair','location'), 'notices':('title','body'), 'mealGuide':('title','body'),
            'sourceNotes':('title','body'), 'hotels':('name','address','description'), 'contacts':('name','responsibility','note'),
            'faqs':('question','answer'), 'resources':('title','description'), 'recordings':('title','description'),
            'brandmarks':('label',),
        }.items()}
    }


class ContentReferenceTests(unittest.TestCase):
    def test_date_label_preserves_handbook_precision_and_year_boundaries(self):
        self.assertEqual(date_range({'startDate':'2026-09-04','endDate':'2026-09-08'}), '2026年9月4日至9月8日')
        self.assertEqual(date_range({'startDate':'2026-09-04','endDate':'2026-09-04'}), '2026年9月4日')
        self.assertEqual(date_range({'startDate':'2026-09-30','endDate':'2026-10-02'}), '2026年9月30日至10月2日')
        self.assertEqual(date_range({'startDate':'2026-12-31','endDate':'2027-01-02'}), '2026年12月31日至2027年1月2日')

    def test_changes_to_canonical_facts_rebuild_all_known_prose(self):
        config=fixture()
        config['event'].update(title='新活动 & <研究>',shortTitle='新简称',startDate='2027-01-05',endDate='2027-01-07',location='新会场')
        config['travel']['address']='新街道地址'
        config['home']['organizers'][0]['name']='新主办甲 & <机构>'
        original=deepcopy(config)
        self.assertIs(resolve_content_refs(config), config)
        text=str(config)
        for fact in ('新活动 & <研究>','新简称','2027年1月5日至1月7日','新会场（新街道地址）','新主办甲 & <机构>、主办乙'):
            self.assertIn(fact,text)
        for name in ('agenda','notices','mealGuide','sourceNotes','hotels','contacts','faqs','resources','recordings','brandmarks'):
            for value in config[name][0].values():
                self.assertIn('新活动 & <研究>',value)
                self.assertNotIn('{{',value)
        self.assertEqual(config['home']['organizers'],original['home']['organizers'])
        self.assertEqual(config['event'],original['event'])
        self.assertEqual(config['travel']['address'], original['travel']['address'])
        self.assertNotIn('&amp;',config['home']['intro'][0])
        self.assertEqual(resolve_content_refs(config),config)

    def test_unknown_malformed_expression_and_forbidden_field_refs_reject_atomically(self):
        for token, target in [('{{event.capacity}}','intro'),('{{ event.title }}','intro'),('{{event.title.upper()}}','intro'),('{{event.title}','intro'),('{{__import__("os")}}','intro'),('{{event.title}}','url')]:
            with self.subTest(token=token,target=target):
                config=fixture()
                if target=='url':config['resources'][0]['url']='https://example.org/'+token
                else:config['home']['intro'].append(token)
                before=deepcopy(config)
                with self.assertRaises(ValueError):resolve_content_refs(config)
                self.assertEqual(config,before)

    def test_missing_role_ref_and_recursive_canonical_refs_reject(self):
        config=fixture();config['home']['organizers']=[]
        with self.assertRaises(ValueError):resolve_content_refs(config)
        config=fixture();config['event']['title']='{{event.shortTitle}}'
        with self.assertRaises(ValueError):resolve_content_refs(config)



    def test_contextual_html_svg_and_docx_escaping_occurs_after_resolution(self):
        from generate import load_config
        from materials import write_materials
        config,_=load_config(ROOT/'input/fictional-conference.xlsx')
        config['home']['intro']=['{{event.title}}在{{event.location}}（{{travel.address}}）举办。']
        config['event']['title']='新标题 & <研究>'
        config['event']['location']='新地点 & <会场>'
        resolve_content_refs(config)
        with tempfile.TemporaryDirectory() as tmp:
            stage=Path(tmp);write_materials(stage,config)
            html=(stage/'materials/conference-guide.html').read_text()
            svg=(stage/'materials/poster.svg').read_text()
            ET.fromstring(svg)
            self.assertIn('新标题 &amp; &lt;研究&gt;',html)
            self.assertIn('新标题 &amp; &lt;研究&gt;',svg)
            self.assertNotIn('&amp;amp;',html+svg)
            with ZipFile(stage/'materials/conference-guide.docx') as archive:
                tree=ET.fromstring(archive.read('word/document.xml'))
            raw=''.join(element.text or '' for element in tree.iter() if element.tag.endswith('}t'))
            self.assertIn('新标题 & <研究>',raw)
            self.assertIn('新地点 & <会场>',raw)


if __name__=='__main__':unittest.main()
