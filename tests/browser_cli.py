"""No MCP registration: CLI wait -> browser one-click submit -> exact-byte result.
The worker and PNG below are explicit protocol fixtures, never an AI image output.
"""
from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,shutil,base64,zipfile
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog,dismiss_guide
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
    p=subprocess.Popen(['node',CLI,'wait','--agent','测试 Agent','--image-tool','protocol-fixture-only','--timeout','1','--follow'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,**FLAGS)
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
        dismiss_guide(page)
        page.locator('#check-provider').click()
        page.locator('#channel-status').get_by_text('测试 Agent 已连接',exact=True).wait_for()
        assert tool('get_state')['batch'] is None
        assert page.locator('#build').is_visible()
        assert not page.locator('#combination-preview').is_visible()
        page.screenshot(path=str(RESULTS/'simple-workbench-ready.png'))
        time.sleep(2.2)
        assert worker.poll() is None and tool('get_state')['agentConnection']['connected']
        page.locator('#submit').click()
        out,err=worker.communicate(timeout=12);assert worker.returncode==0,(out,err);task=json.loads(out)['task'];assert len(task['references'])==3
        assert task['attempts']==1;page.locator('#execution-message').get_by_text('等待 Agent 确认',exact=False).wait_for()
        cli('ack','--task',task['id'])
        page.locator('#execution-message').get_by_text('Agent 已确认收到任务',exact=False).wait_for()
        page.screenshot(path=str(RESULTS/'simple-workbench-generating.png'))
        cli('result','--task',task['id'],'--file',portrait['path'])
        page.locator('#success-count').get_by_text('1',exact=True).wait_for()
        assert tool('get_state')['batch']['status']=='queued'
        worker=subprocess.Popen(['node',CLI,'wait','--agent','测试 Agent','--image-tool','protocol-fixture-only','--timeout','1','--follow'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,**FLAGS)
        out,err=worker.communicate(timeout=12);assert worker.returncode==0,(out,err);second=json.loads(out)['task'];assert second['id']!=task['id']
        cli('ack','--task',second['id'])
        cli('result','--task',second['id'],'--error','明确的协议测试失败，不是真实生图请求')
        page.locator('#execution-message').get_by_text('已跳过 1 个失败任务',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='done'
        for width in [1280,910,390,320]:
            page.set_viewport_size({'width':width,'height':1000});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.set_viewport_size({'width':1280,'height':1050})
        page.locator('#open-success-history').click()
        record=page.locator('.batch-record').first
        record.get_by_text('成功 1 张 · 失败 1 张',exact=True).wait_for()
        record.get_by_label('批次名称').fill('通勤搭配')
        record.get_by_role('button',name='保存名称').click()
        record.get_by_text('批次名称已保存。',exact=True).wait_for()
        assert record.get_by_role('button',name='打开保存文件夹').count()==0
        single=record.get_by_role('link',name='下载原图')
        single.locator('svg').wait_for()
        page.wait_for_function("document.querySelector('[data-download-result]').hasAttribute('href')")
        with page.expect_download() as single_transfer:
            single.click()
        image_download=single_transfer.value
        assert Path(image_download.path()).read_bytes()==PNG
        assert '通勤搭配' in image_download.suggested_filename and '服装_' in image_download.suggested_filename and '姿势_' in image_download.suggested_filename
        assert not page.locator('#viewer').is_visible()
        frame=record.locator('.result-frame').bounding_box();icon=single.bounding_box()
        assert frame['x']+frame['width']-icon['x']-icon['width']<=10
        assert frame['y']+frame['height']-icon['y']-icon['height']<=10
        page.locator('#success-history').screenshot(path=str(RESULTS/'result-download-desktop.png'))
        page.set_viewport_size({'width':390,'height':844})
        assert single.is_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.locator('#success-history').screenshot(path=str(RESULTS/'result-download-mobile.png'))
        page.set_viewport_size({'width':1280,'height':1050})
        saved_batch=tool('get_state')['batch']['id']
        with page.expect_download() as transfer:
            record.get_by_role('button',name='下载本批全部图片').click()
        archive=transfer.value
        assert '通勤搭配' in archive.suggested_filename
        with zipfile.ZipFile(archive.path()) as z:
            assert len(z.namelist())==1
            for name in z.namelist():
                assert '通勤搭配' in name and saved_batch[:8] in name and '服装_' in name and '姿势_' in name
                assert z.read(name)==PNG
        record.locator('[data-view]').first.click()
        assert '通勤搭配' in page.locator('#download').get_attribute('download')
        page.locator('#close-viewer').click()
        page.screenshot(path=str(RESULTS/'batch-history-download.png'))
        page.locator('#close-success-history').click()
        page.locator('#submit').click()
        page.locator('#execution-message').get_by_text('发送「重新连接人物工作台」',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='queued'
        assert all(t['attempts']==0 for t in tool('get_state')['tasks'] if t['batchId']==tool('get_state')['batch']['id'])
        page.screenshot(path=str(RESULTS/'simple-workbench-disconnected.png'))
        doubao_url=cli('open','--executor','keep','--no-browser','--host','doubao')['url']
        assert doubao_url==URL+'/?host=doubao'
        page.locator('#cancel').click()
        page.context.grant_permissions(['clipboard-read','clipboard-write'],origin=URL)
        page.goto(doubao_url)
        picker=page.locator('#agent-choice')
        page.wait_for_function("document.querySelector('#agent-choice').value==='doubao'")
        assert picker.input_value()=='doubao'
        picker.select_option('codex')
        page.wait_for_function("document.querySelector('#provider-hint').textContent.includes('已登录的 Codex')")
        assert tool('get_state')['draft']['provider']=='codex'
        picker.select_option('doubao')
        page.get_by_text('豆包未连接。可先提交任务，再回豆包接手整批。',exact=True).wait_for()
        page.locator('#submit').click()
        page.get_by_text('任务已保存，等待豆包接手。',exact=True).wait_for()
        assert not page.locator('#local-reconnect').is_visible()
        page.get_by_role('button',name='复制接手指令').click()
        assert page.evaluate('navigator.clipboard.readText()')=='处理工作台里待生成的图片'
        page.screenshot(path=str(RESULTS/'doubao-batch-handoff.png'),full_page=True)
        batch_id=tool('get_state')['batch']['id']
        assert tool('get_state')['batch']['agentHost']=='doubao'
        wrong=cli('wait','--agent','Codex','--image-tool','protocol-fixture-only','--timeout','2')
        assert wrong['reason']=='different_agent' and wrong['task'] is None
        resumed=cli('wait','--agent','豆包工作','--image-tool','protocol-fixture-only','--timeout','2')['task']
        assert resumed['batchId']==batch_id and resumed['attempts']==1
        page.locator('#doubao-handoff').wait_for(state='hidden')
        cli('ack','--task',resumed['id'])
        cli('result','--task',resumed['id'],'--file',portrait['path'])
        last=cli('wait','--agent','豆包工作','--image-tool','protocol-fixture-only','--timeout','2')['task']
        assert last['batchId']==batch_id and last['id']!=resumed['id']
        cli('ack','--task',last['id'])
        cli('result','--task',last['id'],'--file',portrait['path'])
        assert tool('get_state')['batch']['status']=='done'
        page.locator('#success-count').get_by_text('3',exact=True).wait_for()
        assert not page.locator('#doubao-handoff').is_visible()
        assert not errors,errors;page.unroute_all(behavior='wait');browser.close()
    print('PASS CLI/browser: no MCP registration; one-click build/submit; 3 refs; continuous batch; exact-byte result; failure skip; disconnect visible; responsive layout. No real image generation.')
finally:
    if worker and worker.poll() is None:worker.terminate();worker.wait(timeout=10)
    try:os.kill(health['pid'],15)
    except OSError:pass
