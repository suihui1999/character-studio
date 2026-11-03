const resolutionOptions=[
  '1:1 (Square)',
  '2:3 (Portrait Photo)',
  '3:2 (Photo)',
  '3:4 (Portrait Standard)',
  '4:3 (Standard)',
  '9:16 (Portrait Widescreen)',
  '16:9 (Widescreen)',
  '21:9 (Ultrawide)'
].map(fieldValue=>({value:fieldValue.split(' ')[0],fieldValue}));

export const RUNNINGHUB_DEFAULTS=[
  ['cn','2117565399293321218'],
  ['global','2117590622597468162']
].map(([site,remoteId])=>({
  id:'rh-'+site+'-qwen21-three-reference',
  provider:'runninghub-'+site,
  kind:'workflow',
  apiVersion:2,
  remoteId,
  name:'Qwen 2.1 换装与姿势',
  nodes:[
    {nodeId:'1',fieldName:'image',source:'portrait'},
    {nodeId:'2',fieldName:'image',source:'costume'},
    {nodeId:'3',fieldName:'image',source:'pose'},
    {nodeId:'10',fieldName:'prompt',source:'prompt'},
    {nodeId:'4',fieldName:'aspect_ratio',source:'ratio',value:'3:4',options:resolutionOptions}
  ]
}));
