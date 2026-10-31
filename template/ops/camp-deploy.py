"""Provision and release only kiz-ai-camp-2026 on the authorized shared host.
Secrets stay on the host. Existing sites, registration rows and services are untouched.
"""
import base64,datetime,hashlib,hmac,json,os,pathlib,pwd,re,secrets,shutil,socket,subprocess,sys,time,urllib.parse,urllib.request,urllib.error,uuid
SLUG='kiz-ai-camp-2026';DOMAIN=SLUG+'.tashan.ac.cn';PORT=18316
base=pathlib.Path('/opt/events')/SLUG/'production';shared=base/'shared'
upload=pathlib.Path(sys.argv[1]);revision=sys.argv[2]
assert os.geteuid()==0 and re.fullmatch(r'[a-f0-9]{40}',revision)
assert re.fullmatch(r'/tmp/kiz-ai-camp-2026-\d+-\d+',str(upload))
shared.mkdir(parents=True,exist_ok=True,mode=0o700)
for directory in [pathlib.Path('/opt/events'),base.parent,base]:directory.chmod(0o755)
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def output(args):return subprocess.check_output(args,text=True)
def envfile(path):
 result={}
 if pathlib.Path(path).exists():
  for line in pathlib.Path(path).read_text().splitlines():
   if '=' in line and not line.startswith('#'):
    k,v=line.split('=',1);result[k]=v.strip().strip('"').strip("'")
 return result
def saveenv(path,data):
 if any('\n' in str(v) or '\r' in str(v) for v in data.values()):raise RuntimeError('Multiline environment value')
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+str(v)+'\n' for k,v in data.items()))
def atomic(path,content,mode=0o600):
 temp=path.with_name(path.name+'.next');temp.write_text(content);temp.chmod(mode);os.replace(temp,path)
def container(name):return json.loads(output(['docker','inspect',name]))[0]
def envdict(info):return dict(x.split('=',1) for x in info['Config']['Env'] if '=' in x)
old=envfile('/opt/panshi-forum/shared/forum.env')
storage=envdict(container('panshi-camp-production-api-1'))
def cloud(action,service='ram',version='2015-05-01',**args):
 p=dict(Action=action,Version=version,Format='JSON',AccessKeyId=storage['FILE_OSS_ACCESS_KEY_ID'],SignatureMethod='HMAC-SHA1',SignatureVersion='1.0',SignatureNonce=str(uuid.uuid4()),Timestamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),**args)
 enc=lambda v:urllib.parse.quote(str(v),safe='~');q='&'.join(enc(k)+'='+enc(v) for k,v in sorted(p.items()))
 p['Signature']=base64.b64encode(hmac.new((storage['FILE_OSS_ACCESS_KEY_SECRET']+'&').encode(),('GET&%2F&'+enc(q)).encode(),hashlib.sha1).digest()).decode()
 try:
  with urllib.request.urlopen('https://'+service+'.aliyuncs.com/?'+urllib.parse.urlencode(p),timeout=30) as r:result=json.load(r)
 except urllib.error.HTTPError as e:result=json.load(e)
 return result
def checked(action,**args):
 result=cloud(action,**args)
 if 'Code' in result:raise RuntimeError(action+': '+result['Code'])
 return result
# Confirm source archive before unpacking; never unpack a caller-selected path.
run(['sha256sum','-c','camp-release.tar.gz.sha256'],cwd=upload)
release=base/'releases'/revision;release.mkdir(parents=True,exist_ok=True);release.parent.chmod(0o755);release.chmod(0o755)
run(['tar','-xzf',str(upload/'camp-release.tar.gz'),'-C',str(release)])
assert (release/'REVISION').read_text().strip()==revision
node=release/'node';node.chmod(0o755)
print('Release extracted',revision,flush=True)
# Create the approved new subdomain only. Never overwrite another destination.
records=checked('DescribeDomainRecords',service='alidns',version='2015-01-09',DomainName='tashan.ac.cn',RRKeyWord=SLUG,PageSize=100)['DomainRecords']['Record']
matches=[r for r in records if r['RR']==SLUG]
if matches and any(r['Type']!='A' or r['Value']!='8.147.58.40' for r in matches):raise RuntimeError('New domain has a conflicting DNS record')
if not matches:checked('AddDomainRecord',service='alidns',version='2015-01-09',DomainName='tashan.ac.cn',RR=SLUG,Type='A',Value='8.147.58.40',TTL=600)
print('Dedicated DNS configured',DOMAIN,flush=True)
# Least-privilege storage identity for this camp only.
name=SLUG+'-uploads';prefix=SLUG+'/production/'
policy={'Version':'1','Statement':[{'Effect':'Allow','Action':['oss:GetObject','oss:PutObject','oss:DeleteObject','oss:PutObjectAcl'],'Resource':['acs:oss:*:*:'+storage['FILE_OSS_BUCKET']+'/'+prefix+'*']}]}
u=cloud('GetUser',UserName=name)
if u.get('Code')=='EntityNotExist.User':checked('CreateUser',UserName=name,Comments='Kunming AI camp private uploads')
elif 'Code' in u:raise RuntimeError('GetUser: '+u['Code'])
p=cloud('GetPolicy',PolicyType='Custom',PolicyName=name)
if p.get('Code')=='EntityNotExist.Policy':checked('CreatePolicy',PolicyName=name,PolicyDocument=json.dumps(policy,separators=(',',':')))
elif 'Code' in p:raise RuntimeError('GetPolicy: '+p['Code'])
else:
 document=checked('GetPolicyVersion',PolicyType='Custom',PolicyName=name,VersionId=p['Policy']['DefaultVersion'])['PolicyVersion']['PolicyDocument']
 if isinstance(document,str):document=json.loads(document)
 if document!=policy:raise RuntimeError('Existing camp storage policy differs')
attached=cloud('AttachPolicyToUser',PolicyType='Custom',PolicyName=name,UserName=name)
if attached.get('Code') not in [None,'EntityAlreadyExists.User.Policy']:raise RuntimeError('AttachPolicyToUser: '+attached['Code'])
keypath=shared/'oss-identity.json'
if not keypath.exists():atomic(keypath,json.dumps(checked('CreateAccessKey',UserName=name)['AccessKey']))
key=json.loads(keypath.read_text())
print('Dedicated storage identity configured',flush=True)
# Separate tables in the authorized existing Base; no old table writes.
feishu={k:old[k] for k in ['FEISHU_APP_ID','FEISHU_APP_SECRET','FORUM_FEISHU_BASE_TOKEN']}
run([str(node),'ops/provision-feishu.mjs',str(shared/'feishu-ids.json')],cwd=release,env={**os.environ,**feishu})
ids=json.loads((shared/'feishu-ids.json').read_text())
run([str(node),'ops/provision-cms.mjs',str(shared/'cms-ids.json')],cwd=release,env={**os.environ,**feishu,**ids,'FORUM_FEISHU_API_VERSION':old.get('FORUM_FEISHU_API_VERSION','v3')})
cmsids=json.loads((shared/'cms-ids.json').read_text())
# Separate profile API process/client, sharing the established central profiles.
# No replacement or restart of the existing profile API or authentication service.
secretpath=shared/'profile-secret'
if not secretpath.exists():atomic(secretpath,secrets.token_hex(32))
hubsecret=secretpath.read_text().strip();hubname=SLUG+'-profile'
hub=container('tashan-profile-hub-production');hubenv=envdict(hub)
profileenv={k:v for k,v in hubenv.items() if k in ['DATABASE_URL','PGSSLMODE','DB_POOL_SIZE','DB_POOL_MAX_OVERFLOW']}
profileenv.update(PROFILE_HUB_KIZ_SECRET=hubsecret,PROFILE_HUB_ENVIRONMENT='production',PROFILE_HUB_REVISION=revision,DB_POOL_SIZE='2',DB_POOL_MAX_OVERFLOW='1')
saveenv(shared/'profile.env',profileenv)
dockerfile=release/'ops/CampHub.Dockerfile'
dockerfile.write_text('ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nUSER root\nCOPY camp-hub-patch.py /tmp/camp-hub-patch.py\nRUN python /tmp/camp-hub-patch.py\n')
image=SLUG+'-profile:'+revision
baseimage=SLUG+'-profile-base:'+revision
run(['docker','tag',hub['Image'],baseimage])
run(['docker','build','--build-arg','BASE_IMAGE='+baseimage,'-f',str(dockerfile),'-t',image,str(release/'ops')],stdout=subprocess.DEVNULL)
existing=subprocess.run(['docker','inspect',hubname],capture_output=True,text=True)
previoushub=None
if existing.returncode==0:
 existingdata=json.loads(existing.stdout)[0]
 if existingdata['Config']['Image']!=image:
  previoushub=hubname+'-previous-'+str(int(time.time()));run(['docker','stop',hubname],stdout=subprocess.DEVNULL);run(['docker','rename',hubname,previoushub])
 else:print('Profile client already at requested version',flush=True)
if existing.returncode!=0 or previoushub:
 networks=list(hub['NetworkSettings']['Networks'])
 try:
  run(['docker','create','--name',hubname,'--restart','unless-stopped','--network',networks[0],'-p','127.0.0.1:18914:8000','--memory','256m','--read-only','--tmpfs','/tmp','--cap-drop','ALL','--security-opt','no-new-privileges','--env-file',str(shared/'profile.env'),image],stdout=subprocess.DEVNULL)
  for net in networks[1:]:run(['docker','network','connect',net,hubname])
  run(['docker','start',hubname],stdout=subprocess.DEVNULL)
  for attempt in range(25):
   try:
    with urllib.request.urlopen('http://127.0.0.1:18914/healthz',timeout=3) as response:health=json.load(response)
    if health.get('revision')==revision:break
   except Exception:pass
   time.sleep(2)
  else:raise RuntimeError('New camp profile service failed to start')
 except Exception:
  subprocess.run(['docker','rm','-f',hubname],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if previoushub:run(['docker','rename',previoushub,hubname]);run(['docker','start',hubname],stdout=subprocess.DEVNULL)
  raise
print('Independent profile client configured',flush=True)
service=SLUG;unit=pathlib.Path('/etc/systemd/system')/(service+'.service')
if subprocess.run(['id','-u',service],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:run(['useradd','--system','--home',str(base),'--shell','/usr/sbin/nologin',service])
user=pwd.getpwnam(service);os.chown(shared,user.pw_uid,user.pw_gid)
data=shared/'data';data.mkdir(exist_ok=True,mode=0o700);os.chown(data,user.pw_uid,user.pw_gid)
run(['python3',str(release/'ops/camp-sso-provision.py')])
sso=envfile(shared/'tashan-sso.env');os.chown(shared/'tashan-sso.env',user.pw_uid,user.pw_gid)
runtime={**feishu,**ids,**sso,'CMS_ORGANIZATION_PATCH':'organizations-inline-20261031','CMS_THEME_PATCH':json.dumps({'id':'mineral-blue-c-20261031','banner':'/assets/assets/kiz-banner-ai-mineral-blue-c.png','color':'285E78'},separators=(',',':')),'CMS_TABLES':json.dumps(cmsids['tables'],separators=(',',':')),'NODE_ENV':'production','INTEGRATION_MODE':'tashan','DEPLOY_ENV':'production','PUBLIC_ORIGIN':'https://'+DOMAIN,'PORT':str(PORT),'FORUM_DATA_DIR':str(data),'AUTH_SERVICE_URL':'https://panshi-ai4s-new.tashan.ac.cn','FORUM_FEISHU_API_VERSION':old.get('FORUM_FEISHU_API_VERSION','v3'),'FORUM_OSS_BUCKET':storage['FILE_OSS_BUCKET'],'FORUM_OSS_REGION':storage['FILE_OSS_REGION'],'FORUM_OSS_PREFIX':prefix,'FORUM_OSS_ACCESS_KEY_ID':key['AccessKeyId'],'FORUM_OSS_ACCESS_KEY_SECRET':key['AccessKeySecret'],'PROFILE_HUB_URL':'http://127.0.0.1:18914/api/v1/profile-hub','PROFILE_HUB_ALLOW_LOOPBACK_HTTP':'1','PROFILE_HUB_CLIENT':SLUG,'PROFILE_HUB_SECRET':hubsecret}
# Reuse the original forum's authorized API generation and verify record reads before cutover.
run([str(node),str(release/'ops/camp-readiness.mjs')],env={**os.environ,**runtime})
saveenv(shared/'app.env',runtime);os.chown(shared/'app.env',user.pw_uid,user.pw_gid)
current=base/'current';previous=current.resolve() if current.is_symlink() else None
vhost=pathlib.Path('/www/server/panel/vhost/nginx')/(DOMAIN+'.conf');oldvhost=vhost.read_text() if vhost.exists() else None
oldunit=unit.read_text() if unit.exists() else None
run(['nginx','-t'],stdout=subprocess.DEVNULL)
try:
 if previous is None:
  with socket.socket() as sock:
   try:sock.bind(('127.0.0.1',PORT))
   except OSError:raise RuntimeError('Camp port already occupied')
 if current.is_symlink():current.unlink()
 current.symlink_to(release,target_is_directory=True)
 unittext=f'''[Unit]
Description=Kunming AI for Science 2026 registration
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User={service}
Group={service}
WorkingDirectory={current}
ExecStart={current}/node --env-file={shared}/app.env backend/forum-start.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={data}
MemoryMax=512M
[Install]
WantedBy=multi-user.target
'''
 atomic(unit,unittext,0o644);run(['systemctl','daemon-reload']);run(['systemctl','enable',service],stdout=subprocess.DEVNULL);run(['systemctl','restart',service])
 for attempt in range(30):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/healthz',timeout=3) as r:
    if r.status==200:break
  except Exception:pass
  time.sleep(2)
 else:
  log=output(['journalctl','-u',service,'-n','15','--no-pager'])
  for value in runtime.values():
   if len(value)>12:log=log.replace(value,'[REDACTED]')
  print(log);raise RuntimeError('Camp registration service failed to start')
 run([str(node),str(release/'ops/cms-status.mjs')],env={**os.environ,**runtime})
 webroot=base/'acme';(webroot/'.well-known/acme-challenge').mkdir(parents=True,exist_ok=True)
 for directory in [webroot,webroot/'.well-known',webroot/'.well-known/acme-challenge']:directory.chmod(0o755)
 http=f'''server {{
 listen 80;
 server_name {DOMAIN};
 location ^~ /.well-known/acme-challenge/ {{ root {webroot}; }}
 location / {{ return 301 https://{DOMAIN}$request_uri; }}
}}
'''
 cert=pathlib.Path('/etc/letsencrypt/live')/DOMAIN
 if not (cert/'fullchain.pem').exists():
  atomic(vhost,http,0o644);run(['nginx','-t']);run(['nginx','-s','reload'])
  # Use the server's existing ACME account. No new account or terms acceptance.
  accounts=list(pathlib.Path('/etc/letsencrypt/accounts/acme-v02.api.letsencrypt.org/directory').glob('*/regr.json'))
  if not accounts:raise RuntimeError('Existing certificate account unavailable')
  for attempt in range(24):
   try:
    if socket.gethostbyname(DOMAIN)=='8.147.58.40':break
   except OSError:pass
   time.sleep(5)
  else:raise RuntimeError('DNS propagation pending; rerun after DNS resolves')
  for certificate_attempt in range(3):
   issued=subprocess.run(['certbot','certonly','--webroot','-w',str(webroot),'-d',DOMAIN,'--non-interactive','--account',accounts[0].parent.name])
   if issued.returncode==0:break
   if certificate_attempt==2:raise RuntimeError('Certificate issuance failed after three attempts')
   print('Certificate request failed; retrying in 15 seconds',flush=True);time.sleep(15)
 https=f'''server {{
 listen 443 ssl;
 server_name {DOMAIN};
 ssl_certificate {cert}/fullchain.pem;
 ssl_certificate_key {cert}/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 client_max_body_size 30m;
 add_header X-Content-Type-Options nosniff always;
 add_header Referrer-Policy same-origin always;
 location / {{
  proxy_pass http://127.0.0.1:{PORT};
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_read_timeout 90s;
 }}
}}
'''
 atomic(vhost,http+https,0o644);run(['nginx','-t']);run(['nginx','-s','reload'])
 # Dedicated backups and renewal only; no changes to other site timers.
 units=pathlib.Path('/etc/systemd/system')
 atomic(units/(service+'-backup.service'),f'[Unit]\nDescription=Kunming camp daily backup\n[Service]\nType=oneshot\nUMask=0077\nExecStart=/usr/bin/python3 {current}/ops/camp-backup.py\n',0o644)
 atomic(units/(service+'-backup.timer'),'[Unit]\nDescription=Kunming camp daily backup schedule\n[Timer]\nOnCalendar=*-*-* 03:20:00\nPersistent=true\n[Install]\nWantedBy=timers.target\n',0o644)
 atomic(units/(service+'-tls.service'),f'[Unit]\nDescription=Renew Kunming camp HTTPS\n[Service]\nType=oneshot\nExecStart=/usr/bin/certbot renew --cert-name {DOMAIN} --quiet --deploy-hook "nginx -s reload"\n',0o644)
 atomic(units/(service+'-tls.timer'),'[Unit]\nDescription=Kunming camp HTTPS renewal schedule\n[Timer]\nOnCalendar=*-*-* 04,16:10:00\nRandomizedDelaySec=1800\nPersistent=true\n[Install]\nWantedBy=timers.target\n',0o644)
 run(['systemctl','daemon-reload'])
 run(['systemctl','enable','--now',service+'-backup.timer',service+'-tls.timer'],stdout=subprocess.DEVNULL)
 run(['systemctl','start',service+'-backup.service'])
 atomic(base/'accepted-revision',revision+'\n')
 print('Published https://'+DOMAIN,flush=True)
except Exception:
 if previous:
  if current.is_symlink():current.unlink()
  current.symlink_to(previous,target_is_directory=True)
  if oldunit:atomic(unit,oldunit,0o644)
  run(['systemctl','daemon-reload']);subprocess.run(['systemctl','restart',service])
 else:subprocess.run(['systemctl','stop',service])
 if oldvhost is not None:atomic(vhost,oldvhost,0o644)
 elif vhost.exists():vhost.unlink()
 if subprocess.run(['nginx','-t'],capture_output=True).returncode==0:subprocess.run(['nginx','-s','reload'])
 raise
