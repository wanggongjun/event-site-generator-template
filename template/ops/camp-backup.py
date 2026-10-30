import datetime,json,os,pathlib,shutil,sqlite3
base=pathlib.Path('/opt/events/kiz-ai-camp-2026/production')
shared=base/'shared';stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
target=shared/'backups'/stamp;target.mkdir(parents=True,mode=0o700,exist_ok=False)
os.chmod(target.parent,0o700)
source=sqlite3.connect('file:'+str(shared/'data/recovery.sqlite')+'?mode=ro',uri=True)
dest=sqlite3.connect(str(target/'recovery.sqlite'))
with dest:source.backup(dest)
source.close();dest.close();os.chmod(target/'recovery.sqlite',0o600)
for file in ['app.env','feishu-ids.json','oss-identity.json','profile.env','profile-secret','cms-ids.json','tashan-sso.env']:
 p=shared/file
 if p.is_file():shutil.copy2(p,target/file);os.chmod(target/file,0o600)
for file in ['config.json','REVISION']:
 p=base/'current'/file
 if p.is_file():shutil.copy2(p,target/file);os.chmod(target/file,0o600)
print('Camp backup completed: '+stamp)
