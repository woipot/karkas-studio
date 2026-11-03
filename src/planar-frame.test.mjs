import test from 'node:test';
import assert from 'node:assert/strict';
import {solveFrame2D} from './planar-frame.js';
// Primary closed-form references: AWC Design Aid6 beam formula diagrams;
// https://web-media.awc.org/wp-content/uploads/2021/12/17210710/AWC-DA6-BeamFormulas-0710.pdf
// Frame DOFs/local-global transform: TU Delft computational modelling,
// https://teachbooks.tudelft.nl/computational-modelling/structural_linear/space_frame.html
const near=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<t,`${a} != ${b}`);
const node=(id,x,y=0)=>({id,x,y}),element=(id,nodeA,nodeB,extra={})=>({id,nodeA,nodeB,b:100,h:200,E:10000,...extra});
const solved=p=>{const r=solveFrame2D(p);assert.equal(r.stable,true,r.errors.join('; '));for(const k of ['fx','fy','moment'])near(r.equilibrium[k],0,1e-7);assert.equal(r.certified,false);return r;};
const displacement=(r,id)=>r.displacements.find(q=>q.node===id),reaction=(r,id)=>r.reactions.find(q=>q.node===id);
const cantilever=()=>({nodes:[node('A',0),node('B',3)],elements:[element('E','A','B')],supports:[{node:'A',ux:true,uy:true,rz:true}],nodalLoads:[{node:'B',fy:-2}]});

test('cantilever end force matches PL³/3EI and PL²/2EI with kN/m/mm/MPa conversion',()=>{
  const r=solved(cantilever()),e=r.elementResults[0];near(e.EA,200000);near(e.EI,666.6666666666666);near(displacement(r,'B').uy,-.027);near(displacement(r,'B').rz,-.0135);near(reaction(r,'A').fy,2);near(reaction(r,'A').mz,6);near(e.maxMoment,6);near(e.maxShear,2);near(e.ends.a.M,-6);near(e.ends.b.M,0);near(e.maxDeflection,.027);near(e.at(3).uy,-.027);
});

test('cantilever UDL includes consistent nodal moments and exact quartic deflection between nodes',()=>{
  const p=cantilever();p.nodes[1].x=4;p.nodalLoads=[];p.elements[0].qy=-1.5;
  const r=solved(p),e=r.elementResults[0];near(reaction(r,'A').fy,6);near(reaction(r,'A').mz,12);near(e.maxMoment,12);near(e.at(4).uy,-.072);near(e.at(4).rotation,-.024);near(e.maxDeflection,.072);
});

test('one simply supported element recovers the exact UDL sag and 5mm midpoint displacement',()=>{
  const r=solved({nodes:[node('A',0),node('B',4)],elements:[element('E','A','B',{qy:-1})],supports:[{node:'A',ux:true,uy:true},{node:'B',uy:true}]}),e=r.elementResults[0];
  near(reaction(r,'A').fy,2);near(reaction(r,'B').fy,2);near(e.ends.a.M,0);near(e.ends.b.M,0);near(e.at(2).M,2);near(e.at(2).uy,-.005);near(e.maxDeflection,.005);near(e.at(0).rotation,-.004);near(e.at(4).rotation,.004);
});

test('fixed-fixed UDL retains end hogging and load-bubble deflection even when every nodal DOF is fixed',()=>{
  const r=solved({nodes:[node('A',0),node('B',4)],elements:[element('E','A','B',{qy:-1})],supports:[{node:'A',ux:true,uy:true,rz:true},{node:'B',ux:true,uy:true,rz:true}]}),e=r.elementResults[0];
  near(e.ends.a.M,-4/3);near(e.ends.b.M,-4/3);near(e.at(2).M,2/3);near(e.at(2).uy,-.001);near(e.maxDeflection,.001);near(e.maxMoment,4/3);
});

test('both local moment releases condense UDL and recover member rotations independently of fixed nodal rotations',()=>{
  const r=solved({nodes:[node('A',0),node('B',4)],elements:[element('E','A','B',{qy:-1,releaseA:true,releaseB:true})],supports:[{node:'A',ux:true,uy:true,rz:true},{node:'B',ux:true,uy:true,rz:true}]}),e=r.elementResults[0];
  near(displacement(r,'A').rz,0);near(displacement(r,'B').rz,0);near(e.ends.a.M,0);near(e.ends.b.M,0);near(e.at(0).rotation,-.004);near(e.at(4).rotation,.004);near(e.at(2).uy,-.005);near(reaction(r,'A').mz,0);near(reaction(r,'B').mz,0);
});

test('one released end gives the independently known fixed-pinned UDL reactions and moment',()=>{
  const r=solved({nodes:[node('A',0),node('B',4)],elements:[element('E','A','B',{qy:-1,releaseB:true})],supports:[{node:'A',ux:true,uy:true,rz:true},{node:'B',ux:true,uy:true,rz:true}]}),e=r.elementResults[0];
  near(reaction(r,'A').fy,2.5);near(reaction(r,'B').fy,1.5);near(e.ends.a.M,-2);near(e.ends.b.M,0);near(e.at(2).uy,-.002);near(e.at(2).M,1);near(reaction(r,'B').mz,0);
});

test('pure end couple recovers constant moment, zero shear and correct tip rotation',()=>{
  const p=cantilever();p.nodalLoads=[{node:'B',mz:2}];const r=solved(p),e=r.elementResults[0];near(displacement(r,'B').uy,.0135);near(displacement(r,'B').rz,.009);near(e.maxMoment,2);near(e.maxShear,0);near(reaction(r,'A').mz,-2);
});

test('axial-only members ignore unattached zero-load rotations and give PL/EA without invented bending stiffness',()=>{
  const r=solved({nodes:[node('A',0),node('B',3)],elements:[element('E','A','B',{kind:'truss'})],supports:[{node:'A',ux:true,uy:true},{node:'B',uy:true}],nodalLoads:[{node:'B',fx:10}]}),e=r.elementResults[0];
  near(displacement(r,'B').ux,.00015);near(e.maxAxial,10);near(e.maxMoment,0);near(e.maxShear,0);assert.deepEqual(r.ignoredRotations,['A','B']);near(reaction(r,'A').fx,-10);
});

test('arbitrary member rotation, translation and node reversal preserve physical results and both force components',()=>{
  const theta=.73,c=Math.cos(theta),s=Math.sin(theta),point=x=>({x:13+c*x,y:-4+s*x}),A=point(0),B=point(3),load={node:'B',fx:10*c+2*s,fy:10*s-2*c};
  for(const reversed of [false,true]){
    const r=solved({nodes:[{id:'A',...A},{id:'B',...B}],elements:[element('E',reversed?'B':'A',reversed?'A':'B')],supports:[{node:'A',ux:true,uy:true,rz:true}],nodalLoads:[load]});
    near(displacement(r,'B').ux,c*.00015+s*.027);near(displacement(r,'B').uy,s*.00015-c*.027);near(displacement(r,'B').rz,-.0135);near(r.elementResults[0].maxMoment,6);near(r.elementResults[0].maxAxial,10);near(reaction(r,'A').fx,-load.fx);near(reaction(r,'A').fy,-load.fy);
  }
});

test('continuous two-span beam transfers real bending across its middle node',()=>{
  const r=solved({nodes:[node('A',0),node('B',3),node('C',6)],elements:[element('AB','A','B',{qy:-1}),element('BC','B','C',{qy:-1})],supports:[{node:'A',ux:true,uy:true},{node:'B',uy:true},{node:'C',uy:true}]}),[a,b]=r.elementResults;
  near(reaction(r,'A').fy,1.125);near(reaction(r,'B').fy,3.75);near(reaction(r,'C').fy,1.125);near(a.ends.b.M,-1.125);near(b.ends.a.M,-1.125);near(a.at(1.125).M,.6328125);near(a.at(3).rotation,b.at(0).rotation);
});

test('mesh refinement preserves beam reactions, peak moments and the exact recovered deflection',()=>{
  for(const count of [1,2,8]){
    const nodes=Array.from({length:count+1},(_,i)=>node('N'+i,4*i/count)),elements=Array.from({length:count},(_,i)=>element('E'+i,'N'+i,'N'+(i+1),{qy:-1})),r=solved({nodes,elements,supports:[{node:'N0',ux:true,uy:true},{node:'N'+count,uy:true}]});
    near(reaction(r,'N0').fy,2);near(reaction(r,'N'+count).fy,2);near(Math.max(...r.elementResults.map(e=>e.maxMoment)),2);near(Math.max(...r.elementResults.map(e=>e.maxDeflection)),.005);
  }
});

test('global vertical UDL on a sloping member recovers both axial and normal load components',()=>{
  const theta=.6,c=Math.cos(theta),s=Math.sin(theta),r=solved({nodes:[node('A',0),node('B',4*c,4*s)],elements:[element('E','A','B',{qy:-1})],supports:[{node:'A',ux:true,uy:true,rz:true}]}),e=r.elementResults[0];
  near(e.qx,-s);near(e.qy,-c);near(reaction(r,'A').fx,0);near(reaction(r,'A').fy,4);near(reaction(r,'A').mz,8*c);near(e.maxMoment,8*c);near(e.maxAxial,4*s);near(displacement(r,'B').ux,c*s*(.048-.00004));near(displacement(r,'B').uy,-s*s*.00004-c*c*.048);
});

test('a tied triangular axial-only system remains stable without any rotational stiffness',()=>{
  const r=solved({nodes:[node('A',0),node('B',4),node('C',2,3)],elements:[element('AB','A','B',{kind:'truss'}),element('AC','A','C',{kind:'truss'}),element('BC','B','C',{kind:'truss'})],supports:[{node:'A',ux:true,uy:true},{node:'B',uy:true}],nodalLoads:[{node:'C',fy:-6}]}),get=id=>r.elementResults.find(e=>e.id===id);
  near(reaction(r,'A').fy,3);near(reaction(r,'B').fy,3);near(reaction(r,'A').fx,0);near(get('AB').ends.a.N,2);near(get('AC').ends.a.N,-Math.sqrt(13));near(get('BC').ends.a.N,-Math.sqrt(13));near(displacement(r,'C').uy,-(26*Math.sqrt(13)+16)/(200000*6));assert.equal(r.ignoredRotations.length,3);
});

test('a pin-connected unbraced rectangle is a mechanism even at zero load; no artificial diagonal stiffness is added',()=>{
  const r=solveFrame2D({nodes:[node('A',0),node('B',4),node('C',4,3),node('D',0,3)],elements:[element('AB','A','B',{kind:'truss'}),element('BC','B','C',{kind:'truss'}),element('CD','C','D',{kind:'truss'}),element('DA','D','A',{kind:'truss'})],supports:[{node:'A',ux:true,uy:true},{node:'B',uy:true}]});
  assert.equal(r.stable,false);assert.equal(r.status,'fail');assert.ok(r.errors.length);assert.deepEqual(r.displacements,[]);
});

test('two moment releases cannot leave a numerical transverse spring in an otherwise unsupported beam',()=>{
  for(const L of [1.7,3,4.3]){
    const r=solveFrame2D({nodes:[node('A',0),node('B',L)],elements:[element('E','A','B',{releaseA:true,releaseB:true})],supports:[{node:'A',ux:true,uy:true}],nodalLoads:[{node:'B',fy:-1}]});
    assert.equal(r.stable,false);assert.ok(r.errors.length);
  }
});

test('malformed numerical data and a moment on an unattached rotation fail explicitly without NaN',()=>{
  for(const input of [null,{}, {...cantilever(),supports:null}, {...cantilever(),nodalLoads:null}, {...cantilever(),elements:[element('E','A','B',{E:0})]}, {...cantilever(),elements:[element('E','A','B',{E:1e308})]}, {...cantilever(),nodalLoads:[{node:'B',fy:NaN}]}, {...cantilever(),nodes:[node('A',0),node('B',0)]}, {nodes:[node('A',0),node('B',3)],elements:[element('E','A','B',{kind:'truss'})],supports:[{node:'A',ux:true,uy:true},{node:'B',uy:true}],nodalLoads:[{node:'B',mz:1}]}]){
    const r=solveFrame2D(input);assert.equal(r.stable,false);assert.ok(r.errors.length);assert.equal(JSON.stringify(r).includes('NaN'),false);
  }
});
