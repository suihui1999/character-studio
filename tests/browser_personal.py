"""Personal Key -> built-in workflow -> real HTTP lifecycle.
Uses isolated protocol fixtures; no real provider calls, user data, or image generation.
"""
from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,shutil,base64
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog
ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results';RESULTS.mkdir(exist_ok=True)
data=Path(tempfile.mkdtemp(prefix='character-personal-browser-'));seed_catalog(data)
URL='http://127.0.0.1:43130'
PRESETS={'runninghub-cn':'rh-cn-qwen21-three-reference','runninghub-global':'rh-global-qwen21-three-reference'}
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
def tool(name,args=None):
    req=urllib.request.Request(URL+'/api/tool',data=json.dumps({'name':name,'arguments':args or {}}).encode(),headers={'Content-Type':'application/json'})
    r=json.load(urllib.request.urlopen(req,timeout=45));assert not r.get('isError'),r
    return r.get('structuredContent')
proc=subprocess.Popen(['node',str(ROOT/'tests/fixtures/personal-server.mjs')],cwd=ROOT,env={**os.environ,'CHARACTER_STUDIO_HOME':str(data)},stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
try:
    for i in range(80):
        try:tool('get_state');break
        except Exception:time.sleep(.1)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1200,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://ai-pose-depth-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.route('https://ai-costume-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.goto(URL)
        page.locator('#provider [aria-pressed=true]').wait_for()
        assert not page.locator('#rh-guide').is_visible()
        assert page.locator('#open-provider-settings').count()==0
        for provider,link,key in [
            ('runninghub-cn','https://www.runninghub.cn?inviteCode=s3dw8iym','cn-personal-fixture'),
            ('runninghub-global','https://www.runninghub.ai?inviteCode=qpj6esof','global-personal-fixture')
        ]:
            page.locator('[data-provider='+provider+']').click()
            page.locator('#open-rh-guide').click()
            assert not page.locator('#provider-key').is_visible()
            page.locator('#rh-guide a[href="'+link+'"]').wait_for()
            assert page.locator('#rh-guide a:visible').count()==1
            page.wait_for_function("document.querySelector('#rh-guide img').naturalWidth>0")
            page.locator('#rh-guide').screenshot(path=str(RESULTS/(provider+'-guide.png')))
            page.locator('#close-rh-guide').click()
            page.locator('#open-rh-key').click()
            assert page.locator('#rh-key-dialog').is_visible()
            assert page.locator('#provider-preset').input_value()==PRESETS[provider]
            assert page.locator('#provider-preset').is_disabled()
            if provider=='runninghub-cn':
                page.locator('#provider-key').fill('not-found-fixture')
                page.locator('#save-provider-key').click()
                page.locator('#rh-key-status').get_by_text('返回 806',exact=False).wait_for()
                assert not tool('generation_channels')['credentials'][provider]['configured']
            page.locator('#provider-key').fill(key)
            page.locator('#save-provider-key').click()
            page.locator('#rh-key-status').get_by_text('Key 已保存在本机',exact=False).wait_for()
            assert page.locator('#provider-key').input_value()==''
            assert key not in json.dumps(tool('get_state'))
            page.locator('#rh-key-dialog').screenshot(path=str(RESULTS/(provider+'-key-dialog.png')))
            page.locator('#close-rh-key').click()
            assert not page.locator('#provider-key').is_visible()
        saved=json.loads((data/'state.json').read_text(encoding='utf-8'))
        assert saved['providerPresets']==[]
        portrait=tool('upload_character',{'name':'fixture.png','base64':base64.b64encode(PNG).decode()})
        costume=tool('browse_catalog',{'kind':'costume','limit':1})['items'][0];c=tool('select_reference',{'item':costume});poses=[]
        for query in ['full_single_P015_front','full_single_P016_front']:
            pose=tool('browse_catalog',{'kind':'pose','q':query,'limit':1})['items'][0];poses.append(tool('select_reference',{'item':pose})['id'])
        tool('save_draft',{'patch':{'mode':'all','costumeIds':[c['id']],'poseIds':poses}})
        saved=json.loads((data/'state.json').read_text(encoding='utf-8'))
        for a in saved['assets'].values():
            if a['kind'] in ['pose','costume']:a.update(path=portrait['path'],mime='image/png')
        (data/'state.json').write_text(json.dumps(saved),encoding='utf-8')
        page.reload();page.locator('#portrait-name').get_by_text('fixture.png',exact=True).wait_for()
        page.locator('[data-provider=runninghub-cn]').click()
        tool('save_provider_keys',{'keys':{'runninghub-cn':'not-found-fixture'}})
        page.locator('#check-provider').click()
        page.locator('#channel-status').get_by_text('返回 806',exact=False).wait_for()
        page.locator('#channel-details>summary').click()
        page.locator('#channel-details p').get_by_text('HTTP 200 / 806',exact=False).wait_for()
        page.locator('.generation-choice').screenshot(path=str(RESULTS/'personal-main-connection-error.png'))
        tool('save_provider_keys',{'keys':{'runninghub-cn':'cn-personal-fixture'}})
        assert tool('get_state')['batch'] is None
        for provider,count in [('runninghub-cn','2'),('runninghub-global','4')]:
            page.locator('[data-provider='+provider+']').click()
            page.locator('#check-provider').click()
            page.locator('#channel-status').get_by_text('个人版连接成功',exact=False).wait_for()
            assert tool('get_state')['batch'] is None or tool('get_state')['batch']['status']=='done'
            assert page.locator('#provider-preset').input_value()==PRESETS[provider]
            assert page.locator('#ratio option').evaluate_all('(options) => options.map(o => o.value)')==['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9']
            assert page.locator('#ratio').input_value()==('3:4' if provider=='runninghub-cn' else '21:9')
            ratio='21:9' if provider=='runninghub-cn' else '2:3'
            page.locator('#ratio').select_option(ratio)
            page.locator('.generation-actions').screenshot(path=str(RESULTS/(provider+'-image-ratio.png')))
            page.locator('#submit').click();page.locator('#success-count').get_by_text(count,exact=True).wait_for(timeout=20000)
            state=tool('get_state');assert state['batch']['status']=='done'
            assert len([t for t in state['tasks'] if t['provider']==provider and t['status']=='done'])==2
            assert all(t['ratio']==ratio for t in state['tasks'] if t['provider']==provider)
        page.locator('#success-history>summary').click();page.locator('[data-result-image]').first.wait_for()
        page.locator('.queue').screenshot(path=str(RESULTS/'personal-channels-results.png'))
        for width in [910,390,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        assert not errors,errors
        page.reload();page.wait_for_function('()=>document.querySelector("[data-provider=runninghub-global]").getAttribute("aria-pressed")==="true"')
        assert len(tool('get_state')['providerPresets'])==2
        page.unroute_all(behavior='wait')
        page.close()
        browser.close()
    print('PASS personal API: encrypted keys; shared app/workflow defaults; site onboarding; 3-reference upload; polling/result persistence; reopen; mobile layout. No real generation.')
finally:
    proc.terminate();proc.wait(timeout=10)
