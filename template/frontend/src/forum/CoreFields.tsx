import {REGISTRATION_IDENTITY_OPTIONS, REGISTRATION_STUDENT_IDENTITIES, type InstitutionDirectoryResponse, type RegistrationCoreFieldKey} from './contracts';
import {RequirementLabel} from './RequirementLabel';

export type CoreFieldValues = Partial<Record<RegistrationCoreFieldKey, string>>;

export function CoreFields({values, phone, onChange, editableKeys, errors = {}}: {
  values: CoreFieldValues;
  phone: string;
  directory: InstitutionDirectoryResponse['data'];
  onChange: (key: RegistrationCoreFieldKey, value: string) => void;
  onMajorChange?: (code: string, name: string) => void;
  editableKeys?: ReadonlySet<string>;
  errors?: Record<string, string>;
}) {
  const identity = values.identityType ?? '';
  const selected = REGISTRATION_IDENTITY_OPTIONS.includes(identity);
  const student = REGISTRATION_STUDENT_IDENTITIES.has(identity);
  const disabled = (key: RegistrationCoreFieldKey) => editableKeys !== undefined && !editableKeys.has(key);
  const error = (key: RegistrationCoreFieldKey) => errors['profile.' + key];
  const input = (key: RegistrationCoreFieldKey, label: string, required = true, area = false) => <label htmlFor={'core-' + key}>
    <RequirementLabel label={label} required={required}/>
    {area ? <textarea id={'core-' + key} aria-label={label} required={required} disabled={disabled(key)} rows={3} maxLength={2000} value={values[key] ?? ''} onChange={event => onChange(key, event.target.value)}/>
      : <input id={'core-' + key} aria-label={label} type={key === 'email' ? 'email' : 'text'} required={required} disabled={disabled(key)} maxLength={300} value={values[key] ?? ''} onChange={event => onChange(key, event.target.value)}/>}
    {error(key) && <em role="alert">{error(key)}</em>}
  </label>;

  return <fieldset className="registration-core-fields">
    <legend>基本信息</legend>
    {input('name', '姓名')}
    <label htmlFor="core-phone"><RequirementLabel label="手机号" required/><span className="phone-field"><span className="phone-field__prefix" aria-hidden="true">+86</span><input id="core-phone" aria-label="手机号" required readOnly value={phone.replace(/^\+86/u, '')}/></span></label>
    {input('email', '电子邮箱')}
    <label htmlFor="core-identityType">
      <RequirementLabel label="人员类别" required/>
      <select id="core-identityType" aria-label="人员类别" required disabled={disabled('identityType')} value={selected ? identity : ''} onChange={event => onChange('identityType', event.target.value)}>
        <option value="">请选择</option>
        {REGISTRATION_IDENTITY_OPTIONS.map(option => <option key={option}>{option}</option>)}
      </select>
      {identity && !selected && <small className="account-hint">请选择本次实训营的人员类别。</small>}
      {error('identityType') && <em role="alert">{error('identityType')}</em>}
    </label>
    {input('organization', student ? '学校／单位' : '单位')}
    {selected && student && <>
      {input('department', '院系／培养单位')}
      {input('major', '专业')}
      {input('researchDirection', '研究方向', false, true)}
      {input('researchInterest', '研究兴趣', false, true)}
    </>}
    {selected && !student && input('jobPosition', '职务／职称')}
  </fieldset>;
}
