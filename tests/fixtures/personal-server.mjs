// Browser acceptance harness: isolated data and protocol-only RunningHub fixture.
import {createStudio,serveHttp} from '../../plugins/character-studio/dist/server.mjs';
import {CodexClient} from '../../src/codex-executor.mjs';
import {fakeRunningHub} from './fake-runninghub.mjs';
import path from 'node:path';
const remote=await fakeRunningHub({accountDelayMs:250});
const studio=await createStudio(process.env.CHARACTER_STUDIO_HOME,{runninghubOptions:{origins:remote.origins,pollMs:10,timeoutMs:1000},clientFactory:()=>new CodexClient({launch:()=>({command:process.execPath,args:[path.resolve('tests/fixtures/fake-codex.js'),'success']})})});
await serveHttp(studio,43130);console.log('Isolated personal provider browser harness ready.');
