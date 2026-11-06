"""MCP Apps protocol harness against the real local tool server; no image generation."""
from pathlib import Path
import subprocess,os,time,json,urllib.request,tempfile,shutil,base64
from playwright.sync_api import sync_playwright
from browser_support import seed_catalog,dismiss_guide

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
    window.messages=[];window.methods=[];window.toolCalls=[];window.rejectMessage=false;window.agentCheckMode='missing';
    addEventListener('message',async e=>{const m=e.data;if(!m?.jsonrpc)return;window.methods.push(m.method);
      if(m.method==='ui/notifications/size-changed'){document.querySelector('iframe').style.height=m.params.height+'px';return;}
      if(m.id===undefined)return;
      let result;
      try{
        if(m.method==='ui/initialize')result={protocolVersion:m.params.protocolVersion,hostInfo:{name:'Character Studio protocol harness',version:'1.0'},hostCapabilities:{serverTools:{},openLinks:{},message:{text:{}}},hostContext:{theme:'light',displayMode:'inline',availableDisplayModes:['inline','fullscreen']}};
        else if(m.method==='tools/call'){window.toolCalls.push(m.params.name);
          if(window.holdSubmit&&m.params.name==='control_batch'&&m.params.arguments.action==='start')await new Promise(resolve=>window.releaseSubmit=resolve);
          result=await fetch('/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m.params)}).then(r=>r.json());}
        else if(m.method==='ui/message'){if(window.rejectMessage)throw Error('fixture host rejected message');window.messages.push(m.params);const checkId=m.params.content[0].text.match(/checkId 为 ([0-9a-f-]+)/)?.[1];
          if(checkId){
            const report={checkId,agentName:'测试宿主',...(window.agentCheckMode==='missing'?{reason:'缺少图片回填能力'}:{imageTool:'测试工具'})};
            await fetch('/api/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'agent_report_connection',arguments:report})});
          }
          result={};}
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
        page.route('https://ai-pose-depth-gallery.pages.dev/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.route('https://ai-costume-gallery.pages.dev/**',lambda r:r.fulfill(content_type='image/png',body=PNG))
        page.goto(URL+'/host')
        f=page.frame_locator('iframe')
        dismiss_guide(f)
        f.locator('#channel-status').get_by_text('Character Studio protocol harness 可接收消息，Agent 尚未开始等待任务。',exact=True).wait_for(timeout=15000)
        assert f.locator('#provider [data-provider]').all_text_contents()==['当前 Agent 生图','生图 API']
        assert tool('get_state')['draft']['provider']=='codex'
        f.locator('#check-provider').click()
        f.locator('#channel-status').get_by_text('测试宿主：缺少图片回填能力',exact=True).wait_for()
        assert page.evaluate('window.messages.length')==1
        assert tool('get_state')['batch'] is None
        page.evaluate("window.agentCheckMode='ready'")
        f.locator('#check-provider').click()
        f.locator('#channel-status').get_by_text('测试宿主 的生图工具已确认，等待它开始领取任务。',exact=True).wait_for()
        assert page.evaluate('window.messages.length')==2
        assert tool('get_state')['batch'] is None
        f.locator('.generation-choice').screenshot(path=str(RESULTS/'agent-reconnect-ready.png'))
        page.evaluate('window.messages=[]')
        f.locator('[data-select]').first.wait_for(timeout=45000)
        f.locator('#portrait-file').set_input_files(str(uploaded))
        f.locator('#portrait-name').get_by_text(uploaded.name).wait_for()
        def choose(index):
            f.locator('[data-select]').nth(index).click()
            f.locator('#reference-viewer').wait_for()
            f.locator('#reference-confirm').click()
        assert f.locator('#category').input_value()==''
        widths=[]
        for size in (6,9,12):
            f.locator('#gallery-page-size').select_option(str(size))
            f.locator('[data-select]').nth(size-1).wait_for()
            assert f.locator('[data-select]').count()==size
            widths.append(f.locator('[data-select]').first.bounding_box()['width'])
        assert widths[0]>widths[1]>widths[2]
        f.locator('[data-select]').first.click()
        assert f.locator('#costume-count').inner_text()=='0'
        f.locator('#reference-viewer').screenshot(path=str(RESULTS/'reference-confirmation.png'))
        f.locator('#close-reference-viewer').click()
        choose(0);f.locator('#costume-count').get_by_text('1',exact=True).wait_for()
        choose(1);f.locator('#costume-count').get_by_text('2',exact=True).wait_for()
        f.locator('#open-disclaimer').click()
        f.locator('#disclaimer').wait_for()
        f.locator('#close-disclaimer').click()
        f.locator('#pose-tab').click();f.locator('[data-select]').first.wait_for()
        assert f.locator('#category').input_value()==''
        assert f.locator('#angle').input_value()=='正面'
        assert set(f.locator('#gallery .caption span:last-child').all_text_contents())=={'正面'}
        page.screenshot(path=str(RESULTS/'pose-default-front.png'))
        choose(0);f.locator('#pose-count').get_by_text('1',exact=True).wait_for()
        choose(1);f.locator('#pose-count').get_by_text('2',exact=True).wait_for()
        f.locator('#category').select_option('');f.locator('[data-select]').first.wait_for()
        assert f.locator('#category').input_value()==''
        f.locator('#notes').fill('协议验证：不执行生图')
        f.locator('#provider-hint').get_by_text('使用当前聊天里 Agent 已有的生图能力',exact=False).wait_for()
        f.locator('#channel-status').get_by_text('测试宿主 的生图工具已确认，等待它开始领取任务。',exact=True).wait_for()
        assert f.locator('#provider-preset').is_disabled()
        page.screenshot(path=str(RESULTS/'agent-channel-desktop.png'))
        f.locator('#build').click();f.locator('.preview-card').first.wait_for()
        assert f.locator('.preview-card').count()==4
        f.locator('#combination-preview').screenshot(path=str(RESULTS/'generation-preview.png'))
        f.locator('[data-delete]').first.click();f.locator('#preview-count').get_by_text('共 3 张图片',exact=False).wait_for()
        f.locator('[data-edit]').first.click();f.locator('#edit-prompt').fill('这是一条独立任务的验证提示词');f.locator('#save-task').click()
        f.locator('#close-preview').click()
        f.locator('#build').click()
        assert f.locator('.preview-card').count()==3
        f.locator('[data-edit]').first.click()
        assert f.locator('#edit-prompt').input_value()=='这是一条独立任务的验证提示词'
        f.locator('#close-editor').click()
        f.locator('#close-preview').click()
        page.evaluate('window.holdSubmit=true')
        f.locator('#submit').click()
        f.locator('#execution-message').get_by_text('正在保存设置并准备任务',exact=False).wait_for()
        page.wait_for_function('typeof window.releaseSubmit==="function"')
        page.evaluate('window.holdSubmit=false;window.releaseSubmit()')
        page.wait_for_function('window.messages.length===1')
        assert 'agent_wait' in page.evaluate('window.messages[0].content[0].text')
        assert 'ui/initialize' in page.evaluate('window.methods')
        # Inject only pre-cached reference file paths into this isolated test data.
        state=tool('get_state')
        saved=json.loads((DATA/'state.json').read_text(encoding='utf-8'))
        for a in saved['assets'].values():
            if a['kind'] in ['pose','costume']:a.update(path=str(uploaded),mime='image/png')
        (DATA/'state.json').write_text(json.dumps(saved),encoding='utf-8')
        task=tool('claim_next_task')['task'];assert len(task['references'])==3
        f.locator('#submit').get_by_text('等待 Agent 确认',exact=False).wait_for()
        tool('agent_ack_task',{'taskId':task['id']})
        f.locator('#submit').get_by_text('正在生成',exact=False).wait_for()
        tool('control_batch',{'action':'pause'})
        tool('record_result',{'taskId':task['id'],'filePath':str(uploaded)})
        f.locator('#refresh').click();f.locator('#success-count').get_by_text('1',exact=True).wait_for()
        assert not f.locator('#success-history').evaluate('(e)=>e.open')
        assert f.locator('#jobs [data-result-image]').count()==0
        f.locator('#open-success-history').click();f.locator('[data-result-image]').first.wait_for()
        f.locator('#close-success-history').click()
        assert f.locator('#continue').is_visible()
        page.reload();f.locator('#portrait-name').get_by_text(uploaded.name).wait_for(timeout=20000)
        f.locator('#success-count').get_by_text('1',exact=True).wait_for()
        assert not f.locator('#success-history').evaluate('(e)=>e.open')
        f.locator('#open-success-history').click()
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
        f.locator('#close-success-history').click()
        # A rejected host message must visibly pause, never silently launch local Codex/RH.
        tool('control_batch',{'action':'cancel'})
        f.locator('#refresh').click()
        f.locator('#build').click();f.locator('#close-preview').click()
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
        page.locator('#check-provider').click()
        page.locator('#channel-status').get_by_text('连接后会继续待生成任务。',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='draft'
        page.locator('#submit').click()
        page.locator('#execution-message').get_by_text('Agent 尚未领取',exact=False).wait_for()
        page.screenshot(path=str(RESULTS/'native-host-browser-no-bridge.png'))
        page.reload()
        page.locator('#execution-message').get_by_text('Agent 尚未领取',exact=False).wait_for()
        assert tool('get_state')['batch']['status']=='queued'
        assert all(t['attempts']==0 for t in tool('get_state')['tasks'] if t['batchId']==tool('get_state')['batch']['id'])
        assert not errors,errors
        page.unroute_all(behavior='wait')
        browser.close()
    print('PASS: MCP Apps initialize/tools-call/message; file upload; 2x2 queue; edit/delete; actual-byte result return; reopen recovery; widths 1280/736/390/320. Generation was not called. Native Codex host remains a separate acceptance check.')
finally:
    proc.terminate();proc.wait(timeout=10)
