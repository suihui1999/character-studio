import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
const run=promisify(execFile),install=path.resolve('scripts/install.ps1'),zipScript=path.resolve('tests/fixtures/zip-package.ps1');
const ps=(file,args)=>run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file,...args],{timeout:30000});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function makePackage(){
  const root=await mkdtemp(path.join(os.tmpdir(),'studio-install 中文 ')),source=path.join(root,'source');await mkdir(source);
  const files={};
  for(const name of ['runtime/node.exe','runtime/LICENSE','dist/server.mjs','dist/cli.mjs','dist/workbench.html','skills/character-studio/SKILL.md']){
    // Non-executable tiny fixture: the installer is run with -NoOpen.
    const bytes=Buffer.from('installer integrity fixture: '+name);await mkdir(path.dirname(path.join(source,name)),{recursive:true});await writeFile(path.join(source,name),bytes);files[name]=hash(bytes);
  }
  await writeFile(path.join(source,'manifest.json'),JSON.stringify({name:'character-studio',version:'test-0.3.0',platform:'windows-x64',runtimeIncluded:true,files}));
  const zip=path.join(root,'package.zip');await ps(zipScript,['-Source',source,'-Zip',zip]);await writeFile(zip+'.sha256',hash(await readFile(zip))+'  package.zip');
  return {root,source,zip,destination:path.join(root,'安装 目录')};
}
test('Windows installer handles Chinese paths, repeat install, and preserves the previous version on corrupted input',{skip:process.platform!=='win32'},async()=>{
  const f=await makePackage(),args=['-PackagePath',f.zip,'-InstallRoot',f.destination,'-NoOpen'];
  await ps(install,args);const pointerFile=path.join(f.destination,'current.json'),first=JSON.parse(await readFile(pointerFile,'utf8'));
  // .NET expands RUNNER~1 to runneradmin on hosted Windows. Compare the real
  // directories, not a textual prefix that treats the same path as different.
  const relative=path.relative(await realpath(f.destination),await realpath(first.path));assert.ok(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
  await ps(install,args);assert.equal(JSON.parse(await readFile(pointerFile,'utf8')).path,first.path);
  await writeFile(f.zip+'.sha256','0'.repeat(64));await assert.rejects(ps(install,args),/checksum mismatch/);assert.equal(JSON.parse(await readFile(pointerFile,'utf8')).path,first.path);
  await writeFile(f.zip+'.sha256',hash(await readFile(f.zip)));await writeFile(path.join(first.path,'dist/cli.mjs'),'damaged installed file');
  await ps(install,args);const repaired=JSON.parse(await readFile(pointerFile,'utf8'));assert.notEqual(repaired.path,first.path);assert.match(await readFile(path.join(repaired.path,'dist/cli.mjs'),'utf8'),/integrity fixture/);
});
test('Windows installer rejects an archive path escape without writing outside staging',{skip:process.platform!=='win32'},async()=>{
  const f=await makePackage(),bad=path.join(f.root,'escape.zip');await ps(zipScript,['-Zip',bad,'-Traversal']);await writeFile(bad+'.sha256',hash(await readFile(bad)));
  await assert.rejects(ps(install,['-PackagePath',bad,'-InstallRoot',f.destination,'-NoOpen']),/Unsafe path/);
  await assert.rejects(readFile(path.join(f.destination,'staging','outside.txt')),{code:'ENOENT'});
});
