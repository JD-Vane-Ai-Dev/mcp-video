import {createServer} from 'node:http';
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {readFile, access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const PORT=Number(process.env.PORT||10000);
const TOKEN=process.env.REMOTION_API_TOKEN||'';
const jobs=new Map();
let bundlePromise=null;
let busy=false;
const PROTOCOL='2025-03-26';
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const tools=[
 {name:'list_templates',description:'List real Remotion MP4 video templates and supported options.',inputSchema:{type:'object',properties:{}}},
 {name:'render_promo_video',description:'Launch a real Remotion MP4 render. Returns a job_id; call get_render_status until complete.',inputSchema:{type:'object',properties:{
  title:{type:'string',maxLength:160},subtitle:{type:'string',maxLength:260},brand:{type:'string',maxLength:100},ending:{type:'string',maxLength:160},
  format:{type:'string',enum:['Vertical','Landscape','Square']},accent:{type:'string',pattern:'^#[0-9A-Fa-f]{6}$'},
  background:{type:'string',pattern:'^#[0-9A-Fa-f]{6}$'},scale:{type:'number',minimum:.25,maximum:1},duration_seconds:{type:'number',minimum:1,maximum:10}
 },required:['title']}},
 {name:'get_render_status',description:'Read a render job status and obtain a private MP4 download link when it finishes.',inputSchema:{type:'object',properties:{job_id:{type:'string'}},required:['job_id']}}
];
function send(res,status,value,headers={}){res.writeHead(status,{...JSON_HEADERS,...headers});res.end(JSON.stringify(value));}
function same(a,b){if(!a||!b)return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function authorized(req){return Boolean(TOKEN)&&same(req.headers.authorization||'','Bearer '+TOKEN);}
function clean(v,max,fallback=''){return typeof v==='string'?v.slice(0,max):fallback;}
function color(v,fallback){return typeof v==='string'&&/^#[0-9a-fA-F]{6}$/.test(v)?v:fallback;}
function publicUrl(req){const host=req.headers['x-forwarded-host']||req.headers.host;const proto=req.headers['x-forwarded-proto']||'https';return proto+'://'+host;}
function jobInfo(id,base){const job=jobs.get(id);if(!job)return {error:'Unknown job_id'};const {status,error,createdAt}=job;return {job_id:id,status,error,created_at:createdAt,...(status==='complete'?{download_url:base+'/videos/'+id+'.mp4?download_key='+job.downloadKey}:{})};}
async function runJob(id,args){
 busy=true;const job=jobs.get(id);job.status='rendering';
 try{
  if(!bundlePromise) bundlePromise=bundle({entryPoint:path.join(process.cwd(),'src/index.jsx')});
  const serveUrl=await bundlePromise;
  const inputProps={
   title:clean(args.title,160,'Your Story'),subtitle:clean(args.subtitle,260,''),brand:clean(args.brand,100,'YOUR BRAND'),
   ending:clean(args.ending,160,'Created with Remotion'),background:color(args.background,'#101026'),accent:color(args.accent,'#8B5CF6')
  };
  const format=['Vertical','Landscape','Square'].includes(args.format)?args.format:'Vertical';
  const composition=await selectComposition({serveUrl,id:format,inputProps});
  const seconds=Number.isFinite(args.duration_seconds)&&args.duration_seconds>=1&&args.duration_seconds<=10?args.duration_seconds:3;
  composition.durationInFrames=Math.round(seconds*composition.fps);
  const outputLocation=path.join(os.tmpdir(),'remotion-'+id+'.mp4');
  const scale=Number.isFinite(args.scale)&&args.scale>=.25&&args.scale<=1?args.scale:.5;
  await renderMedia({composition,serveUrl,codec:'h264',outputLocation,inputProps,scale,concurrency:1,logLevel:'error'});
  await access(outputLocation);job.status='complete';job.file=outputLocation;
 }catch(e){job.status='failed';job.error=String(e&&e.message||e).slice(0,1800);console.error('Remotion render failed:',job.error);}finally{busy=false;}
}
function toolResult(value,error=false){return {content:[{type:'text',text:JSON.stringify(value)}],...(error?{isError:true}:{})};}
async function executeTool(name,args,base){
 if(name==='list_templates')return toolResult({formats:['Vertical','Landscape','Square'],default_seconds:3,seconds_range:[1,10],frames_per_second:30,default_scale:.5,codec:'h264',fields:['title','subtitle','brand','ending','accent','background','format','scale','duration_seconds'],concurrent_jobs:1,storage:'ephemeral; download immediately'});
 if(name==='get_render_status'){const i=jobInfo(args.job_id||'',base);return toolResult(i,Boolean(i.error));}
 if(name==='render_promo_video'){
  if(busy)return toolResult({error:'A render is already in progress; retry once it completes.'},true);
  if(typeof args.title!=='string'||!args.title.trim())return toolResult({error:'A non-empty title is required.'},true);
  const id=randomUUID();jobs.set(id,{status:'queued',createdAt:new Date().toISOString(),downloadKey:randomUUID()});
  void runJob(id,args);
  return toolResult(jobInfo(id,base));
 }
 return toolResult({error:'Unknown tool'},true);
}
async function onMcp(body,base){
 if(!body||typeof body!=='object')return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}};
 const {id,method,params={}}=body;
 if(typeof id==='undefined')return null;
 if(method==='initialize')return {jsonrpc:'2.0',id,result:{protocolVersion:PROTOCOL,capabilities:{tools:{listChanged:false}},serverInfo:{name:'Remotion Video Renderer',version:'0.1.1'}}};
 if(method==='ping')return {jsonrpc:'2.0',id,result:{}};
 if(method==='tools/list')return {jsonrpc:'2.0',id,result:{tools}};
 if(method==='tools/call'){
  try{return {jsonrpc:'2.0',id,result:await executeTool(params.name,params.arguments||{},base)}}catch(e){return {jsonrpc:'2.0',id,result:toolResult({error:String(e)},true)};}
 }
 return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
}
createServer(async(req,res)=>{
 const base=publicUrl(req);const url=new URL(req.url||'/',base);
 if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{service:'remotion-video-renderer',version:'0.1.1',active:busy,configured:Boolean(TOKEN)});
 if(req.method==='GET'&&url.pathname.startsWith('/videos/')){
  const id=url.pathname.slice(8).replace(/\.mp4$/,'');const job=jobs.get(id);
  if(!job||job.status!=='complete'||!same(url.searchParams.get('download_key')||'',job.downloadKey))return send(res,404,{error:'Video unavailable'});
  try{const data=await readFile(job.file);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':data.length,'Cache-Control':'private, max-age=60','Content-Disposition':'attachment; filename="remotion-'+id+'.mp4"'});res.end(data);return;}catch{return send(res,404,{error:'Video expired'});}
 }
 if(!authorized(req))return send(res,TOKEN?401:503,{error:TOKEN?'Unauthorized':'Service not configured'});
 if(url.pathname!=='/mcp'||req.method!=='POST')return send(res,404,{error:'Not found'});
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)return send(res,413,{error:'Request too large'});}
 try{
  const request=JSON.parse(raw);
  if(Array.isArray(request))return send(res,400,{error:'Batch unsupported'});
  const answer=await onMcp(request,base);
  if(answer===null){res.writeHead(202);res.end();return;}
  return send(res,200,answer,{'Mcp-Session-Id':'stateless'});
 }catch(e){return send(res,400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:String(e&&e.message||e)} });}
}).listen(PORT,'0.0.0.0',()=>console.log('Remotion MCP gateway listening on '+PORT));
