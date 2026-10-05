const src=require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../dist/project/Main.dc.html'),'utf8');
const js=src.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0];
global.DCLogic=class{constructor(p){this.props=p||{};}setState(u){this.state={...this.state,...(typeof u==='function'?u(this.state):u)};}};global.setTimeout=()=>0;global.clearTimeout=()=>{};
const C=eval(js+';Component');const c=new C({});
for(const role of ['pm','va']){c.state={...c.state,role,picked:null,pickedB:null,pickedU:null};const v=c.renderVals();
console.log(role,v.leaderboard.title);v.leaderboard.rows.forEach(r=>console.log('  ',r.rank,r.name,r.units,r.score));
const sec=v.panel.sections.map(x=>x.title+(x.isOpen?'*':''));console.log('  sections',sec.join(' | '));
const u=v.panel.sections.find(x=>x.key==='unasg');console.log('  ',u.summary);u.rows.forEach(r=>console.log('    ',r.value,r.label,'|',r.sub.slice(0,60)));}
c.state={...c.state,picked:'Hilltop Townhomes'};const v=c.renderVals();console.log('hilltop:',v.panel.sections.find(x=>x.key==='unasg').summary, v.leaderboard.rows.filter(r=>r.cur==='true').map(r=>r.name));
v.leaderboard.toggle();console.log('toggled open:',c.renderVals().leaderboard.open);
