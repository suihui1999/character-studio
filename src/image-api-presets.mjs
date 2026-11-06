export const IMAGE_API_SERVICES=[
  {id:'image-openai',name:'OpenAI',baseUrl:'https://api.openai.com/v1',protocol:'openai-json',keyUrl:'https://platform.openai.com/api-keys',docsUrl:'https://developers.openai.com/api/docs/guides/image-generation',steps:['登录 OpenAI 开发者平台，打开 API keys。','点击 Create new secret key，复制完整 Key；在 Billing 中配置 API 余额。','回工作台点击「管理 API Key」，粘贴后验证并保存。'],note:'ChatGPT 订阅和 API 余额分开计费。'},
  {id:'image-gemini',name:'Google Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',protocol:'gemini',keyUrl:'https://aistudio.google.com/api-keys',docsUrl:'https://ai.google.dev/gemini-api/docs/generate-content/image-generation',steps:['登录 Google AI Studio，打开 API keys。','创建或选择一个项目，创建 API Key 并复制；按所选模型要求配置结算。','回工作台点击「管理 API Key」，粘贴后验证并保存。'],note:'模型可用地区、额度和费用以 Google 账号页面为准。'},
  {id:'image-seedream',name:'火山方舟 Seedream',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',protocol:'seedream',keyUrl:'https://ark.volcengine.com/region:cn-beijing/apikey',docsUrl:'https://docs.volcengine.com/docs/ark/image-generation-tutorial?lang=zh',steps:['注册并登录火山方舟，打开 API Key 管理。','创建并复制 API Key，在模型服务中开通要使用的 Seedream 模型。','回工作台选择已开通的模型，点击「管理 API Key」粘贴、验证并保存。'],note:'火山方舟 API Key 和豆包聊天账号的生图额度分开管理。'},
  {id:'image-custom',name:'自定义兼容 API',baseUrl:'',protocol:'openai-multipart',keyUrl:null,docsUrl:null,steps:['在你的 API 服务商后台创建并复制 API Key。','回工作台点击「管理 API Key」，填写服务商提供的接口地址、协议和模型 ID。','粘贴 Key，验证并保存。服务商需要支持多图参考输入。'],note:'接口地址填写到 /v1 等版本前缀，不用填写 /images/edits。'}
];
export const isImageApi=provider=>IMAGE_API_SERVICES.some(s=>s.id===provider);
export const imageApiService=provider=>IMAGE_API_SERVICES.find(s=>s.id===provider);
const ratios=['3:4','1:1','4:3','2:3','3:2','9:16','16:9'];
const preset=(provider,model,name,extra={})=>({id:provider+':'+model,provider,kind:'image-api',model,name,nodes:[],allowPartialReferences:true,ratios,...extra});
export const IMAGE_API_PRESETS=[
  preset('image-openai','gpt-image-2','GPT Image 2'),
  preset('image-openai','gpt-image-2.5-sunburst','GPT Image 2.5 Sunburst'),
  preset('image-openai','gpt-image-1.5','GPT Image 1.5',{ratios:['2:3','1:1','3:2']}),
  preset('image-gemini','gemini-3.1-flash-image','Nano Banana 2 · Gemini 3.1 Flash Image'),
  preset('image-gemini','gemini-3-pro-image','Nano Banana Pro · Gemini 3 Pro Image'),
  preset('image-gemini','gemini-2.5-flash-image','Nano Banana · Gemini 2.5 Flash Image'),
  preset('image-seedream','doubao-seedream-4-5-251128','Seedream 4.5'),
  preset('image-seedream','doubao-seedream-5-0-260128','Seedream 5.0 Lite'),
  preset('image-seedream','doubao-seedream-4-0-250828','Seedream 4.0'),
  preset('image-custom','custom','自定义模型',{id:'image-custom:default',model:'',baseUrl:'',protocol:'openai-multipart'})
];
export function validateImageApiPreset(value,{requireConfigured=false}={}){
  const service=imageApiService(value?.provider);
  if(!service)throw Error('未知生图 API 服务');
  const builtin=IMAGE_API_PRESETS.find(p=>p.id===value.id&&p.provider===value.provider);
  if(value.provider!=='image-custom'){
    if(!builtin||value.model!==builtin.model)throw Error('请选择预设中的生图模型');
    return structuredClone({...builtin,builtin:true});
  }
  const model=String(value.model||'').trim(),baseUrl=String(value.baseUrl||'').trim().replace(/\/+$/,'');
  if(model.length>150||/[\x00-\x20/\\?#]/.test(model))throw Error('模型 ID 格式无效');
  if(baseUrl){let url;try{url=new URL(baseUrl);}catch{throw Error('请填写完整的 API 接口地址');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('API 地址需使用 HTTPS，且不包含账号、密钥或查询参数');
    if(/\/(images\/(?:edits|generations)|models\/[^/]+:generateContent)$/.test(url.pathname))throw Error('接口地址填写到版本前缀，例如 https://服务商域名/v1');
  }
  if(!['openai-json','openai-multipart','gemini','seedream'].includes(value.protocol))throw Error('请选择支持的 API 协议');
  if(requireConfigured&&(!model||!baseUrl))throw Error('请在「管理 API Key」中填写接口地址和模型 ID');
  return {...IMAGE_API_PRESETS.at(-1),model,baseUrl,protocol:value.protocol,...(model==='gpt-image-1.5'?{ratios:['2:3','1:1','3:2']}:{})};
}
