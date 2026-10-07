"""Branded hero compatibility/structure; these are SVG tests, not browser QA."""
import base64, sys, unittest, xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from hero import hero_svg
NS={'s':'http://www.w3.org/2000/svg'}
PIXEL=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
def config():
 return {'event':{'title':'示例学术会议','shortTitle':'示例学术会议','startDate':'2030-05-01','endDate':'2030-05-03','location':'示例会场'},'branding':{'seriesText':'系列活动'},'brandmarks':[]}
class HeroTests(unittest.TestCase):
 def test_existing_logo_input_is_consumed_as_first_default_brandmark(self):
  c=config();c['branding']['logo']='/assets/logo.png'
  root=ET.fromstring(hero_svg(c,{'assets/logo.png':PIXEL}))
  marks=[x for x in root.findall('s:g/s:image',NS)]
  self.assertEqual(len(marks),1);self.assertEqual(marks[0].attrib['x'],'48')
  self.assertTrue(marks[0].attrib['href'].startswith('data:image/png;base64,'))
 def test_explicit_brandmarks_replace_logo_and_layout_regions_are_independent(self):
  c=config();c['branding']['logo']='/assets/ignored.png';c['brandmarks']=[{'label':'甲机构','asset':'/assets/a.png'},{'label':'乙机构','asset':'/assets/b.png'}]
  root=ET.fromstring(hero_svg(c,{'assets/a.png':PIXEL,'assets/b.png':PIXEL}))
  self.assertEqual(len(root.findall('s:g/s:image',NS)),2)
  labels={x.attrib.get('id'):''.join(x.itertext()) for x in root.findall('s:g/s:text',NS)}
  self.assertEqual(labels['editable-event-title'],'示例学术会议')
  self.assertIn('2030年5月1日',labels['editable-event-dates']);self.assertIn('示例会场',labels['editable-event-venue'])
  self.assertEqual(root.attrib['viewBox'],'0 0 2048 512')
 def test_date_only_does_not_synthesize_midnight_and_text_is_escaped(self):
  c=config();c['event']['shortTitle']='甲<&乙';c['event']['location']='地点<&待确认'
  svg=hero_svg(c);ET.fromstring(svg)
  self.assertIn('甲&lt;&amp;乙',svg);self.assertNotIn('00:00',svg);self.assertNotIn('23:59',svg)
if __name__=='__main__':unittest.main()
