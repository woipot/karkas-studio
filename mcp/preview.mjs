import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
/** A human can GET a frozen calculation revision. No editing API exists. */
export function createReadOnlyPreview(engine){let listener,port;
 return async(projectId,revision)=>{
  const report=await engine.analyze(projectId,revision);
  if(!listener){listener=createServer(async(req,res)=>{try{
    const host=req.headers.host??'';if(!/^127\.0\.0\.1:\d+$/.test(host)){res.writeHead(403);res.end();return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});res.end('Read-only viewer');return;}
    const url=new URL(req.url,'http://'+host);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(url.pathname==='/engine-report.json'){
      const id=url.searchParams.get('project'),rev=Number(url.searchParams.get('revision'));if(!id||!Number.isInteger(rev)||rev<1){res.writeHead(400);res.end('Choose a project revision through MCP.');return;}
      const value=await engine.analyze(id,rev);res.writeHead(200,{'Content-Type':mime['.json']});res.end(req.method==='HEAD'?'':JSON.stringify(value));return;
    }
    const filename=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/,''),target=path.resolve(dist,filename);
    if(!target.startsWith(path.resolve(dist)+path.sep)){res.writeHead(404);res.end();return;}
    const data=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]??'application/octet-stream'});res.end(req.method==='HEAD'?'':data);
   }catch(e){res.writeHead(e.code==='NOT_FOUND'||e.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});res.end(e.message);}});
   await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});port=listener.address().port;listener.unref();listener.on('connection',socket=>socket.unref());
  }
  return {project_id:projectId,revision:report.engine.revision,hash:report.engine.hash,url:`http://127.0.0.1:${port}/?project=${encodeURIComponent(projectId)}&revision=${report.engine.revision}`,mode:'read_only',note:'Local viewer is available while this MCP server runs. All changes must use MCP tools; this URL exposes no editing API.'};
 };
}
