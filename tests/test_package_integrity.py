"""Input snapshots must reproduce the packaged application, including hero binding."""
from pathlib import Path
import json,shutil,subprocess,sys,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from generate import load_config,generate
from hero_binding import binding_payload,binding_path
class PackageIntegrityTests(unittest.TestCase):
 def setUp(self):
  import openpyxl
  from PIL import Image
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name);self.input=self.base/'input';shutil.copytree(ROOT/'input/assets',self.input/'assets');self.book=self.input/'event.xlsx';shutil.copy2(ROOT/'input/fictional-conference.xlsx',self.book)
  Image.new('RGB',(8,2),'blue').save(self.input/'assets/hero.png');wb=openpyxl.load_workbook(self.book);sheet=wb['event'];found=False
  for row in sheet.iter_rows(min_row=2):
   if row[0].value=='branding.heroImage':row[1].value='assets/hero.png';found=True
  if not found:sheet.append(['branding.heroImage','assets/hero.png','reviewed fixture'])
  wb.save(self.book);cfg,assets=load_config(self.book);self.metadata=binding_path(self.book,cfg['branding']['heroSourceImage']);self.metadata.write_text(json.dumps(binding_payload(cfg,assets)))
  self.template=self.base/'template';self.template.mkdir();(self.template/'package.json').write_text('{}');self.app=self.base/'app';generate(self.book,self.app,self.template)
 def tearDown(self):self.temp.cleanup()
 def package(self,destination):
  return subprocess.run([sys.executable,str(ROOT/'scripts/package_instance.py'),'--instance',str(self.app),'--input',str(self.book),'--destination',str(destination)],capture_output=True,text=True)
 def test_unchanged_input_packages_binding_and_reproduces_config(self):
  dest=self.base/'delivery';result=self.package(dest);self.assertEqual(result.returncode,0,result.stderr)
  self.assertTrue((dest/'source-input/assets/hero.png.facts.json').is_file());cfg,_=load_config(dest/'source-input/event.xlsx');self.assertEqual(cfg,json.loads((dest/'config.json').read_text()))
 def test_missing_binding_is_rejected_before_delivery_written(self):
  self.metadata.unlink();dest=self.base/'delivery';result=self.package(dest);self.assertEqual(result.returncode,2);self.assertIn('先重新生成',result.stderr);self.assertFalse(dest.exists())
 def test_same_filename_changed_image_or_public_resource_is_rejected(self):
  from PIL import Image
  for kind in ['image','pdf']:
   with self.subTest(kind=kind):
    file=self.input/('assets/hero.png' if kind=='image' else 'assets/participant-notes.pdf');original=file.read_bytes()
    if kind=='image':Image.new('RGB',(8,2),'red').save(file)
    else:file.write_bytes(original+b'\n%updated resource fixture')
    dest=self.base/('delivery-'+kind);result=self.package(dest);self.assertEqual(result.returncode,2,result.stdout);self.assertIn('先重新生成',result.stderr);self.assertFalse(dest.exists());file.write_bytes(original)
if __name__=='__main__':unittest.main()
