import {access,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Run after unpacking: resolve paths on the destination computer, not the author's.
const root=path.dirname(fileURLToPath(import.meta.url));
const server=path.join(root,'dist','server.mjs');
await access(server);
const config={mcpServers:{'character-studio':{command:process.execPath,args:[server]}}};
try{
  await writeFile(path.join(root,'mcp-stdio.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
}catch(error){
  if(error.code!=='EEXIST')throw error;
  console.log('mcp-stdio.json 已存在，已保留。以下是当前目录的启动配置：');
}
console.log(JSON.stringify(config,null,2));
