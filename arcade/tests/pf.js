const src=require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../dist/project/Main.dc.html'),'utf8');
const js=src.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0];
global.DCLogic=class{constructor(p){this.props=p||{};}setState(u){this.state={...this.state,...(typeof u==='function'?u(this.state):u)};}};global.setTimeout=()=>0;global.clearTimeout=()=>{};
const C=eval(js+';Component');const c=new C({});
for(const pf of ['portfolio','farquhar','region_kansas_city','region_columbia','Oakwood Gardens']){
 let v=c.renderVals(); v.setPf({target:{value:pf}}); v=c.renderVals();
 console.log(pf,'| crumbs',v.panel.crumbs.map(x=>x.label).join('›'),'| title',v.panel.title,'| score',v.panel.score,'| lb',v.leaderboard.rows.map(r=>r.name).join(','),'| tape',v.ticker[0].tag,v.ticker[0].text,'| todo',v.panel.sections.find(x=>x.key==='todo').summary,'| dim',v.objects.filter(o=>o.isB&&o.opacity<1).length,'| plates',v.plates.length);
}
