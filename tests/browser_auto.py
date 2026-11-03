"""Browser button -> HTTP -> app-server protocol -> stored result/error.
The app-server executable is a clearly isolated test fixture, never a real generator.
"""
from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,shutil,base64
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results';RESULTS.mkdir(exist_ok=True)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
URL='http://127.0.0.1:43129'
def tool(name,args=None):
    req=urllib.request.Request(URL+'/api/tool',data=json.dumps({'name':name,'arguments':args or {}}).encode(),headers={'Content-Type':'application/json'})
    r=json.load(urllib.request.urlopen(req,timeout=45));assert not r.get('isError'),r
    return r.get('structuredContent')

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    for mode in ['success','first-rejected','rejected','notloggedin','hang-once']:
        data=Path(tempfile.mkdtemp(prefix='character-auto-browser-'));seed_catalog(data)
        env={**os.environ,'CHARACTER_STUDIO_HOME':str(data),'CHARACTER_STUDIO_CODEX_BIN':str(ROOT/'tests/fixtures/fake-codex.js'),'STUDIO_TEST_EXECUTOR_MODE':mode,'STUDIO_TEST_HANG_FLAG':str(data/'hang-flag')}
        proc=subprocess.Popen(['node',str(ROOT/'plugins/character-studio/dist/server.mjs'),'--http','--port','43129'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            for i in range(80):
                try:tool('get_state');break
                except Exception:time.sleep(.1)
            portrait=tool('upload_character',{'name':'long-file-name-'+'A'*120+'.png','base64':base64.b64encode(PNG).decode()})
            costume=tool('browse_catalog',{'kind':'costume','limit':1})['items'][0]
            pose=tool('browse_catalog',{'kind':'pose','q':'full_single_P015_front','limit':1})['items'][0]
            c=tool('select_reference',{'item':costume});p=tool('select_reference',{'item':pose})
            poses=[p['id']]
            if mode in ['first-rejected','hang-once']:
                pose2=tool('browse_catalog',{'kind':'pose','q':'full_single_P016_front','limit':1})['items'][0]
                poses.append(tool('select_reference',{'item':pose2})['id'])
            tool('save_draft',{'patch':{'mode':'all','costumeIds':[c['id']],'poseIds':poses}});tool('build_queue')
            saved=json.loads((data/'state.json').read_text(encoding='utf-8'))
            for a in saved['assets'].values():
                if a['kind'] in ['pose','costume']:a.update(path=portrait['path'],mime='image/png')
            (data/'state.json').write_text(json.dumps(saved),encoding='utf-8')
            page=browser.new_page(viewport={'width':910,'height':1000})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.route('https://ai-pose-depth-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
            page.route('https://ai-costume-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
            page.goto(URL);page.locator('#submit:not(:disabled)').wait_for()
            assert page.locator('#fallback').count()==0
            assert page.locator('#provider [aria-pressed=true]').get_attribute('data-provider')=='agent'
            if mode=='success':
                prompt_entry=page.get_by_text('编辑默认提示词',exact=True)
                assert prompt_entry.is_visible()
                page.locator('.queue').screenshot(path=str(RESULTS/'generation-layout.png'))
                prompt_entry.click()
                assert '人像参考' in page.locator('#template').input_value()
                page.locator('#template').fill(page.locator('#template').input_value()+'\n模板保存验证')
                with page.expect_response(lambda r:r.url.endswith('/api/tool') and r.request.post_data_json.get('name')=='save_draft'):
                    page.locator('#notes').focus()
                page.reload()
                page.wait_for_function("document.querySelector('#template').value.includes('模板保存验证')")
                page.locator('#channel-status').get_by_text('本机 Codex 已登录',exact=False).wait_for()
                page.locator('#check-provider').click()
                page.locator('#channel-status').get_by_text('本机 Codex 已登录',exact=False).wait_for()
                assert tool('get_state')['batch']['status']=='draft'
            assert page.locator('#output-style, #mode').count()==0
            if mode=='hang-once':page.screenshot(path=str(RESULTS/'batch-replacement-ready.png'),full_page=True)
            page.locator('#submit').click()
            if mode=='hang-once':
                page.locator('#execution-message').get_by_text('已用时',exact=False).wait_for(timeout=15000)
                assert tool('get_state')['tasks'][0]['status']=='running'
                page.screenshot(path=str(RESULTS/'batch-replacement-generating.png'),full_page=True)
                page.locator('#cancel').click()
                page.locator('#build').click()
                page.locator('#close-preview').click()
                page.locator('#submit:not(:disabled)').wait_for()
                page.screenshot(path=str(RESULTS/'batch-replacement-new-queue.png'),full_page=True)
                page.locator('#submit').click()
                page.locator('#success-count').get_by_text('2',exact=True).wait_for(timeout=15000)
                page.locator('#success-history>summary').click()
                page.locator('[data-result-image]').first.wait_for()
                assert tool('get_state')['batch']['status']=='done'
                page.screenshot(path=str(RESULTS/'batch-replacement-complete.png'),full_page=True)
            elif mode in ['success','first-rejected']:
                page.locator('#success-count').get_by_text('1',exact=True).wait_for(timeout=15000)
                assert not page.locator('#success-history').evaluate('(e)=>e.open')
                page.locator('#success-history>summary').click()
                page.locator('[data-result-image]').wait_for(timeout=15000)
                assert tool('get_state')['tasks'][0]['status']=='done'
                if mode=='first-rejected':
                    assert tool('get_state')['batch']['failedCount']==1
                    page.locator('#execution-message').get_by_text('已跳过 1 个失败任务',exact=False).wait_for(timeout=15000)
                assert page.locator('.result-image').bounding_box()['height']>30
            elif mode=='rejected':
                page.locator('#execution-message').get_by_text('已跳过 1 个失败任务',exact=False).wait_for(timeout=15000)
                assert 'moderation_blocked' in page.locator('#execution-message').inner_text()
                assert tool('get_state')['batch']['status']=='done'
                assert page.locator('[data-result-image]').count()==0
            else:
                page.locator('.job-failure').wait_for(timeout=15000)
                assert page.locator('.job-failure').inner_text()
                assert '登录' in page.locator('.job-failure').inner_text()
                assert tool('get_state')['batch']['status']=='paused'
                assert page.locator('[data-result-image]').count()==0
            assert not errors,errors
            page.close()
            print('PASS standalone browser automatic '+mode+' without any copied prompt')
        finally:
            proc.terminate();proc.wait(timeout=10)
    browser.close()
