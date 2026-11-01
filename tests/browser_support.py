"""Synthetic catalog metadata. Browser tests never need downloaded site indexes."""
import json
def seed_catalog(root):
    folder=root/'catalog';folder.mkdir(exist_ok=True)
    for kind,count in [('costume',24),('pose',24)]:
        origin='https://ai-costume-gallery.pages.dev/' if kind=='costume' else 'https://ai-pose-depth-gallery.pages.dev/'
        records=[]
        for n in range(1,count+1):
            ident=f'SPR-TEST-{n:04d}' if kind=='costume' else f'full_single_P{n:03d}_front'
            records.append({'id':ident,'kind':kind,'name':f'日常服装测试 {n}' if kind=='costume' else f'普通站姿测试 {n}','category':'春季' if kind=='costume' else '站姿','group':'protocol-fixture','angle':'' if kind=='costume' else '正面','url':origin+'img/'+ident+'.png','thumb':origin+'thumbs/'+ident+'.png'})
        (folder/(kind+'.json')).write_text(json.dumps(records,ensure_ascii=False),encoding='utf-8')
