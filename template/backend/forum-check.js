import {createOssStorage} from './forum-oss.js';
import {ForumFeishu} from './forum-feishu.js';
import {verifyAuthService} from './auth-service.js';
import {profileHubConfig} from './profile-hub.js';
const keys=['DEPLOY_ENV','PUBLIC_ORIGIN','AUTH_SERVICE_URL','FEISHU_APP_ID','FEISHU_APP_SECRET','FORUM_FEISHU_BASE_TOKEN','FORUM_REGISTRATION_TABLE_ID','FORUM_SUBMISSION_TABLE_ID'];
if(process.env.INTEGRATION_MODE!=='independent')keys.push('PROFILE_HUB_URL','PROFILE_HUB_CLIENT','PROFILE_HUB_SECRET');
const missing=keys.filter(k=>!process.env[k]);
if(missing.length){console.log(JSON.stringify({ready:false,missing}));process.exitCode=1;}
else try{
 await createOssStorage(process.env).probe();await new ForumFeishu(process.env).check();await verifyAuthService(process.env.AUTH_SERVICE_URL);
 console.log(JSON.stringify({ready:true,storagePrivate:true,feishuReadable:true,authContract:true,profileHubConfigured:Boolean(profileHubConfig(process.env)),liveLoginAndReviewTested:false}));
}catch(e){console.log(JSON.stringify({ready:false,error:e.message}));process.exitCode=1;}
