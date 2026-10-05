const src=require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../dist/project/Main.dc.html'),'utf8');
const js=src.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0];
global.DCLogic=class{constructor(p){this.props=p||{};}setState(u){this.state={...this.state,...u};}};global.setTimeout=()=>0;global.clearTimeout=()=>{};
const C=eval('('+js.trim().replace(/^class Component/,'class')+')');const c=new C({});
for (const role of ['pm','va']) { c.setState({role,picked:null,pickedB:null,pickedU:null,focusBy:'prop'}); const v=c.renderVals();
  console.log(role.toUpperCase(),'portfolio',v.panel.score,'| components:',v.panel.sections[0].rows.map(r=>r.label.split(' ·')[0]+' '+r.value).join(', '));
  console.log('   ', v.panel.sections[1].rows.map(r=>r.label.replace(/^\d+\. /,'').split(' ·')[0]+' '+r.value).join(' | ')); }
