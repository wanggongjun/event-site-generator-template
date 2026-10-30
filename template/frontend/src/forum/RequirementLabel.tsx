export function RequirementLabel({ label, required }: { label: string, required: boolean }) {
  return <span className="requirement-label"><span>{label}</span>{' '}<small className={required ? undefined : 'is-optional'}>{required ? '必填' : '选填'}</small></span>
}
