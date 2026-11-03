"""No MCP registration: CLI wait -> browser one-click submit -> exact-byte result.
The worker and PNG below are explicit protocol fixtures, never an AI image output.
"""
from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,shutil,base64
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog
ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results';RESULTS.mkdir(exist_ok=True)
DATA=Path(tempfile.mkdtemp(prefix='studio-browser-cli-'));seed_catalog(DATA)
ENV={**os.environ,'CHARACTER_STUDIO_HOME':str(DATA)}
CLI=str(ROOT/'plugins/character-studio/dist/cli.mjs')
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
FLAGS={'env':ENV,'encoding':'utf-8','creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)}
def cli(*args):return json.loads(subprocess.check_output(['node',CLI,*args],**FLAGS))
URL=cli('open','--no-browser','--port','0')['url']
health=json.load(urllib.request.urlopen(URL+'/api/health'))
def tool(name,args=None):
    req=urllib.request.Request(URL+'/api/tool',data=json.dumps({'name':name,'arguments':args or {}}).encode(),headers={'Content-Type':'application/json'})
    r=json.load(urllib.request.urlopen(req,timeout=15));assert not r.get('isError'),r;return r['structuredContent']
def waiter():
    p=subprocess.Popen(['node',CLI,'wait','--agent','测试 Agent','--image-tool','protocol-fixture-only','--timeout','10'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,**FLAGS)
    for _ in range(100):
        if tool('get_state')['agentConnection']['connected']:return p
        time.sleep(.05)
    raise AssertionError('worker did not connect')
worker=None
try:
    portrait=tool('upload_character',{'name':'protocol-fixture.png','base64':base64.b64encode(PNG).decode()})
    costume=tool('browse_catalog',{'kind':'costume','category':'春季','limit':1})['items'][0]
    poses=tool('browse_catalog',{'kind':'pose','category':'站姿','angle':'正面','limit':2})['items']
    c=tool('select_reference',{'item':costume});ps=[tool('select_reference',{'item':p})['id'] for p in poses]
    tool('save_draft',{'patch':{'costumeIds':[c['id']],'poseIds':ps}})
    saved=json.loads((DATA/'state.json').read_text(encoding='utf-8'))
    for a in saved['assets'].values():
        if a['kind'] in ['pose','costume']:a.update(path=portrait['path'],mime='image/png')
    (DATA/'state.json').write_text(json.dumps(saved),encoding='utf-8')
    worker=waiter()
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1280,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://ai-pose-depth-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.route('https://ai-costume-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.goto(URL);page.locator('#channel-status').get_by_text('测试 Agent 已连接',exact=True).wait_for()
        page.locator('#check-provider').click()
        page.locator('#channel-status').get_by_text('测试 Agent 已连接',exact=True).wait_for()
        assert tool('get_state')['batch'] is None
        assert page.locator('#build').is_visible()
        assert not page.locator('#combination-preview').is_visible()
        page.screenshot(path=str(RESULTS/'simple-workbench-ready.png'))
        page.locator('#submit').click()
        out,err=worker.communicate(timeout=12);assert worker.returncode==0,(out,err);task=json.loads(out)['task'];assert len(task['references'])==3
        assert task['attempts']==1;page.locator('#execution-message').get_by_text('已交给 测试 Agent',exact=False).wait_for()
        page.screenshot(path=str(RESULTS/'simple-workbench-generating.png'))
        cli('result','--task',task['id'],'--file',portrait['path'])
        page.locator('#success-count').get_by_text('1',exact=True).wait_for()
        assert tool('get_state')['batch']['status']=='queued'
        worker=subprocess.Popen(['node',CLI,'wait','--agent','测试 Agent','--image-tool','protocol-fixture-only','--timeout','10'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,**FLAGS)
        out,err=worker.communicate(timeout=12);assert worker.returncode==0,(out,err);second=json.loads(out)['task'];assert second['id']!=task['id']
        cli('result','--task',second['id'],'--error','明确的协议测试失败，不是真实生图请求')
        page.locator('#execution-message').get_by_text('已跳过 1 个失败任务',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='done'
        for width in [1280,910,390,320]:
            page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.set_viewport_size({'width':1280,'height':1050})
        page.locator('#success-history>summary').click();page.screenshot(path=str(RESULTS/'simple-workbench-results.png'))
        page.locator('#submit').click()
        page.locator('#execution-message').get_by_text('发送「重新连接人物工作台」',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='paused'
        assert all(t['attempts']==0 for t in tool('get_state')['tasks'] if t['batchId']==tool('get_state')['batch']['id'])
        page.screenshot(path=str(RESULTS/'simple-workbench-disconnected.png'))
        assert not errors,errors;page.unroute_all(behavior='wait');browser.close()
    print('PASS CLI/browser: no MCP registration; one-click build/submit; 3 refs; continuous batch; exact-byte result; failure skip; disconnect visible; responsive layout. No real image generation.')
finally:
    if worker and worker.poll() is None:worker.terminate();worker.wait(timeout=10)
    try:os.kill(health['pid'],15)
    except OSError:pass
