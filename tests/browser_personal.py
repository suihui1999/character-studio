"""Personal Key -> import app/workflow -> select site/model -> real HTTP lifecycle.
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
        page.goto(URL);page.locator('#open-provider-settings').click()
        page.locator('#provider-settings').wait_for()
        for provider,kind,key in [('runninghub-cn','app','cn-personal-fixture'),('runninghub-global','workflow','global-personal-fixture')]:
            page.locator('#config-provider').select_option(provider)
            page.locator('#provider-key').fill(key);page.locator('#save-provider-key').click()
            page.locator('#key-state').get_by_text('已配置',exact=False).wait_for()
            assert page.locator('#provider-key').input_value()==''
            assert key not in json.dumps(tool('get_state'))
            if provider=='runninghub-cn':
                page.locator('#provider-key').fill('not-found-fixture')
                page.locator('#test-provider').click()
                assert page.locator('#test-provider').is_disabled()
                assert page.locator('#test-provider').inner_text()=='测试中…'
                page.locator('#provider-connection-status').get_by_text('返回 806',exact=False).wait_for()
                assert page.locator('#provider-connection-status').evaluate('(el)=>{const r=el.getBoundingClientRect(),d=el.closest("dialog").getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom&&r.top>=0&&r.bottom<=innerHeight}')
                page.locator('#provider-settings').screenshot(path=str(RESULTS/'personal-key-error-visible.png'))
                assert page.locator('#key-state').inner_text().startswith('已配置')
                page.locator('#provider-key').fill('')
            page.locator('#test-provider').click();page.locator('#provider-connection-status').get_by_text('个人版连接成功',exact=False).wait_for()
            page.locator('#preset-name').fill(provider+' '+kind)
            page.locator('#preset-kind').select_option(kind)
            domain='cn' if provider.endswith('cn') else 'ai'
            page.locator('#preset-link').fill('https://www.runninghub.'+domain+'/ai-detail/1877265245566922753')
            page.locator('#inspect-provider-preset').click();page.locator('[data-node-source="0"]').wait_for()
            assert page.locator('[data-node-source="0"]').input_value()=='portrait'
            assert page.locator('[data-node-source="1"]').input_value()=='costume'
            assert page.locator('[data-node-source="2"]').input_value()=='pose'
            if kind=='app':page.locator('[data-node-value="5"]').select_option('"fixture-v2"')
            page.locator('#provider-settings').screenshot(path=str(RESULTS/('personal-import-'+kind+'.png')))
            page.locator('#save-provider-preset').click();page.locator('#provider-settings-status').get_by_text('模型预设已保存',exact=False).wait_for()
        page.locator('#close-provider-settings').click()
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
        for provider,count in [('runninghub-cn','2'),('runninghub-global','4')]:
            page.locator('#provider').select_option(provider)
            page.wait_for_function('()=>document.querySelector("#provider-preset").options.length===2')
            preset=next(p for p in tool('get_state')['providerPresets'] if p['provider']==provider)
            page.locator('#provider-preset').select_option(preset['id'])
            page.locator('#submit').click();page.locator('#success-count').get_by_text(count,exact=True).wait_for(timeout=20000)
            state=tool('get_state');assert state['batch']['status']=='done'
            assert len([t for t in state['tasks'] if t['provider']==provider and t['status']=='done'])==2
        page.locator('#success-history>summary').click();page.locator('[data-result-image]').first.wait_for()
        page.locator('.queue').screenshot(path=str(RESULTS/'personal-channels-results.png'))
        for width in [910,390,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        assert not errors,errors
        page.reload();page.wait_for_function('()=>document.querySelector("#provider").value==="runninghub-global"')
        assert len(tool('get_state')['providerPresets'])==2
        page.unroute_all(behavior='wait')
        page.close()
        browser.close()
    print('PASS personal API: encrypted keys; app/workflow import; site/model selection; 3-reference upload; polling/result persistence; reopen; mobile layout. No real generation.')
finally:
    proc.terminate();proc.wait(timeout=10)
