import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const client=new Client({name:'karkas-demo-agent',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],cwd:root,env:{...process.env},stderr:'inherit'});
try{
 await client.connect(transport);
 const call=async(name,args={})=>{const response=await client.callTool({name:'karkas_'+name,arguments:args});if(response.isError)throw Error(JSON.stringify(response.structuredContent));return response.structuredContent;};
 await call('catalog');
 const created=await call('generate',{name:'MCP · четыре комнаты',width:12,depth:8,levels:[{height:2.8}],rooms:[{name:'Кухня-гостиная',area:24,minWidth:3},{name:'Спальня',area:12,minWidth:2.5},{name:'Кабинет',area:10},{name:'Санузел',area:6}],roof:{shape:'gable',pitch:25,pitchRight:30,framing:'truss'},sections:{walls:'50x150',floor:'50x250',roof:'50x200',roofWeb:'50x100',grillage:'50x200'},bracing:{method:'sheathing'},foundation:{spacing:2,capacity:40,grillage:{plies:3,capSize:250}}});
 const project_id=created.project_id;
 const compared=await call('compare_variants',{project_id,variants:[{name:'Пакет 3 доски',operations:[{op:'replace',path:'/foundation/grillage/plies',value:3}]},{name:'Пакет 4 доски',operations:[{op:'replace',path:'/foundation/grillage/plies',value:4}]}]});
 const selected=compared.variants[compared.selectedIndex];
 const changed=await call('apply_patch',{project_id,expected_revision:1,operations:selected.operations});
 const analysis=await call('analyze',{project_id,revision:changed.revision});
 const exported=await call('export',{project_id,revision:changed.revision});
 console.log(JSON.stringify({project_id,revision:changed.revision,hash:changed.hash,selectedVariant:selected.name,summary:analysis.summary,artifacts:exported.artifacts},null,2));
 if(process.argv.includes('--serve')){
  const preview=await call('preview',{project_id,revision:changed.revision});console.log('PREVIEW '+preview.url);
  await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }
}finally{await client.close();await transport.close();}
