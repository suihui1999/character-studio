"""Exercise the exact release ZIP and single-file EXE with isolated Chinese data paths."""
from pathlib import Path
import os,subprocess,tempfile,zipfile,json,urllib.request,time
ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/'.local/distribution'
base=Path(tempfile.mkdtemp(prefix='Character Studio 中文 启动 '))
portable=base/'解压 后的工作台';portable.mkdir()
with zipfile.ZipFile(DIST/'character-studio-windows-x64.zip') as archive:
    assert 'Character Studio.exe' in archive.namelist()
    archive.extractall(portable)
for mode,exe in [('portable',portable/'Character Studio.exe'),('single',DIST/'Character-Studio-Windows-x64.exe')]:
    home=base/(mode+' 用户数据');install=base/(mode+' 安装目录')
    env={**os.environ,'CHARACTER_STUDIO_HOME':str(home),'CHARACTER_STUDIO_INSTALL_ROOT':str(install)}
    started=time.monotonic()
    subprocess.run([str(exe),'--no-browser'],env=env,check=True,timeout=120)
    record=json.loads((home/'service.json').read_text(encoding='utf-8'))
    url='http://127.0.0.1:'+str(record['port'])
    try:
        health=json.load(urllib.request.urlopen(url+'/api/health'))
        assert health['service']=='character-studio' and health['version']=='0.4.0'
        page=urllib.request.urlopen(url).read().decode('utf-8')
        assert 'reference-download' in page and '生图 API' in page
        assert json.loads((home/'state.json').read_text(encoding='utf-8'))['tasks']==[]
        if mode=='single':
            pointer=json.loads((install/'current.json').read_text(encoding='utf-8'))
            assert Path(pointer['path']).is_relative_to(install)
            assert (Path(pointer['path'])/'Character Studio.exe').is_file()
        subprocess.run([str(exe),'--no-browser'],env=env,check=True,timeout=120)
        assert json.load(urllib.request.urlopen(url+'/api/health'))['pid']==health['pid']
        print('PASS',mode,'EXE: actual packaged runtime, Chinese paths, cold start, same-server reopen, no generated/user data; %.1fs'%(time.monotonic()-started))
    finally:
        try:os.kill(record['pid'],15)
        except ProcessLookupError:pass
