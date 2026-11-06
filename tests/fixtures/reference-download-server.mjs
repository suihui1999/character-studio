import {createStudio,serveHttp} from '../../plugins/character-studio/dist/server.mjs';
import {PNG} from './fake-image-api.mjs';
const studio=await createStudio(process.env.CHARACTER_STUDIO_HOME,{catalogDownloadOptions:{fetchImpl:async()=>new Response(PNG)},clientFactory:()=>{throw Error('Isolated download fixture has no native executor');}});
await serveHttp(studio,43131);console.log('Reference download fixture ready');
