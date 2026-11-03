import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {appendFile,mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const config=JSON.parse(execFileSync('codex',['mcp','get','karkas-engine','--json'],{encoding:'utf8'}));
const destination=path.resolve(process.argv[2]??'work/mcp-session.jsonl');await mkdir(path.dirname(destination),{recursive:true});
let sequence=0,previousHash='0'.repeat(64);try{const rows=(await readFile(destination,'utf8')).trim().split('\n');for(const line of rows){const prior=JSON.parse(line);const payload={...prior.payload,sequence:++sequence};const hash=createHash('sha256').update(previousHash+'\n'+JSON.stringify(payload)).digest('hex');previousHash=hash;}const last=JSON.parse(rows.at(-1));previousHash=last.hash;sequence=last.payload.sequence;}catch{}
async function record(event){const payload={sequence:++sequence,time:new Date().toISOString(),...event},json=JSON.stringify(payload),hash=createHash('sha256').update(previousHash+'\n'+json).digest('hex');await appendFile(destination,JSON.stringify({previousHash,hash,payload})+'\n');previousHash=hash;return hash;}
const transport=new StdioClientTransport({command:config.transport.command,args:config.transport.args,cwd:config.transport.cwd??undefined,env:{...process.env,...config.transport.env},stderr:'pipe'});
transport.stderr?.on('data',data=>process.stderr.write(data));
const client=new Client({name:'codex-karkas-agent-session',version:'1.0.0'});
await client.connect(transport);const catalog=await client.listTools();
await record({method:'initialize+tools/list',server:client.getServerVersion(),tools:catalog.tools.map(t=>({name:t.name,inputSchema:t.inputSchema}))});
await writeFile(path.join(path.dirname(destination),'mcp-tools.json'),JSON.stringify(catalog,null,2));
process.stdout.write(JSON.stringify({connected:true,configName:config.name,server:client.getServerVersion(),tools:catalog.tools.map(t=>t.name),journal:destination})+'\n');
if(process.stdin.isTTY)process.stdin.setRawMode(true);
const rl=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
try{for await(const line of rl){if(!line.trim())continue;let request;try{
 request=JSON.parse(line);if(request.requestFile)request=JSON.parse(await readFile(request.requestFile,'utf8'));if(request.method==='close')break;
 const started=Date.now(),response=await client.callTool({name:request.name,arguments:request.arguments??{}},{timeout:180000});
 const hash=await record({method:'tools/call',request:{name:request.name,arguments:request.arguments??{}},response,durationMs:Date.now()-started});
 const value=response.structuredContent??response;let view=value;
 if(Array.isArray(request.fields))view=Object.fromEntries(request.fields.map(k=>[k,k.split('.').reduce((p,q)=>p?.[q],value)]));
 process.stdout.write(JSON.stringify({request:request.name,isError:response.isError??false,journalHash:hash,result:view})+'\n');
 }catch(e){await record({method:'session_error',request,error:e.message});process.stdout.write(JSON.stringify({error:e.message})+'\n');}}
}finally{rl.close();await client.close();await transport.close();if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();}
