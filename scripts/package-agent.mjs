import {mkdir,copyFile,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(process.argv[2]||path.join(root,'.local','distribution','character-studio-agent'));
await mkdir(path.join(out,'dist'),{recursive:true});
await mkdir(path.join(out,'skills','character-studio'),{recursive:true});
for(const file of ['server.mjs','cli.mjs','workbench.html','THIRD_PARTY_LICENSES.txt'])await copyFile(path.join(root,'plugins','character-studio','dist',file),path.join(out,'dist',file));
await copyFile(path.join(root,'integrations','agent','configure.mjs'),path.join(out,'configure.mjs'));
await copyFile(path.join(root,'integrations','agent','接入说明.md'),path.join(out,'AGENT_SETUP.md'));
await copyFile(path.join(root,'integrations','agent','skills','character-studio','SKILL.md'),path.join(out,'skills','character-studio','SKILL.md'));
for(const file of ['LICENSE','NOTICE.md'])await copyFile(path.join(root,file),path.join(out,file));
for(const name of ['INSTALL.md','INSTALL.en.md','README.md','README.en.md'])await copyFile(path.join(root,name),path.join(out,name));
await copyFile(path.join(root,'scripts','install.ps1'),path.join(out,'install.ps1'));
await writeFile(path.join(out,'character-studio.cmd'),'@echo off\r\nif "%~1"=="" (\r\n  "%~dp0runtime\\node.exe" "%~dp0dist\\cli.mjs" open --executor keep\r\n) else (\r\n  "%~dp0runtime\\node.exe" "%~dp0dist\\cli.mjs" %*\r\n)\r\n');
const launcher=process.argv.indexOf('--launcher');
if(launcher!==-1)await copyFile(path.resolve(process.argv[launcher+1]),path.join(out,'Character Studio.exe'));
const runtimeIndex=process.argv.indexOf('--runtime-dir');
if(runtimeIndex!==-1){const runtime=path.resolve(process.argv[runtimeIndex+1]);await mkdir(path.join(out,'runtime'),{recursive:true});for(const file of ['node.exe','LICENSE'])await copyFile(path.join(runtime,file),path.join(out,'runtime',file));}
const files={};
for(const dir of ['dist','skills/character-studio',...(runtimeIndex!==-1?['runtime']:[])])for(const name of await readdir(path.join(out,dir))){const rel=dir+'/'+name;files[rel]=createHash('sha256').update(await readFile(path.join(out,rel))).digest('hex');}
for(const name of ['character-studio.cmd','install.ps1','INSTALL.md','INSTALL.en.md','README.md','README.en.md','LICENSE','NOTICE.md','AGENT_SETUP.md',...(launcher!==-1?['Character Studio.exe']:[])])files[name]=createHash('sha256').update(await readFile(path.join(out,name))).digest('hex');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
await writeFile(path.join(out,'manifest.json'),JSON.stringify({name:'character-studio',version:pkg.version,platform:runtimeIndex!==-1?'windows-x64':'developer',runtimeIncluded:runtimeIndex!==-1,files},null,2));
console.log('Agent 接入包：'+out);
