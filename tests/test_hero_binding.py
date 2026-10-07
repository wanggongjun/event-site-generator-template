"""A static asset cannot silently retain old name/date/venue after canonical updates."""
from pathlib import Path
import copy,json,sys,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from hero_binding import apply_hero_binding,binding_payload,binding_path
class HeroBindingTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.workbook=Path(self.temp.name)/'event.xlsx';(self.workbook.parent/'assets').mkdir()
  self.config={'event':{'title':'会议甲','shortTitle':'甲','startDate':'2030-05-01','endDate':'2030-05-03','location':'会场甲'},'branding':{'heroImage':'/assets/assets/hero.png'},'travel':{'address':'街道甲'},'home':{'organizers':[{'role':'主办单位','name':'机构甲'}]},'brandmarks':[]};self.assets={'assets/assets/hero.png':b'unchanged-supplied-image-bytes'}
 def tearDown(self):self.temp.cleanup()
 def bind(self,c=None):
  c=c or self.config;path=binding_path(self.workbook,c['branding']['heroImage']);path.write_text(json.dumps(binding_payload(c,self.assets)));return path
 def test_unbound_image_warns_and_falls_back_without_blocking(self):
  apply_hero_binding(self.config,self.assets,self.workbook);self.assertEqual(self.config['branding']['heroImage'],'/assets/hero.svg');self.assertEqual(self.config['branding']['heroBinding']['mode'],'fallback');self.assertIn('已改用',self.config['branding']['heroWarning']);self.assertEqual(self.assets['assets/assets/hero.png'],b'unchanged-supplied-image-bytes')
 def test_matching_reviewed_binding_preserves_exact_supplied_image(self):
  self.bind();apply_hero_binding(self.config,self.assets,self.workbook);self.assertEqual(self.config['branding']['heroImage'],'/assets/assets/hero.png');self.assertEqual(self.config['branding']['heroBinding']['mode'],'bound');self.assertNotIn('heroWarning',self.config['branding'])
 def test_name_dates_venue_and_organization_updates_never_silently_reuse_old_image(self):
  self.bind()
  for kind in ['title','dates','venue','organization','bytes']:
   with self.subTest(kind=kind):
    c=copy.deepcopy(self.config);assets=dict(self.assets)
    if kind=='title':c['event']['title']='会议乙'
    elif kind=='dates':c['event']['endDate']='2030-05-04'
    elif kind=='venue':c['event']['location']='会场乙'
    elif kind=='organization':c['home']['organizers'][0]['name']='机构乙'
    else:assets['assets/assets/hero.png']=b'replaced-image'
    apply_hero_binding(c,assets,self.workbook);self.assertEqual(c['branding']['heroImage'],'/assets/hero.svg')
 def test_explicit_reviewed_confirmation_can_reuse_same_image_when_operator_verifies(self):
  self.bind();c=copy.deepcopy(self.config);c['event']['title']='会议乙';path=binding_path(self.workbook,c['branding']['heroImage']);path.write_text(json.dumps(binding_payload(c,self.assets)))
  apply_hero_binding(c,self.assets,self.workbook);self.assertEqual(c['branding']['heroBinding']['mode'],'bound')
 def test_bad_binding_is_a_warning_not_a_global_gate(self):
  self.bind().write_text('not-json');apply_hero_binding(self.config,self.assets,self.workbook);self.assertEqual(self.config['branding']['heroBinding']['mode'],'fallback')
if __name__=='__main__':unittest.main()
