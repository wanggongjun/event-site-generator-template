import json,pathlib,subprocess,socket
def run(args):
 p=subprocess.run(args,capture_output=True,text=True);return p.stdout.strip() if p.returncode==0 else 'unavailable'
print('identity',run(['id','-u']))
print('ports',run(['ss','-ltn']))
print('nginx',run(['which','nginx']))
print('certbot',run(['which','certbot']))
for p in ['/opt/panshi-forum/shared','/opt/tashan-profile-hub-production/shared','/root/.aliyun','/root/.acme.sh','/opt/panshi-forum/current/backend']:
 d=pathlib.Path(p);print(p,sorted(x.name for x in d.iterdir()) if d.is_dir() else 'missing')
for p in pathlib.Path('/opt/panshi-forum/shared').glob('*.env'):
 print('env keys',p.name,[line.split('=',1)[0] for line in p.read_text().splitlines() if '=' in line and not line.startswith('#')])
print('forum unit',run(['systemctl','show','panshi-forum','--property=ExecStart,EnvironmentFiles,User']))
try: print('domain',socket.gethostbyname('kiz-ai-camp-2026.tashan.ac.cn'))
except: print('domain needs DNS')
for p in ['/root/.aliyun/config.json','/root/.acme.sh/account.conf']:
 path=pathlib.Path(p)
 if path.is_file():
  if p.endswith('.json'):
   try:
    data=json.loads(path.read_text());print('DNS profiles',[(v.get('name'),v.get('mode')) for v in data.get('profiles',[])])
   except: print('DNS config exists')
  else: print('DNS provider keys',[l.split('=',1)[0] for l in path.read_text().splitlines() if '=' in l and ('Ali' in l or 'ALI' in l or 'DNS' in l)])
