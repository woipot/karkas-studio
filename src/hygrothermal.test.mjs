import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeEnvelope,dewPointTemperature,saturationPressure,HygrothermalInputError} from './hygrothermal.js';
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} ≠ ${b}`);
const base=()=>({indoor:{temperature:21,rh:40},outdoor:{temperature:-26,rh:80},Rsi:.13,Rse:.04,layers:[{id:'gypsum',name:'Гипс',thickness:.013,lambda:.25,mu:10},{id:'insulation',name:'Вата',thickness:.2,lambda:.037,mu:1},{id:'osb',name:'ХолоднаяOSB',thickness:.012,lambda:.13,mu:200}]});
function finiteTree(x){if(typeof x==='number')assert.ok(Number.isFinite(x),`non-finite ${x}`);else if(Array.isArray(x))x.forEach(finiteTree);else if(x&&typeof x==='object')Object.values(x).forEach(finiteTree);}

test('analytic R/U, heat flux, layer temperatures and sd-weighted vapour pressure agree',()=>{
  const r=analyzeEnvelope({indoor:{temperature:20,rh:40},outdoor:{temperature:0,rh:80},Rsi:.1,Rse:.2,layers:[{id:'a',thickness:.1,lambda:.1,sd:1},{id:'b',thickness:.2,lambda:.2,sd:2}]});
  near(r.Rtotal,2.3);near(r.U,1/2.3);near(r.heatFlux,20/2.3);near(r.internalSurfaceTemp,20-20*.1/2.3);near(r.interfaces[1].temperature,20-20*1.1/2.3);near(r.externalSurfaceTemp,20*.2/2.3);near(r.totalThickness,.3);near(r.totalSd,3);
  const pi=saturationPressure(20)*.4,pe=saturationPressure(0)*.8;near(r.interfaces[1].pVapor,pi-(pi-pe)/3);near(r.interfaces.at(-1).pVapor,pe);
});

test('dew point and saturation use documented water/ice formulae',()=>{
  near(dewPointTemperature(21,40),6.87651276026734);near(dewPointTemperature(21,100),21);near(saturationPressure(0),611.2);near(saturationPressure(20),2332.5960220978072,1e-6);near(saturationPressure(-20),103.26096299134606,1e-6);
  const r=analyzeEnvelope({...base(),indoor:{temperature:-10,rh:80}});assert.equal(r.dewPointKind,'frost');assert.ok(r.dewPointIndoor< -10);finiteTree(r);
});

test('a cold high-sd outer OSB without a warm barrier triggers interstitial risk',()=>{
  const r=analyzeEnvelope(base());assert.equal(r.status,'risk');assert.equal(r.certified,false);assert.ok(r.worst.pVapor>r.worst.pSat);assert.ok(r.worst.temperature<0);assert.ok(r.checks.some(c=>c.id==='envelope-interstitial-condensation'&&c.status==='fail'));assert.ok(r.samples.some(s=>s.insideLayer&&s.condensation));finiteTree(r);
});

test('warm sd50 barrier drops vapour pressure downstream rather than moving a fictitious fixed dew-point layer',()=>{
  const a=base(),unprotected=analyzeEnvelope(a);a.layers.splice(1,0,{id:'vcl',name:'Пароизоляция',thickness:.0002,lambda:.33,sd:50});const protectedResult=analyzeEnvelope(a);
  const before=unprotected.interfaces.find(i=>i.layerId==='insulation'),after=protectedResult.interfaces.find(i=>i.layerId==='insulation');assert.ok(after.pVapor<before.pVapor*.2);assert.ok(protectedResult.interfaces.find(i=>i.layerId==='vcl').pVapor<protectedResult.interfaces[0].pVapor);near(protectedResult.dewPointIndoor,unprotected.dewPointIndoor);
});

test('condensation can occur strictly inside a thick layer while both boundary interfaces are below saturation',()=>{
  const r=analyzeEnvelope({indoor:{temperature:20,rh:95},outdoor:{temperature:0,rh:95},Rsi:0,Rse:0,layers:[{id:'bulk',thickness:.2,lambda:.2,sd:2}]});
  assert.ok(r.interfaces.every(i=>!i.condensation));assert.ok(r.worst.insideLayer);assert.ok(r.worst.fraction>0&&r.worst.fraction<1);assert.ok(r.worst.excessPressure>150);assert.ok(r.samples.length>=34,'interior maximum added to32subinterval grid');assert.equal(r.checks.find(c=>c.id==='envelope-interstitial-condensation').status,'fail');
});

test('surface RH80 mould indicator is separate from surface condensation',()=>{
  const r=analyzeEnvelope({indoor:{temperature:21,rh:40},outdoor:{temperature:-10,rh:80},layers:[{id:'thin',thickness:.15,lambda:1,mu:10}]});
  assert.ok(r.surfaceRH>80&&r.surfaceRH<100);assert.equal(r.checks.find(c=>c.id==='envelope-surface-rh80').status,'fail');assert.equal(r.checks.find(c=>c.id==='envelope-surface-condensation').status,'pass');assert.equal(r.status,'risk');
});

test('benign steady screen never becomes global building or annual-moisture approval',()=>{
  const r=analyzeEnvelope({indoor:{temperature:21,rh:30},outdoor:{temperature:10,rh:60},layers:[{id:'insulation',thickness:.2,lambda:.04,mu:1}]});
  assert.equal(r.status,'screen_pass');assert.equal(r.certified,false);assert.ok(r.checks.some(c=>c.id==='envelope-annual-moisture'&&c.status==='unverified'));assert.ok(r.checks.some(c=>c.id==='envelope-air-sealing'&&c.status==='unverified'));assert.ok(r.checks.some(c=>c.id==='envelope-real-bridges'&&c.status==='unverified'));
});

test('parallel wood thermal path increases U and lowers the inner surface temperature without inventing wood vapour resistance',()=>{
  const input={indoor:{temperature:21,rh:30},outdoor:{temperature:10,rh:60},layers:[{id:'insulation',thickness:.2,lambda:.04,mu:1}],framingFraction:.15,framingLambda:.13,framingLayerIds:['insulation']},r=analyzeEnvelope(input);
  near(r.Rtotal,5.17);near(r.U,1/5.17);near(r.thermalBridges.Rframing,.17+.2/.13);near(r.Ueffective,.85/5.17+.15/(.17+.2/.13));assert.ok(r.Ueffective>r.U);assert.ok(r.framingPath.internalSurfaceTemp<r.internalSurfaceTemp);assert.equal(r.framingPath.vaporModel,'not_evaluated');
});

test('zero RH and zero sd have explicit finite outcomes rather than NaN/Infinity',()=>{
  const dry=analyzeEnvelope({indoor:{temperature:21,rh:0},outdoor:{temperature:-26,rh:0},layers:[{id:'open',thickness:.2,lambda:.04,sd:0}]});assert.equal(dry.dewPointIndoor,null);assert.equal(dry.dewPointKind,'none');assert.ok(dry.samples.every(s=>s.pVapor===0&&s.rh===0));finiteTree(dry);
  const input=base();input.layers.forEach(l=>{l.sd=0;});assert.throws(()=>analyzeEnvelope(input),HygrothermalInputError);
  const openLayer=base();openLayer.layers[1].sd=0;finiteTree(analyzeEnvelope(openLayer));
  finiteTree(analyzeEnvelope({...base(),indoor:{temperature:21,rh:Number.MIN_VALUE}}));
});

test('explicit sd overrides mu*d transparently and no input object is mutated',()=>{
  const input=base();input.layers[0].sd=10;const before=JSON.stringify(input),r=analyzeEnvelope(input);near(r.layers[0].sd,10);assert.equal(r.layers[0].sdSource,'explicit_sd');assert.ok(r.warnings.some(w=>w.includes('явноеsd')));assert.equal(JSON.stringify(input),before);
});

test('invalid humidity/materials/framing and overflow produce friendly diagnostics',()=>{
  const invalid=[null,{}, {...base(),indoor:{temperature:21,rh:101}},{...base(),outdoor:{temperature:-80,rh:80}},{...base(),Rsi:-.1},{...base(),layers:[{id:'bad',thickness:0,lambda:.1,mu:1}]},{...base(),layers:[{id:'bad',thickness:.1,lambda:NaN,mu:1}]},{...base(),layers:[{id:'bad',thickness:.1,lambda:.1}]},{...base(),layers:[{id:'bad',thickness:.1,lambda:.1,sd:-1}]},{...base(),framingFraction:1.1,framingLayerIds:['insulation']},{...base(),framingLayerIds:['missing']},{...base(),Rsi:0,Rse:0,layers:[{id:'bad',thickness:1e-308,lambda:1,sd:1}]},{...base(),layers:[{id:'a',thickness:1e308,lambda:1e308,sd:1},{id:'b',thickness:1e308,lambda:1e308,sd:1}]}];
  for(const input of invalid)assert.throws(()=>analyzeEnvelope(input),e=>e instanceof HygrothermalInputError&&e.errors.length>0);
});
