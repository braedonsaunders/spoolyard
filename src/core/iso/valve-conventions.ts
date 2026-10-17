import { connected, type IsoDocument, type PipeNode } from '../model'
import { nodeCode, nodeItem } from '../joints'

/** The butterfly's disc or actuator convention is independent of its purchased description. */
export function discValve(doc: IsoDocument, node: PipeNode, code = nodeCode(doc, node) ?? ''): boolean {
  if (!/^BFLY/.test(code)) return false
  if (node.valveSymbol) return node.valveSymbol === 'disc'
  const item = nodeItem(doc, node)
  return !/ACTUAT/i.test(`${node.description ?? ''} ${item?.bomDescription ?? ''} ${item?.description ?? ''}`)
}

export function swingCheck(node:PipeNode,code:string){
  return /^CHECK/.test(code) && node.valveSymbol === 'swing'
}

/** Half of the drawn component body before projecting it into the pipe's plane. */
export function valveBodyHalfLength(doc:IsoDocument,node:PipeNode,code=nodeCode(doc,node)??''){
  const size=Math.max(2,...connected(doc,node.id).map(r=>r.nps))
  return /^CHECK-SC/.test(code)||swingCheck(node,code)?15:discValve(doc,node,code)?size*7.35:/^BALL|^FLOWMETER|^PSV/.test(code)?15:/^BFLY/.test(code)&&size>=3?22.5:18
}
/** Body, gasket mating and outer plate planes of a flanged component. */
export function flangedGeometry(doc:IsoDocument,node:PipeNode,body=valveBodyHalfLength(doc,node)){
  const size=Math.max(2,...connected(doc,node.id).map(r=>r.nps))
  return {body,mate:body+size*1.85,plate:body+size*3.5}
}
export const discGeometry=flangedGeometry

/** Camlock body and cap profiles retain their drafting proportions at each nominal size. */
export function camlockGeometry(doc:IsoDocument,node:PipeNode){
  const size=Math.max(1,...connected(doc,node.id).map(r=>r.nps))
  return {halfLength:4.7+size*1.6,radius:Math.max(4,size*1.85),capRadius:Math.max(2,size)*3.75}
}

/** Schematic concentric/eccentric reducer block, sized by its large end. */
export function reducerGeometry(doc:IsoDocument,node:PipeNode){
  const size=Math.max(2,...connected(doc,node.id).map(r=>r.nps))
  return {halfLength:size*16.6/3,largeRadius:size*3.7,smallRadius:size*.95}
}
