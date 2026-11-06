// Browser acceptance harness: isolated data and protocol-only image API fixture.
import {createStudio,serveHttp} from '../../plugins/character-studio/dist/server.mjs';
import {CodexClient} from '../../src/codex-executor.mjs';
import {fakeImageApi} from './fake-image-api.mjs';
import path from 'node:path';
const remote=await fakeImageApi({delayMs:100});
const studio=await createStudio(process.env.CHARACTER_STUDIO_HOME,{credentialOptions:{env:{}},imageApiOptions:{origins:remote.origins,timeoutMs:3000},clientFactory:()=>new CodexClient({launch:()=>({command:process.execPath,args:[path.resolve('tests/fixtures/fake-codex.js'),'success']})})});
await serveHttp(studio,43130);console.log('Isolated personal provider browser harness ready.');
