import pathlib
api=pathlib.Path('/app/app/api/profile_hub.py')
svc=pathlib.Path('/app/app/services/profile_hub_service.py')
if not api.exists():
 import importlib.util
 api=pathlib.Path(importlib.util.find_spec('app.api.profile_hub').origin)
 svc=pathlib.Path(importlib.util.find_spec('app.services.profile_hub_service').origin)
text=api.read_text();old="CLIENTS = {'panshi-forum', 'panshi-camp'}"
assert old in text,'Unexpected profile API version'
api.write_text(text.replace(old,"CLIENTS = {'kiz-ai-camp-2026'}"))
text=svc.read_text();old="{'panshi-forum': 'PROFILE_HUB_FORUM_SECRET', 'panshi-camp': 'PROFILE_HUB_CAMP_SECRET'}"
assert old in text,'Unexpected profile secret mapping'
text=text.replace(old,"{'kiz-ai-camp-2026': 'PROFILE_HUB_KIZ_SECRET'}")
text=text.replace("'panshi-camp', 'panshi-forum')","'panshi-camp', 'panshi-forum', 'kiz-ai-camp-2026')")
text=text.replace("'panshi-camp', 'panshi-forum'])}","'panshi-camp', 'panshi-forum', 'kiz-ai-camp-2026'])}")
svc.write_text(text)
