"""MCP Apps protocol harness against the real local tool server; no image generation."""
from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,shutil,base64
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results';RESULTS.mkdir(exist_ok=True)
DATA=Path(tempfile.mkdtemp(prefix='character-studio-browser-'))
seed_catalog(DATA)
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')
env={**os.environ,'CHARACTER_STUDIO_HOME':str(DATA)}
proc=subprocess.Popen(['node',str(ROOT/'plugins/character-studio/dist/server.mjs'),'--http','--port','43128'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
URL='http://127.0.0.1:43128'
def tool(name,args=None):
    req=urllib.request.Request(URL+'/api/tool',data=json.dumps({'name':name,'arguments':args or {}}).encode(),headers={'Content-Type':'application/json'})
    r=json.load(urllib.request.urlopen(req,timeout=45))
    assert not r.get('isError'),r
    return r.get('structuredContent')
try:
    for i in range(80):
        try:tool('get_state');break
        except Exception:time.sleep(.1)
    # A small real-byte fixture for uploads and result round trips; never a generated image.
    uploaded=DATA/('protocol-character-'+('A'*120)+'.png');uploaded.write_bytes(PNG)
    html=urllib.request.urlopen(URL).read().decode()
    host='''<!doctype html><html><meta charset="utf-8"><style>body{margin:0;background:#f7f6f2}iframe{border:0;width:100%;min-height:1100px}</style><iframe sandbox="allow-scripts" id="app"></iframe><script>
    window.messages=[];window.methods=[];window.toolCalls=[];window.rejectMessage=false;
    addEventListener('message',async e=>{const m=e.data;if(!m?.jsonrpc)return;window.methods.push(m.method);
      if(m.method==='ui/notifications/size-changed'){document.querySelector('iframe').style.height=m.params.height+'px';return;}
      if(m.id===undefined)return;
      let result;
      try{
        if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'Character Studio protocol harness',version:'1.0'},hostCapabilities:{serverTools:{},openLinks:{},message:{text:{}}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}};
        else if(m.method==='tools/call'){window.toolCalls.push(m.params.name);result=await fetch('/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m.params)}).then(r=>r.json());}
        else if(m.method==='ui/message'){if(window.rejectMessage)throw Error('fixture host rejected message');window.messages.push(m.params);result={};}
        else if(m.method==='ui/request-display-mode')result={mode:m.params.mode};
        else if(m.method==='ui/open-link')result={};
        else result={};
        e.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');
      }catch(err){e.source.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:err.message}},'*');}
    });
    document.querySelector('iframe').srcdoc=__HTML__;
    </script></html>'''.replace('__HTML__',json.dumps(html).replace('<','\\u003c'))
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1280,'height':1050})
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.route(URL+'/host',lambda route:route.fulfill(content_type='text/html',body=host))
        page.route('https://ai-pose-depth-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.route('https://ai-costume-gallery.pages.dev/thumbs/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.goto(URL+'/host')
        f=page.frame_locator('iframe')
        f.locator('#connection').get_by_text('Agent 已连接').wait_for(timeout=15000)
        f.locator('[data-select]').first.wait_for(timeout=45000)
        f.locator('#portrait-file').set_input_files(str(uploaded))
        f.locator('#portrait-name').get_by_text(uploaded.name).wait_for()
        f.locator('[data-select]').nth(0).click();f.locator('#costume-count').get_by_text('1',exact=True).wait_for()
        f.locator('[data-select]').nth(1).click();f.locator('#costume-count').get_by_text('2',exact=True).wait_for()
        f.locator('#gallery').evaluate('(g)=>{const b=g.querySelectorAll("[data-select]");b[2].click();b[3].click()}')
        f.locator('#costume-count').get_by_text('4',exact=True).wait_for()
        f.locator('#gallery').evaluate('(g)=>{const b=g.querySelectorAll("[data-select]");b[2].click();b[3].click()}')
        f.locator('#costume-count').get_by_text('2',exact=True).wait_for()
        f.locator('#pose-tab').click();f.locator('[data-select]').first.wait_for()
        f.locator('[data-select]').nth(0).click();f.locator('#pose-count').get_by_text('1',exact=True).wait_for()
        f.locator('[data-select]').nth(1).click();f.locator('#pose-count').get_by_text('2',exact=True).wait_for()
        f.locator('#category').select_option('');f.locator('[data-select]').first.wait_for()
        assert f.locator('#category').input_value()==''
        f.locator('#notes').fill('协议验证：不执行生图')
        f.locator('#provider').select_option('agent')
        f.locator('#provider-hint').get_by_text('使用当前聊天里 Agent 已有的生图能力',exact=False).wait_for()
        f.locator('#connection').get_by_text('Agent 消息已连接',exact=True).wait_for()
        assert f.locator('#provider-preset').is_disabled()
        page.screenshot(path=str(RESULTS/'agent-channel-desktop.png'))
        f.locator('#advanced-generation>summary').click()
        f.locator('#build').click();f.locator('.job').first.wait_for()
        assert f.locator('.job').count()==4
        f.locator('[data-delete]').first.click();page.wait_for_timeout(300);assert f.locator('.job').count()==3
        f.locator('[data-edit]').first.click();f.locator('#edit-prompt').fill('这是一条独立任务的验证提示词');f.locator('#save-task').click()
        f.locator('#submit').click()
        page.wait_for_function('window.messages.length===1')
        assert 'claim_next_task' in page.evaluate('window.messages[0].content[0].text')
        assert 'ui/initialize' in page.evaluate('window.methods')
        # Inject only pre-cached reference file paths into this isolated test data.
        state=tool('get_state')
        saved=json.loads((DATA/'state.json').read_text(encoding='utf-8'))
        for a in saved['assets'].values():
            if a['kind'] in ['pose','costume']:a.update(path=str(uploaded),mime='image/png')
        (DATA/'state.json').write_text(json.dumps(saved),encoding='utf-8')
        task=tool('claim_next_task')['task'];assert len(task['references'])==3
        tool('record_result',{'taskId':task['id'],'filePath':str(uploaded)})
        f.locator('#refresh').click();f.locator('#success-count').get_by_text('1',exact=True).wait_for()
        assert not f.locator('#success-history').evaluate('(e)=>e.open')
        assert f.locator('#jobs [data-result-image]').count()==0
        f.locator('#success-history>summary').click();f.locator('[data-result-image]').first.wait_for()
        assert f.locator('#continue').is_visible()
        page.reload();f.locator('#portrait-name').get_by_text(uploaded.name).wait_for(timeout=20000)
        f.locator('#success-count').get_by_text('1',exact=True).wait_for()
        assert not f.locator('#success-history').evaluate('(e)=>e.open')
        f.locator('#success-history>summary').click()
        f.locator('[data-result-image]').first.wait_for()
        assert f.locator('#costume-count').inner_text()=='2'
        assert f.locator('#pose-count').inner_text()=='2'
        for width in [1280,910,900,736,390,320]:
            page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(150)
            assert page.frames[1].evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            assert f.locator('.portrait-section').evaluate('(el)=>el.getBoundingClientRect().right<=el.closest(".sidebar").getBoundingClientRect().right+1'),width
            assert f.locator('#portrait-preview').evaluate('(el)=>el.getBoundingClientRect().right<=el.closest(".portrait").getBoundingClientRect().right+1'),width
            if width>600:
                assert f.locator('.portrait-section').evaluate('(el)=>el.getBoundingClientRect().right<=document.querySelector(".library").getBoundingClientRect().left'),width
        page.screenshot(path=str(RESULTS/'protocol-mobile.png'),full_page=True)
        # A rejected host message must visibly pause, never silently launch local Codex/RH.
        tool('control_batch',{'action':'cancel'})
        f.locator('#refresh').click()
        f.locator('#advanced-generation>summary').click()
        f.locator('#build').click();f.locator('#submit').wait_for(state='visible')
        page.evaluate('window.rejectMessage=true')
        f.locator('#submit').click()
        f.locator('#execution-message').get_by_text('fixture host rejected message',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='paused'
        assert 'start_generation' not in page.evaluate('window.toolCalls')
        page.set_viewport_size({'width':1280,'height':1050})
        page.screenshot(path=str(RESULTS/'native-host-message-failed.png'))
        # Standalone browser has no host message channel: preserve the reason after refresh.
        tool('control_batch',{'action':'cancel'});tool('build_queue')
        page.unroute_all(behavior='wait')
        page.goto(URL)
        page.locator('#submit').click()
        page.locator('#execution-message').get_by_text('当前页面没有连接宿主聊天',exact=False).wait_for()
        page.screenshot(path=str(RESULTS/'native-host-browser-no-bridge.png'))
        page.reload()
        page.locator('#execution-message').get_by_text('当前页面没有连接宿主聊天',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='paused'
        assert all(t['attempts']==0 for t in tool('get_state')['tasks'] if t['batchId']==tool('get_state')['batch']['id'])
        assert not errors,errors
        page.unroute_all(behavior='wait')
        browser.close()
    print('PASS: MCP Apps initialize/tools-call/message; file upload; 2x2 queue; edit/delete; actual-byte result return; reopen recovery; widths 1280/736/390/320. Generation was not called. Native Codex host remains a separate acceptance check.')
finally:
    proc.terminate();proc.wait(timeout=10)
