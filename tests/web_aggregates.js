const fs=require('fs'); const QD=require('../docs/js/data.js');
const meta=JSON.parse(fs.readFileSync(__dirname+'/../docs/data/meta.json'));
const b=fs.readFileSync(__dirname+'/../docs/data/quakes.bin'); const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const D=QD.build(meta,ab);
const cases={
 all:{}, y2011:{y0:2011,y1:2011}, japan:{region:['Japan']}, deepM7:{dclass:[2],mclass:[3]}, tsu1:{tsu:'1'}, tsu0_2015:{tsu:'0',y0:2015,y1:2020},
 combo:{y0:2000,y1:2010,region:['Chile','Peru'],mtype:[1],dclass:[0,1]}, asia:{macro:['Asia'],mclass:[1,2]}};
const out={};
for(const [name,c] of Object.entries(cases)){
 const s=QD.newState(); if(c.y0)s.y0=c.y0; if(c.y1)s.y1=c.y1; if(c.tsu)s.tsu=c.tsu;
 (c.region||[]).forEach(r=>s.region.add(meta.regions.indexOf(r))); (c.macro||[]).forEach(r=>s.macro.add(meta.macros.indexOf(r)));
 (c.dclass||[]).forEach(r=>s.dclass.add(r)); (c.mclass||[]).forEach(r=>s.mclass.add(r)); (c.mtype||[]).forEach(r=>s.mtype.add(r));
 const idx=QD.select(D,s), sm=QD.summarize(D,idx);
 const dim=D.dims.region, agg=QD.aggregate(D,idx,'energy',dim.arr,null,dim.K);
 out[name]={n:sm.n,m6:sm.m6,avgMag:sm.avgMag,medMag:sm.medMag,medDepth:sm.medDepth,energy:sm.energy,flagged:sm.flagged,maxMag:sm.n?D.mag[sm.strongest]:null,
  firstMax:sm.n?D.t[sm.strongest]:null, regionEnergyTop:Array.from(agg.value).map((v,i)=>[i,v]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,3).map(x=>meta.regions[x[0]])};
}
fs.writeFileSync(process.argv[2],JSON.stringify({out,cases}));
