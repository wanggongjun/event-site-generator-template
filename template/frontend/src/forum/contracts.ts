export const REGISTRATION_IDENTITY_OPTIONS=['本科生','硕士研究生','博士研究生','在站博士后','在职人员','其他'] as const;
export const FLASH_TYPE_OPTIONS=['Skill 分享','工具或应用展示','AI 实践经验分享','其他'] as const;
export const REGISTRATION_PARTICIPATION_QUESTION_ID='unused-for-forum';
export type RegistrationCoreFieldKey='name'|'email'|'identityType'|'organization'|'department'|'majorCode'|'major'|'researchInterest'|'researchDirection'|'jobPosition'|'identityDescription';
export type InstitutionDirectoryResponse={data:{universities:{name:string}[];ucasTrainingUnits:{name:string}[];undergraduateMajors:{name:string;code:string}[];graduatePrograms:{name:string;code:string}[]}};
export type ProficiencyMatrixAnswer={ratings:Record<string,string>;otherLabel:string;otherLevel:string};
export type RegistrationDynamicQuestion={id:string;label:string;helpText:string;required:boolean;type:string;validation:{minLength?:number;maxLength?:number;maxSelections?:number};items:{id:string;value:string;label:string}[];levels:{id:string;value:string;label:string}[];allowOther?:boolean;options?:{id:string;value:string;label:string;description?:string;disabled?:boolean}[]};
