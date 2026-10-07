// Compatibility entry: use the generated instance renderer as the sole implementation.
import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
const app=resolve(process.argv[2]||'generated/aurora-research-forum-2027');
process.argv[2]=app;await import(pathToFileURL(join(app,'tools/render-preview.mjs')));
