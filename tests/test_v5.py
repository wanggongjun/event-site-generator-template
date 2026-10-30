from pathlib import Path
import json,shutil,sys,tempfile,unittest
import openpyxl
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from generate import load_config,generate,ConfigError
class ActivityTemplateTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.book=self.root/'event.xlsx'
  shutil.copyfile(ROOT/'input/fictional-conference.xlsx',self.book);shutil.copytree(ROOT/'input/assets',self.root/'assets')
 def tearDown(self):self.tmp.cleanup()
 def field(self,key,value):
  w=openpyxl.load_workbook(self.book);w['event'].append([key,value,'test']);w.save(self.book)
 def test_single_default_and_explicit_policies(self):
  c,_=load_config(self.book);self.assertEqual(len(c['tracks']),1);self.assertEqual(c['tracks'][0]['form'],'academic');self.assertFalse(c['attendance']['autoClose']);self.assertFalse(c['attendance']['enforceCapacity'])
 def test_multiple_tracks_and_invalid_track(self):
  w=openpyxl.load_workbook(self.book);s=w.create_sheet('tracks');s.append(['key','title','form','description','materials','subtypes','evidenceRequired']);s.append(['paper','研究报告','academic','','摘要','',False]);s.append(['demo','演示','practice','','链接','工具|经验',True]);w.save(self.book)
  c,_=load_config(self.book);self.assertEqual(c['tracks'][1]['subtypes'],['工具','经验']);self.assertTrue(c['tracks'][1]['evidenceRequired'])
  s['C3']='unknown';w.save(self.book)
  with self.assertRaises(ConfigError):load_config(self.book)
 def test_public_files_are_oss_only_and_workflow_is_inherited(self):
  output=self.root/'output';_,manifest=generate(self.book,output)
  c=json.loads((output/'config.json').read_text(encoding='utf8'));f=c['publicFiles'][0]
  self.assertTrue((output/f['source']).is_file());self.assertFalse((output/'frontend/public'/f['originalAsset'].lstrip('/')).exists())
  public=json.loads((output/'frontend/public/config.json').read_text(encoding='utf8'));self.assertNotIn('publicFiles',public)
  self.assertTrue((output/'.github/workflows/deploy.yml').is_file());self.assertTrue((output/'backend/event-policy.js').is_file())
  (output/'keep.txt').write_text('user file');generate(self.book,output);self.assertEqual((output/'keep.txt').read_text(),'user file')
 def test_auto_close_needs_deadline(self):
  w=openpyxl.load_workbook(self.book)
  for row in w['event']:
   if row[0].value in ['submission.openAt','submission.closeAt','submission.supplementCloseAt']:row[1].value=None
  w['event'].append(['submission.autoClose',True,'test']);w.save(self.book)
  with self.assertRaises(ConfigError):load_config(self.book)
if __name__=='__main__':unittest.main()
