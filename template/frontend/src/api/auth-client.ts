import {api} from '../api';
import config from '../config.generated.json';
import {confirmed,phonePreview} from '../forum/auth';
const forum=(config.event as {workflow?:string}).workflow==='forum';
export class AuthApiError extends Error {code:string;retryAfterSeconds?:number;constructor(code:string,message:string,status?:number,retry?:number,readonly details?:{registeredAt?:string}){super(message);this.code=code;this.status=status;this.retryAfterSeconds=retry}status?:number;}
export function normalizeAuthRetryAfterSeconds(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0?Math.min(900,Math.ceil(n)):60}
const shared=<T>(operation:Promise<T>):Promise<T>=>operation.catch((e:any)=>{throw new AuthApiError(e.code||'REQUEST_FAILED',e.message,e.status,normalizeAuthRetryAfterSeconds(e.retryAfterSeconds),e.details);});
export const checkStudentRegistration=(phone:string,code:string):Promise<{data:{registered:boolean;registeredAt?:string}}>=>forum?shared(api('/api/v1/auth/register/check',{phone,code})):Promise.resolve({data:{registered:false}});
export const loginStudent=(phone:string,password:string)=>forum?shared(confirmed('auth.login','/api/v1/auth/login',{phone,password},{...phonePreview(phone),clientKind:'web'})):api('/api/auth/login',{phone,password});
export const registerStudent=(phone:string,code:string,password:string)=>forum?shared(confirmed('auth.register','/api/v1/auth/register',{phone,code,password},phonePreview(phone))):api('/api/auth/register',{phone,code,password});
export const resetStudentPassword=(phone:string,code:string,password:string)=>forum?shared(confirmed('auth.password_reset','/api/v1/auth/password/reset',{phone,code,newPassword:password},phonePreview(phone))):api('/api/auth/reset',{phone,code,password});
export const sendVerificationCode=(phone:string,purpose:'register'|'reset_password'|'login')=>forum?shared(confirmed('auth.verification.send','/api/v1/auth/verification/send',{phone,purpose},{...phonePreview(phone),purpose})):api('/api/auth/sms/request',{phone,purpose:purpose==='reset_password'?'reset':purpose});

export const loginStudentWithCode=(phone:string,code:string)=>shared(confirmed('auth.otp_login','/api/v1/auth/otp/login',{phone,code},phonePreview(phone)));
