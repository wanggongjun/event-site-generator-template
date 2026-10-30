import { useEffect, useId, useMemo, useState } from 'react'
import { REGISTRATION_IDENTITY_OPTIONS, type InstitutionDirectoryResponse, type RegistrationCoreFieldKey } from './contracts'
import { RequirementLabel } from './RequirementLabel'

export type CoreFieldValues = Partial<Record<RegistrationCoreFieldKey, string>>
type Directory = InstitutionDirectoryResponse['data']

const normalize = (value: string) => value.toLocaleLowerCase('zh-CN').replace(/\s+/gu, '')

function SearchableSelect({ id, label, value, options, required, disabled, placeholder, onChange, extraOption }: {
  id: string; label: string; value: string; options: readonly string[]; required?: boolean; disabled?: boolean; placeholder?: string
  onChange: (value: string) => void; extraOption?: { label: string, onSelect: () => void }
}) {
  const generatedId = useId()
  const listId = `${id}-${generatedId.replace(/:/gu, '')}-listbox`
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  useEffect(() => { if (value !== '' || !open) setQuery(value) }, [open, value])
  const matches = useMemo(() => {
    const rawNeedle = normalize(query)
    const needle = rawNeedle === '国科大' ? '中国科学院大学' : rawNeedle
    return options.filter((option) => needle === '' || normalize(option).includes(needle))
  }, [options, query])
  const optionCount = matches.length + (extraOption ? 1 : 0)
  const select = (selected: string) => { setQuery(selected); setOpen(false); onChange(selected) }
  return <div className="searchable-select">
    <input
      id={id}
      role="combobox"
      aria-label={label}
      aria-autocomplete="list"
      aria-controls={listId}
      aria-expanded={open}
      aria-activedescendant={open && optionCount > 0 ? `${listId}-option-${activeIndex}` : undefined}
      autoComplete="off"
      disabled={disabled}
      required={required}
      placeholder={placeholder}
      value={query}
      onFocus={() => { setOpen(true); setActiveIndex(0) }}
      onBlur={() => window.setTimeout(() => setOpen(false), 0)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); onChange('') }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); return }
        if (event.key === 'ArrowDown' && optionCount > 0) { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(current + 1, optionCount - 1)); return }
        if (event.key === 'ArrowUp' && optionCount > 0) { event.preventDefault(); setActiveIndex((current) => Math.max(current - 1, 0)); return }
        if (event.key === 'Enter' && open && optionCount > 0) {
          event.preventDefault()
          if (activeIndex < matches.length) select(matches[activeIndex]!)
          else extraOption?.onSelect()
        }
      }}
    />
    <small className="searchable-select__help">请输入关键词，并从下方候选列表中点击选择。</small>
    {value ? <small className="searchable-select__selected" role="status">已选择：{value}</small> : null}
    {open ? <ul id={listId} role="listbox" className="searchable-select__options">
      {matches.map((option, index) => <li
        id={`${listId}-option-${index}`}
        role="option"
        aria-selected={option === value}
        className={index === activeIndex ? 'is-active' : undefined}
        key={option}
        onMouseDown={(event) => { event.preventDefault(); select(option) }}
      >{option}</li>)}
      {extraOption ? <li
        id={`${listId}-option-${matches.length}`}
        role="option"
        aria-selected={false}
        className={matches.length === activeIndex ? 'is-active' : undefined}
        onMouseDown={(event) => { event.preventDefault(); setQuery(''); setOpen(false); extraOption.onSelect() }}
      >{extraOption.label}</li> : null}
      {matches.length === 0 && !extraOption ? <li className="searchable-select__empty">未找到匹配项</li> : null}
    </ul> : null}
  </div>
}

export function CoreFields({ values, phone, directory, onChange, onMajorChange, editableKeys, errors = {} }: {
  values: CoreFieldValues
  phone: string
  directory: Directory
  onChange: (key: RegistrationCoreFieldKey, value: string) => void
  onMajorChange?: (code: string, name: string) => void
  editableKeys?: ReadonlySet<string>
  errors?: Record<string, string>
}) {
  const universityNames = useMemo(() => directory.universities.map(({ name }) => name), [directory.universities])
  const universitySet = useMemo(() => new Set(universityNames), [universityNames])
  const unitNames = useMemo(() => directory.ucasTrainingUnits.map(({ name }) => name), [directory.ucasTrainingUnits])
  const unitSet = useMemo(() => new Set(unitNames), [unitNames])
  const organization = values.organization ?? ''
  const identity = values.identityType ?? ''
  const isUndergraduate = identity === '本科生'
  const isGraduate = identity === '硕士研究生' || identity === '博士研究生'
  const isStudent = isUndergraduate || isGraduate
  const [customOrganization, setCustomOrganization] = useState(organization !== '' && !universitySet.has(organization))
  const [customDepartment, setCustomDepartment] = useState((values.department ?? '') !== '' && !unitSet.has(values.department ?? ''))
  useEffect(() => {
    setCustomOrganization(organization !== '' && !universitySet.has(organization))
    setCustomDepartment(false)
  }, [identity])
  useEffect(() => { if (organization !== '' && !universitySet.has(organization)) setCustomOrganization(true) }, [organization, universitySet])
  useEffect(() => {
    const department = values.department ?? ''
    if (organization !== '中国科学院大学' || department === '' || unitSet.has(department)) setCustomDepartment(false)
    else if (department !== '本科部') setCustomDepartment(true)
  }, [organization, unitSet, values.department])
  const disabled = (key: RegistrationCoreFieldKey) => editableKeys !== undefined && !editableKeys.has(key)
  const error = (key: RegistrationCoreFieldKey) => errors[`profile.${key}`]
  const input = (key: RegistrationCoreFieldKey, label: string, required = true, placeholder?: string) => <label htmlFor={`core-${key}`}>
    <RequirementLabel label={label} required={required}/>
    <input id={`core-${key}`} aria-label={label} required={required} disabled={disabled(key)} placeholder={placeholder} value={values[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} />
    {error(key) ? <em role="alert">{error(key)}</em> : null}
  </label>
  const textarea = (key: RegistrationCoreFieldKey, label: string, required = true, placeholder?: string) => <label htmlFor={`core-${key}`}>
    <RequirementLabel label={label} required={required}/>
    <textarea id={`core-${key}`} aria-label={label} required={required} disabled={disabled(key)} rows={3} placeholder={placeholder} value={values[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} />
    {error(key) ? <em role="alert">{error(key)}</em> : null}
  </label>
  const academicPrograms = isUndergraduate ? directory.undergraduateMajors : directory.graduatePrograms
  const academicProgramOptions = academicPrograms.map(({ code, name }) => `${code} ${name}`)
  const selectedAcademicProgram = values.majorCode && values.major ? `${values.majorCode} ${values.major}` : values.major ?? ''
  const academicProgramField = (label: string) => <label htmlFor="core-major">
    <RequirementLabel label={label} required/>
    <SearchableSelect
      id="core-major"
      label={label}
      value={selectedAcademicProgram}
      options={academicProgramOptions}
      required
      disabled={disabled('majorCode') || disabled('major')}
      placeholder="输入专业代码或名称检索"
      onChange={(selected) => {
        const program = academicPrograms.find(({ code, name }) => `${code} ${name}` === selected)
        if (onMajorChange) onMajorChange(program?.code ?? '', program?.name ?? '')
        else {
          onChange('majorCode', program?.code ?? '')
          onChange('major', program?.name ?? '')
        }
      }}
    />
    {values.major && !values.majorCode ? <small className="account-hint">已带入专业名称，请从名录选择对应专业。</small> : null}
    {error('majorCode') || error('major') ? <em role="alert">{error('majorCode') ?? error('major')}</em> : null}
  </label>

  return <fieldset className="registration-core-fields">
    <legend>基本信息</legend>
    <label htmlFor="core-name"><RequirementLabel label="姓名" required/><input id="core-name" aria-label="姓名" required disabled={disabled('name')} value={values.name ?? ''} onChange={(event) => onChange('name', event.target.value)} />{error('name') ? <em role="alert">{error('name')}</em> : null}</label>
    <label htmlFor="core-phone"><RequirementLabel label="手机号" required/><span className="phone-field"><span className="phone-field__prefix" aria-hidden="true">+86</span><input id="core-phone" aria-label="手机号" required readOnly value={phone.replace(/^\+86/u, '')} /></span></label>
    <label htmlFor="core-email"><RequirementLabel label="电子邮箱" required/><input id="core-email" aria-label="电子邮箱" type="email" required disabled={disabled('email')} value={values.email ?? ''} onChange={(event) => onChange('email', event.target.value)} />{error('email') ? <em role="alert">{error('email')}</em> : null}</label>
    <label htmlFor="core-identityType"><RequirementLabel label="当前身份" required/><select id="core-identityType" aria-label="当前身份" required disabled={disabled('identityType')} value={identity} onChange={(event) => onChange('identityType', event.target.value)}><option value="">请选择</option>{REGISTRATION_IDENTITY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select>{error('identityType') ? <em role="alert">{error('identityType')}</em> : null}</label>

    {isStudent ?
      <label htmlFor="core-organization"><RequirementLabel label="所在学校" required/>
        {customOrganization ? <>
          <input id="core-organization" aria-label="所在学校" required disabled={disabled('organization')} placeholder="请填写学校全称" value={organization} onChange={(event) => onChange('organization', event.target.value)} />
          <button className="field-inline-action" type="button" disabled={disabled('organization')} onClick={() => { setCustomOrganization(false); onChange('organization', '') }}>返回高校名录</button>
        </> : <SearchableSelect id="core-organization" label="所在学校" value={organization} options={universityNames} required disabled={disabled('organization')} placeholder="输入学校名称检索" onChange={(value) => onChange('organization', value)} extraOption={{ label: '其他学校（手动填写）', onSelect: () => { setCustomOrganization(true); onChange('organization', '') } }} />}
        {error('organization') ? <em role="alert">{error('organization')}</em> : null}
      </label> : null}

    {isUndergraduate ? <>
      {input('department', '院系')}
      {academicProgramField('专业')}
      {textarea('researchInterest', '研究兴趣', false)}
    </> : null}

    {isGraduate ? <>
      <label htmlFor="core-department"><RequirementLabel label="培养单位" required/>
        {organization === '中国科学院大学' && !customDepartment
          ? <SearchableSelect id="core-department" label="培养单位" value={values.department ?? ''} options={unitNames} required disabled={disabled('department')} placeholder="输入学院或研究所名称检索" onChange={(value) => onChange('department', value)} extraOption={{ label: '手动填写培养单位', onSelect: () => { setCustomDepartment(true); onChange('department', '') } }} />
          : <>
            <input id="core-department" aria-label="培养单位" required disabled={disabled('department')} value={values.department ?? ''} onChange={(event) => onChange('department', event.target.value)} />
            {organization === '中国科学院大学' && customDepartment ? <button className="field-inline-action" type="button" disabled={disabled('department')} onClick={() => { setCustomDepartment(false); onChange('department', '') }}>返回培养单位名录</button> : null}
          </>}
        {error('department') ? <em role="alert">{error('department')}</em> : null}
      </label>
      {academicProgramField('学科专业')}
      {textarea('researchDirection', '研究方向')}
    </> : null}

    {identity === '在站博士后' ? <>
      {input('organization', '单位')}
      {textarea('researchDirection', '研究方向')}
    </> : null}

    {identity === '在职人员' ? <>
      {input('organization', '单位')}
      {input('jobPosition', '职务／职称')}
    </> : null}

    {identity === '其他' ? <>
      {textarea('identityDescription', '身份说明')}
      {input('organization', '单位', false)}
    </> : null}
  </fieldset>
}
