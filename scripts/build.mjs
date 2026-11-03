import {build} from 'esbuild';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const out='plugins/character-studio/dist';await mkdir(out,{recursive:true});
const rhGuide=await readFile('src/runninghub-key-guide.webp');
const hash=createHash('sha256').update(rhGuide);for(const name of (await readdir('src')).filter(f=>/\.(mjs|html)$/.test(f)).sort())hash.update(await readFile('src/'+name));
const version=JSON.parse(await readFile('package.json','utf8')).version,buildId=hash.digest('hex').slice(0,20);
const define={__STUDIO_VERSION__:JSON.stringify(version),__STUDIO_BUILD__:JSON.stringify(buildId)};
const server=await build({entryPoints:['src/server.mjs'],outfile:out+'/server.mjs',bundle:true,platform:'node',format:'esm',target:'node22',metafile:true,define,banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}});
const cli=await build({entryPoints:['src/cli.mjs'],outfile:out+'/cli.mjs',bundle:true,platform:'node',format:'esm',target:'node22',metafile:true,define});
const ui=await build({entryPoints:['src/ui.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,minify:true,metafile:true});
let html=await readFile('src/workbench.html','utf8');html=html.replace('<!--RH_KEY_GUIDE-->',()=> 'data:image/webp;base64,'+rhGuide.toString('base64'));html=html.replace('<!--APP_SCRIPT-->',()=>'<script>'+ui.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>');
await writeFile(out+'/workbench.html',html);console.log('Built portable MCP server and self-contained workbench.');
const packages=new Map();
for(const input of [...Object.keys(server.metafile.inputs),...Object.keys(cli.metafile.inputs),...Object.keys(ui.metafile.inputs)]){
  if(!input.replaceAll('\\','/').includes('node_modules/'))continue;
  let dir=path.dirname(path.resolve(input));
  while(dir!==path.dirname(dir)&&dir.includes('node_modules')){
    try{const meta=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));if(meta.name){packages.set(dir,meta);break;}}catch{}
    dir=path.dirname(dir);
  }
}
const notices=[];
for(const [dir,meta]of packages){let license='';for(const f of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','COPYING']){try{license=await readFile(path.join(dir,f),'utf8');break;}catch{}}
  notices.push('## '+meta.name+' '+meta.version+'\nLicense: '+JSON.stringify(meta.license||'see package')+'\n\n'+(license||'No standalone license file included; consult the upstream package distribution.'));
}
await writeFile(out+'/THIRD_PARTY_LICENSES.txt',notices.join('\n\n----------------\n\n'));
for(const f of ['LICENSE','NOTICE.md'])await writeFile('plugins/character-studio/'+f,await readFile(f));
await writeFile('plugins/character-studio/skills/character-studio/SKILL.md',await readFile('integrations/agent/skills/character-studio/SKILL.md'));
console.log('Included notices for '+packages.size+' bundled packages.');
