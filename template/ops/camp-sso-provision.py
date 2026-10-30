"""Register only the authorized camp origin; all credentials stay on the server."""
import json,os,pathlib,secrets,subprocess

origin='https://kiz-ai-camp-2026.tashan.ac.cn'
path=pathlib.Path('/opt/events/kiz-ai-camp-2026/production/shared/tashan-sso.env')
values={}
if path.exists():
 for line in path.read_text().splitlines():
  if '=' in line:
   k,v=line.split('=',1);values[k]=v
 if values.get('TASHAN_SSO_ORIGIN')!=origin:
  raise RuntimeError('Existing SSO configuration belongs to another origin')

script=r'''
import json,sys
from app.services import sso_service as service
from app.storage.database.postgres_client import get_db_session
config=json.load(sys.stdin)
origin='https://kiz-ai-camp-2026.tashan.ac.cn'
matches=[c for c in service.list_clients() if c['origin']==origin]
if config:
 assert len(matches)==1 and matches[0]['client_id']==config['TASHAN_SSO_CLIENT_ID'],'SSO client registration mismatch'
 with get_db_session() as db:
  client=service._client(db,config['TASHAN_SSO_CLIENT_ID'],config['TASHAN_SSO_CLIENT_SECRET'])
  assert client['origin']==origin and client['redirect_uri']==origin+'/auth/callback'
 print(json.dumps({'existing':True}))
else:
 assert not matches,'Existing camp SSO client needs its original server configuration; refusing to rotate it'
 print(json.dumps(service.create_client('昆明动物所 AI for Science 实训营',origin)))
'''
result=subprocess.run(['docker','exec','-i','tashan-topiclab-topiclab-backend-1','python','-c',script],input=json.dumps(values),text=True,capture_output=True)
if result.returncode:
 raise RuntimeError('Camp SSO client registration/validation failed; credentials and existing clients were preserved')
data=json.loads(result.stdout.strip().splitlines()[-1])
if not values:
 values={'TASHAN_SSO_CLIENT_ID':data['client_id'],'TASHAN_SSO_CLIENT_SECRET':data['client_secret'],
         'TASHAN_SSO_ENCRYPTION_KEY':secrets.token_hex(32),'TASHAN_SSO_ORIGIN':origin,
         'TASHAN_SSO_API_BASE':'https://world.tashan.chat/api','TASHAN_SSO_LOGIN_URL':'https://world.tashan.chat/sso/login'}
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
print(json.dumps({'ssoConfigured':True,'origin':origin,'callback':origin+'/auth/callback'}))
