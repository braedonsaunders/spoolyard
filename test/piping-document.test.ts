import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRun, newIso } from '../src/core/model.ts';
import { isometricDxf, readIsometric } from '../src/core/document.ts';
test('standalone DXF preserves exact measured piping metadata and unicode title',()=>{
  const doc=newIso();doc.title='Cooling loop · révision';const end=appendRun(doc,null,[1000,0,0],'CS40',2,'SP-001','L-22');
  appendRun(doc,end.id,[0,1000,0],'CS40',2,'SP-001','L-22');doc.runs[0].toPrep='THD';
  doc.grid={visible:false,snap:true,spacing:25,plane:'xz'};
  const dxf=isometricDxf(doc);
  assert.equal(dxf.includes('\nAC1015\n'),true);
  assert.deepEqual(readIsometric(dxf),doc);
  assert.deepEqual(readIsometric(JSON.stringify(doc)),doc);
});
test('plain CAD drawings cannot silently become fabricated piping',()=>{
  assert.throws(()=>readIsometric('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'),/no measured piping model/);
});
test('removing an inline valve retains outer preparations, tags, heat and support association',async()=>{
  const { insertComponent, attachComponent, removeComponent }=await import('../src/core/model.ts');
  const doc=newIso();appendRun(doc,null,[2000,0,0],'CS40',2,'SP-001','L-2');
  const original=doc.runs[0];original.fromPrep='THD';original.toPrep='SW';original.fromTag='A';original.toTag='B';original.heat='LOT-1';
  const valve=insertComponent(doc,original.id,'valve');const support=attachComponent(doc,doc.runs[1].id,'support');
  removeComponent(doc,valve.id);
  assert.equal(doc.runs.length,1);assert.equal(doc.runs[0].fromPrep,'THD');assert.equal(doc.runs[0].toPrep,'SW');
  assert.equal(doc.runs[0].fromTag,'A');assert.equal(doc.runs[0].toTag,'B');assert.equal(doc.runs[0].heat,'LOT-1');
  assert.equal(support.associatedRunId,doc.runs[0].id);
});
