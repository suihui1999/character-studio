from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,base64
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog,dismiss_guide
ROOT=Path(__file__).resolve().parents[1];RESULTS=ROOT/'test-results'
data=Path(tempfile.mkdtemp(prefix='studio-reference-download-'));seed_catalog(data)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
(data/'catalog/portrait.json').write_text(json.dumps([{'id':'portrait-test','kind':'portrait','name':'人像测试','category':'短发','angle':'','url':'https://ai-portrait-gallery.pages.dev/img/full/test.png','thumb':'https://ai-portrait-gallery.pages.dev/img/thumb/test.png'}]),encoding='utf-8')
URL='http://127.0.0.1:43131'
def tool(name,args=None):
    request=urllib.request.Request(URL+'/api/tool',data=json.dumps({'name':name,'arguments':args or {}}).encode(),headers={'Content-Type':'application/json'})
    result=json.load(urllib.request.urlopen(request));assert not result.get('isError'),result
    return result.get('structuredContent')
proc=subprocess.Popen(['node','tests/fixtures/reference-download-server.mjs'],cwd=ROOT,env={**os.environ,'CHARACTER_STUDIO_HOME':str(data)},stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
try:
    for n in range(80):
        try:tool('get_state');break
        except Exception:time.sleep(.1)
    tool('upload_character',{'name':'existing-character.png','base64':base64.b64encode(PNG).decode()})
    before=tool('get_state')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1280,'height':1000})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        for origin in ['ai-portrait-gallery','ai-costume-gallery','ai-pose-depth-gallery']:
            page.route('https://'+origin+'.pages.dev/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.goto(URL);dismiss_guide(page)
        page.locator('#check-provider:not(:disabled)').wait_for()
        before=tool('get_state')
        for kind in ['portrait','costume','pose']:
            page.locator('#'+kind+'-tab').click();page.locator('#gallery [data-select]').first.click()
            page.locator('#reference-confirm:not(:disabled)').wait_for()
            with page.expect_download() as transfer:page.locator('#reference-download').click()
            download=transfer.value
            assert Path(download.path()).read_bytes()==PNG
            assert download.suggested_filename.startswith(kind+'_')
            popup=page.locator('#download-feedback')
            assert popup.is_visible()
            assert popup.get_attribute('data-state')=='started'
            assert '下载位置：浏览器设置的下载文件夹' in popup.inner_text()
            assert popup.bounding_box()['height']<90
            assert popup.locator('button').count()==0
            assert page.locator('#reference-viewer').is_visible()
            assert page.locator('#reference-download').evaluate("e=>getComputedStyle(e).borderRadius")=='50%'
            assert page.locator('#reference-download svg').get_attribute('stroke-width')=='1.5'
            page.screenshot(path=str(RESULTS/(kind+'-detail-download.png')))
            popup.wait_for(state='hidden',timeout=4000)
            assert not popup.is_visible()
            page.locator('#close-reference-viewer').click()
        page.locator('#gallery [data-select]').first.click()
        page.route('**/api/tool',lambda route:route.fulfill(json={'isError':True,'content':[{'type':'text','text':'原图源站暂时不可用，请稍后下载。'}]}) if route.request.post_data_json.get('name')=='download_catalog_image' else route.continue_())
        page.locator('#reference-download').click()
        page.locator('#download-feedback[data-state="error"]').wait_for()
        assert '原图源站暂时不可用' in page.locator('#download-feedback-message').inner_text()
        assert page.locator('#reference-download').is_enabled()
        page.screenshot(path=str(RESULTS/'download-error-feedback.png'))
        page.locator('#download-feedback').wait_for(state='hidden',timeout=6500)
        page.locator('#close-reference-viewer').click()
        after=tool('get_state');assert after['draft']==before['draft'];assert after['tasks']==before['tasks']
        assert after['assets']==before['assets'];assert not errors,errors
        browser.close()
    print('PASS: three detail dialogs download exact original bytes without selecting a reference or replacing the main character; circular icon style verified.')
finally:proc.terminate();proc.wait(timeout=10)
