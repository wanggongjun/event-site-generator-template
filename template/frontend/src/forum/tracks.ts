import raw from '../site-content';
import type {Config} from '../types';
export const tracks=(raw as unknown as Config).tracks;
export const trackFor=(key:string)=>tracks.find(t=>t.key===key)||tracks[0];
