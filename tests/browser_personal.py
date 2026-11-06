"""Image API browser regression using isolated local protocol fixtures, without charges."""
from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,base64
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog,dismiss_guide
ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results';RESULTS.mkdir(exist_ok=True)
data=Path(tempfile.mkdtemp(prefix='character-api-browser-'));seed_catalog(data)
URL='http://127.0.0.1:43130'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
services=[('image-openai','OpenAI','https://platform.openai.com/api-keys','fixture-openai-key'),('image-gemini','Google Gemini','https://aistudio.google.com/api-keys','fixture-gemini-key'),('image-seedream','火山方舟 Seedream','https://ark.volcengine.com/region:cn-beijing/apikey','fixture-seedream-key'),('image-custom','自定义兼容 API',None,'fixture-custom-key')]
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
        browser=pw.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1440,'height':1100})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route('https://ai-pose-depth-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.route('https://ai-costume-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.goto(URL);dismiss_guide(page)
        assert page.locator('[data-provider^=runninghub]').count()==0
        assert page.locator('[data-provider]').count()==2
        page.locator('[data-provider=image-api]').click()
        for provider,name,link,key in services:
            page.locator('#api-service').select_option(provider)
            page.locator('#open-api-guide').click()
            page.locator('#api-guide-title').get_by_text('获取 '+name+' API Key',exact=True).wait_for()
            assert page.locator('#api-key-steps li').count()==3
            if link:assert page.locator('#api-key-link').get_attribute('href')==link
            else:assert page.locator('#api-key-link').is_hidden()
            assert not page.locator('#provider-key').is_visible()
            page.locator('#api-guide').screenshot(path=str(RESULTS/(provider+'-key-guide.png')))
            page.locator('#guide-open-key').click()
            assert page.locator('#api-key-dialog').is_visible()
            if provider=='image-custom':
                page.locator('#api-base-url').fill('https://fixture.example/v1')
                page.locator('#api-model').fill('custom-test-model')
                page.locator('#api-protocol').select_option('openai-multipart')
            else:assert page.locator('#custom-api-fields').is_hidden()
            if provider=='image-openai':
                page.locator('#provider-key').fill('invalid-fixture-secret');page.locator('#save-provider-key').click()
                page.locator('#api-key-status').get_by_text('HTTP 401',exact=False).wait_for()
                assert 'invalid-fixture-secret' not in page.locator('#api-key-status').text_content()
                assert not tool('generation_channels')['credentials'][provider]['configured']
            page.locator('#provider-key').fill(key);page.locator('#save-provider-key').click()
            page.locator('#api-key-status').get_by_text('Key 已保存在本机',exact=False).wait_for()
            page.locator('#channel-status').get_by_text('API 已连接',exact=False).wait_for()
            assert page.locator('#provider-key').input_value()==''
            assert key not in json.dumps(tool('get_state'))
            page.locator('#api-key-dialog').screenshot(path=str(RESULTS/(provider+'-key-dialog.png')))
            page.locator('#close-api-key').click()
            page.locator('#api-key-summary').get_by_text('已配置',exact=True).wait_for()
        portrait=tool('upload_character',{'name':'api-fixture.png','base64':base64.b64encode(PNG).decode()})
        costume=tool('browse_catalog',{'kind':'costume','limit':1})['items'][0]
        c=tool('select_reference',{'item':costume});poses=[]
        for query in ['full_single_P015_front','full_single_P016_front']:
            pose=tool('browse_catalog',{'kind':'pose','q':query,'limit':1})['items'][0];poses.append(tool('select_reference',{'item':pose})['id'])
        tool('save_draft',{'patch':{'costumeIds':[c['id']],'poseIds':poses}})
        saved=json.loads((data/'state.json').read_text(encoding='utf-8'))
        for asset in saved['assets'].values():
            if asset['kind'] in ['costume','pose']:asset.update(path=portrait['path'],mime='image/png')
        (data/'state.json').write_text(json.dumps(saved),encoding='utf-8')
        page.reload();page.locator('#portrait-name').get_by_text('api-fixture.png',exact=True).wait_for()
        count=0
        for provider,name,link,key in services:
            page.locator('#api-service').select_option(provider)
            page.wait_for_function("document.querySelector('#provider-preset').value.startsWith('"+provider+":')")
            page.locator('#channel-status').get_by_text('API 已连接',exact=False).wait_for()
            page.locator('#test-generation:not(:disabled)').click()
            page.locator('#test-description').get_by_text('按该服务规则计费',exact=False).wait_for()
            page.locator('#test-confirmation').screenshot(path=str(RESULTS/(provider+'-fee-confirmation.png')))
            page.locator('#close-test').click()
            assert tool('get_state').get('generationChecks') is None
            page.locator('#ratio').select_option('3:4')
            page.locator('#submit:not(:disabled)').click();count+=2
            page.locator('#success-count').get_by_text(str(count),exact=True).wait_for(timeout=20000)
            state=tool('get_state');assert state['batch']['status']=='done'
            assert len([t for t in state['tasks'] if t['provider']==provider and t['status']=='done'])==2
            assert all(t['ratio']=='3:4' for t in state['tasks'] if t['provider']==provider)
        page.locator('#api-service').select_option('image-openai')
        page.wait_for_function("document.querySelector('#provider-preset').value.startsWith('image-openai:')")
        page.locator('#channel-status').get_by_text('API 已连接',exact=False).wait_for()
        page.screenshot(path=str(RESULTS/'image-api-desktop.png'),full_page=True)
        page.locator('#provider-preset').select_option('image-openai:gpt-image-1.5')
        page.wait_for_function("document.querySelector('#ratio').value==='2:3'")
        assert page.locator('#ratio option').evaluate_all('(items)=>items.map(x=>x.value)')==['2:3','1:1','3:2']
        page.reload();page.locator('#api-key-summary').get_by_text('已配置',exact=True).wait_for()
        page.locator('#channel-status').get_by_text('API 已连接',exact=False).wait_for()
        assert page.locator('#provider-preset').input_value()=='image-openai:gpt-image-1.5'
        for width in [910,390,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.screenshot(path=str(RESULTS/'image-api-mobile.png'),full_page=True)
        assert not errors,errors
        browser.close()
    print('PASS image APIs: service dialogs, official links, isolated keys, redacted errors, fee confirmation, four 3-reference whole batches, model ratios, persistent results and responsive layout. Fixture-only, no charges.')
finally:proc.terminate();proc.wait(timeout=10)
