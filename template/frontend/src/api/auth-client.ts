import {api} from '../api';
export class AuthApiError extends Error {code:string;retryAfterSeconds?:number;constructor(code:string,message:string){super(message);this.code=code}}
export function normalizeAuthRetryAfterSeconds(value:unknown){return typeof value==='number'&&value>0?value:60}
export const loginStudent=(phone:string,password:string)=>api('/api/auth/login',{phone,password});
export const registerStudent=(phone:string,code:string,password:string)=>api('/api/auth/register',{phone,code,password});
export const resetStudentPassword=(phone:string,code:string,password:string)=>api('/api/auth/reset',{phone,code,password});
export const sendVerificationCode=(phone:string,purpose:'register'|'reset_password')=>api('/api/auth/sms/request',{phone,purpose:purpose==='reset_password'?'reset':purpose});
