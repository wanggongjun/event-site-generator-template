import pathlib,importlib.util
# The base image contains more than one source tree. Patch the modules Python
# actually imports from its configured working directory, not a guessed copy.
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

def replace_once(source, old, new):
 assert source.count(old)==1, 'Unexpected profile service structure'
 return source.replace(old,new,1)

# Add a camp-specific column without changing the central account's identities.
text=replace_once(text,
 "PROFILE_FIELDS = ('real_name', 'organization', 'major', 'research_direction', 'email', 'department')",
 "PROFILE_FIELDS = ('real_name', 'organization', 'major', 'research_direction', 'email', 'department', 'kiz_personnel_category')")
text=replace_once(text,"    'department': '院系／部门',", "    'department': '院系／部门',\n    'kiz_personnel_category': '昆明实训营人员类别',")
text=replace_once(text,"'email': 180, 'department': 300}","'email': 180, 'department': 300, 'kiz_personnel_category': 80}")
text=replace_once(text,
 "    columns = {c['name'] for c in inspect(session.connection()).get_columns('profile_hub_external_profiles')}",
 """    for table in ('user_profiles', 'profile_hub_external_profiles'):
        columns = {c['name'] for c in inspect(session.connection()).get_columns(table)}
        if 'kiz_personnel_category' not in columns:
            session.execute(text(f'ALTER TABLE {table} ADD COLUMN kiz_personnel_category TEXT'))
    columns = {c['name'] for c in inspect(session.connection()).get_columns('profile_hub_external_profiles')}""")
text=replace_once(text,"up.email, up.department FROM users u", "up.email, up.department, up.kiz_personnel_category FROM users u")

# Validate the dedicated field even when called outside the camp's form.
text=replace_once(text,
 "    changes = _clean_changes(body['changes']) if body.get('changes') else {}",
 """    changes = _clean_changes(body['changes']) if body.get('changes') else {}
    category = changes.get('kiz_personnel_category')
    if category is not None and category not in (
        '所内学生（本科生/硕士/博士）', '所内在职人员（科研/行政/支撑）',
        '所外学生（本科生/硕士/博士）', '所外在职人员（科研/企业/行政）',
    ):
        raise HTTPException(422, '昆明实训营人员类别无效')""")
svc.write_text(text)

# The original startup guard runs before additive migrations. Exclude only the
# new column from that guard so apply_schema can create it under the existing lock.
startup=pathlib.Path(importlib.util.find_spec('profile_hub_production').origin)
source=startup.read_text()
source=replace_once(source,
 'set(profile_hub_service.PROFILE_FIELDS).issubset(columns)',
 "(set(profile_hub_service.PROFILE_FIELDS) - {'kiz_personnel_category'}).issubset(columns)")
startup.write_text(source)
for source in [api,svc,startup]:
 compile(source.read_text(),str(source),'exec')
 pathlib.Path(importlib.util.cache_from_source(str(source))).unlink(missing_ok=True)
