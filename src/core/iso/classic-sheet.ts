import type {Point,Primitive} from '../drawing'
import {sheetInfoOf,type IsoDocument} from '../model'
import {CAD_STROKE_WIDTH} from '../stroke-font'
import {viewProject} from './layout'
import {type SheetFrame} from './sheet'

/** Spoolyard's original paper presentation, with the current complete material schedule. */
export function classicSheet(doc:IsoDocument,spool:string,width:number,height:number,view:string,production:SheetFrame):SheetFrame{
 const out:Primitive[]=production.primitives.filter(p=>p.layer==='BOM'),info=sheetInfoOf(doc,spool),scale=height/850,Y=(y:number)=>y*scale;
 const line=(a:Point,b:Point)=>out.push({type:'line',a,b,layer:'BORDER',weight:CAD_STROKE_WIDTH});
 const text=(p:Point,value:string,size:number)=>out.push({type:'text',p,text:value,size:size*scale,layer:'TITLE',lettering:'sans'});
 const rect=(x:number,y:number,w:number,h:number)=>{line([x,Y(y)],[x+w,Y(y)]);line([x+w,Y(y)],[x+w,Y(y+h)]);line([x+w,Y(y+h)],[x,Y(y+h)]);line([x,Y(y+h)],[x,Y(y)])};
 const bomLeft=Math.min(width-30,...production.exclusions.filter(b=>b[0]>width*.5).map(b=>b[0])),split=width-385*scale;
 rect(20*scale,20,width-40*scale,810);
 text([40*scale,Y(48)],doc.title.length>55?doc.title.slice(0,54)+'…':doc.title,22);
 text([40*scale,Y(72)],`${info.drawingNumber}  |  ${spool||'All spools'}  |  Revision ${info.revision}`,13);
 text([40*scale,Y(94)],`${doc.customer}${doc.project?'  /  '+doc.project:''}`,12);
 rect(35*scale,650,width-70*scale,160);line([35*scale,Y(705)],[width-35*scale,Y(705)]);line([split,Y(650)],[split,Y(810)]);
 text([48*scale,Y(673)],`DRAWING: ${info.drawingNumber}     SPOOL: ${spool||'ALL'}     REV: ${info.revision}`,12);
 text([48*scale,Y(694)],`DRAWN: ${doc.drawnBy}     CHECKED: ${doc.checkedBy}`,11);
 text([split+15*scale,Y(673)],'SPOOLYARD  /  PIPING ISOMETRIC',13);
 text([split+15*scale,Y(694)],`${view.toUpperCase()} VIEW · ${doc.units==='mm'?'METRIC':'IMPERIAL'}`,11);
 // Sans size is cap height; SVG/PDF use a larger em to obtain that height.
 const noteColumns=Math.max(20,Math.floor((split-65*scale)/(9*scale*.62/.72)));
 const notes=doc.notes.split('\n').flatMap(value=>{const lines:string[]=[];let row='';for(const word of value.split(/\s+/)){if(row&&row.length+word.length+1>noteColumns){lines.push(row);row=''}row+=(row?' ':'')+word}if(row)lines.push(row);return lines});
 if(notes.length<=7)notes.forEach((v,i)=>text([48*scale,Y(726+i*13)],v,9));
 else{out.push(...production.primitives.filter(p=>p.layer==='NOTES'));text([48*scale,Y(728)],'NOTES: SEE DRAWING ABOVE',10)}
 text([split+15*scale,Y(727)],'DIMENSIONS GOVERN · NOT TO SCALE',10);
 text([split+15*scale,Y(746)],'ALL LENGTHS TO CENTRELINES UNLESS NOTED',9);
 text([split+15*scale,Y(765)],'CUT = OVERALL - FITTINGS - ROOT GAPS',9);
 text([split+15*scale,Y(789)],`PIPE SPEC: ${[...new Set(doc.runs.filter(r=>!spool||r.spool===spool).map(r=>r.specId))].join(' / ')}`,10);
 const dir=viewProject([0,1,0],view as 'iso'|'plan'|'front'|'side',doc.north),length=Math.hypot(...dir)||1,u:Point=[dir[0]/length,dir[1]/length],origin:Point=[bomLeft-65*scale,Y(82)],tip:Point=[origin[0]+u[0]*22*scale,origin[1]+u[1]*22*scale];
 if(Math.hypot(...dir)>1e-6){line(origin,tip);for(const side of [-1,1])line(tip,[tip[0]-u[0]*8*scale-u[1]*4*side*scale,tip[1]-u[1]*8*scale+u[0]*4*side*scale]);
 text([tip[0]+u[0]*12*scale-4*scale,tip[1]+u[1]*12*scale+4*scale],'N',13)}
 return {primitives:out,viewport:[40*scale,Y(115),width-40*scale,Y(630)],exclusions:[...production.exclusions.filter(b=>b[0]>width*.5&&(b[1]<Y(100)||notes.length>7)),[origin[0]-40*scale,Y(40),origin[0]+40*scale,Y(110)]]};
}
