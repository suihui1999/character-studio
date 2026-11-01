import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readdir} from 'node:fs/promises';
test('bundled installed-style server exposes MCP App, saves upload and restores it',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'character-studio-mcp-'));
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('plugins/character-studio/dist/server.mjs')],env:{...process.env,CHARACTER_STUDIO_HOME:root}});
  const client=new Client({name:'studio-protocol-test',version:'1.0.0'});await client.connect(transport);
  try{
    const tools=await client.listTools();const open=tools.tools.find(t=>t.name==='open_workbench');assert.equal(open._meta.ui.resourceUri,'ui://character-studio/workbench.html');
    assert.deepEqual(tools.tools.find(t=>t.name==='claim_next_task')._meta.ui.visibility,['model']);
    const native=await client.callTool({name:'open_workbench',arguments:{executor:'agent'}});assert.ok(!native.isError);assert.equal(native.structuredContent.draft.provider,'agent');
    const resources=await client.readResource({uri:open._meta.ui.resourceUri});assert.equal(resources.contents[0].mimeType,'text/html;profile=mcp-app');assert.match(resources.contents[0].text,/CHARACTER/);
    const upload=await client.callTool({name:'upload_character',arguments:{name:'test-character.png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='}});
    assert.ok(!upload.isError,JSON.stringify(upload));const saved=await client.callTool({name:'get_state',arguments:{}});assert.equal(saved.structuredContent.draft.portraitId,upload.structuredContent.id);
  }finally{await client.close();}
});

test('portable agent package configures and serves MCP from a destination path containing spaces and Chinese',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-接入包 '));
  const run=promisify(execFile);
  await run(process.execPath,['scripts/package-agent.mjs',root]);
  await run(process.execPath,[path.join(root,'configure.mjs')]);
  const config=JSON.parse(await readFile(path.join(root,'mcp-stdio.json'),'utf8')).mcpServers['character-studio'];
  assert.equal(config.command,process.execPath);assert.equal(config.args[0],path.join(root,'dist','server.mjs'));
  const files=await readdir(root);assert.ok(!files.includes('state.json'));assert.ok(!files.includes('provider-credentials.json'));
  const data=await mkdtemp(path.join(os.tmpdir(),'studio-portable-data-'));
  const transport=new StdioClientTransport({...config,env:{...process.env,CHARACTER_STUDIO_HOME:data}});
  const client=new Client({name:'portable-host-test',version:'1'});await client.connect(transport);
  try{
    const opened=await client.callTool({name:'open_workbench',arguments:{executor:'agent'}});assert.ok(!opened.isError,JSON.stringify(opened));assert.equal(opened.structuredContent.draft.provider,'agent');
    const ui=await client.readResource({uri:'ui://character-studio/workbench.html'});assert.match(ui.contents[0].mimeType,/mcp-app/);
  }finally{await client.close();}
});
