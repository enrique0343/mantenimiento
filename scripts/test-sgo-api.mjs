// Local cryptographic/route regression suite: ephemeral keys, no network or production DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair, exportJWK, createLocalJWKSet, SignJWT} from 'jose';
import {createSgoApi, createSnapshotPublisher, safeRecord} from '../src/lib/sgo/api.mjs';
import {PREFIX, instant} from '../src/lib/sgo/security.mjs';
const now = Date.parse('2026-09-17T18:00:06Z'), from='2026-01-01T00:00:00Z', until='2027-01-01T00:00:00Z';
const scope={site_id:'1',maintenance_area_id:'biomedico'};
const key=await generateKeyPair('RS256'), jwk={...await exportJWK(key.publicKey),kid:'local-ephemeral'};
const resolver=createLocalJWKSet({keys:[jwk]});
const secret=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const order=(id,status='abierta',extra={})=>({resource:'order',record:{id:String(id),...scope,scope_origin:'explicit_order',created_at:'2026-09-15T06:00:00Z',updated_at:null,revision:'1',asset_id:null,plan_id:null,activity_id:null,location_id:'3',type:'correctivo',status,priority:'media',assigned:false,assigned_at:null,started_at:null,paused_at:null,paused_minutes:0,due_at:null,due_date:null,completed_at:null,verified_at:null,closed_at:null,automatic_elapsed_hours:null,duration_kind:'workflow_elapsed_minus_recorded_wait',due_basis:'legacy_unknown',quality_flags:[],...extra}});
async function fixture(options={}) {
  let time=now; const counters={reads:0,publishes:0};
  const principal={principal_id:'demo-principal',common_name:'demo.access',grant_version:'1',valid_from:from,valid_until:until,scopes:[{...scope,valid_from:from,valid_until:until},{site_id:'2',maintenance_area_id:'aires',valid_from:from,valid_until:until}]};
  const env={SGO_INTEGRATION_ENABLED:'true',SGO_ACCESS_ISSUER:'https://demo.cloudflareaccess.com',SGO_ACCESS_AUD:'demo-audience',SGO_API_ORIGIN:'https://maintenance.example.invalid',SGO_CURSOR_SECRET:secret(),SGO_SERVICE_PRINCIPALS_JSON:JSON.stringify([principal]),SGO_PUBLISH_SECRET:secret()};
  const checkpoint={...scope,through_seq:'3',minimum_available_seq:'1',source_updated_at:null,history_available_from:'2026-09-01T06:00:00Z',asset_coverage:'complete',order_coverage:'complete'};
  const snapshot={source_instance_id:'demo-source',snapshot_id:'demo-snapshot',cutoff_at:'2026-09-17T18:00:00.000Z',snapshot_published_at:'2026-09-17T18:00:03.000Z',snapshot_expires_at:'2026-09-18T18:00:00.000Z',projection_version:'1',resource_set_version:'1',scopes:[checkpoint,{...checkpoint,site_id:'2',maintenance_area_id:'aires',history_available_from:'2026-09-10T06:00:00Z'},{...checkpoint,site_id:'3',maintenance_area_id:'aires',through_seq:'999'}]};
  const records=[order(1),order(2,'en_proceso'),order(3,'en_espera'),order(4,'completada',{completed_at:'2026-09-15T08:00:00Z'}),order(5,'cerrada',{completed_at:'2026-09-15T10:00:00Z'}),order(6,'cancelada')];
  const changes=[{seq:'1',resource:'order',id:'1',revision:'1',operation:'upsert',changed_at:'2026-09-16T01:00:00Z',payload:records[0]},{seq:'2',resource:'order',id:'7',revision:'2',operation:'remove',changed_at:'2026-09-16T02:00:00Z',reason:'deleted',destination_site_id:'PRIVATE'},{seq:'3',resource:'order',id:'8',revision:'4',operation:'remove',changed_at:'2026-09-16T03:00:00Z',reason:'scope_changed',destination_site_id:'PRIVATE'}];
  const settings={projection_version:'1',resource_set_version:'1'};
  const store={getPublishedSnapshot:async(_,id)=>{counters.reads++;return snapshot;},getIntegrationSettings:async()=>settings,getAllowedReferences:async()=>({sites:[{id:'1',name:'Demo',active:true,updated_at:null},{id:'3',name:'PRIVATE',active:true}],maintenance_areas:[{id:'biomedico',name:'BIO'},{id:'infraestructura',name:'PRIVATE'}]}),listSnapshotRecords:async(_,__,s,r)=>{counters.reads++;return records.filter(x=>x.resource===r);},listSnapshotChanges:async(_,__,s,after)=>changes.filter(x=>BigInt(x.seq)>BigInt(after)),publishSnapshot:async()=>{counters.publishes++;return snapshot;}};
  const api=createSgoApi({store,keyResolver:resolver,clock:()=>time});
  const token=async(claims={},privateKey=key.privateKey)=>new SignJWT({type:'app',common_name:'demo.access',sub:'',iss:env.SGO_ACCESS_ISSUER,aud:env.SGO_ACCESS_AUD,iat:Math.floor(now/1000)-1,exp:Math.floor(now/1000)+3600,...claims}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).sign(privateKey);
  const auth=await token();
  const call=async(path,query={},opts={})=>{
    const headers={'Cf-Access-Jwt-Assertion':auth,'CF-Access-Client-Id':'demo.access','CF-Access-Client-Secret':'local-edge-already-verified',...opts.headers};
    for(const k of Object.keys(headers))if(headers[k]===null)delete headers[k];
    return api(new Request('https://maintenance.example.invalid'+PREFIX+path+'?'+new URLSearchParams(query),{method:opts.method??'GET',headers}),opts.env??env);
  };
  const base={...scope,snapshot_id:snapshot.snapshot_id};
  return {env,principal,checkpoint,snapshot,records,changes,settings,store,counters,token,call,base,setTime:n=>time=n};
}
const read=async(response,status=200)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};

test('service JWT signature, issuer/audience/time and human-token isolation',async()=>{
  const f=await fixture(); await read(await f.call('/meta'));
  for(const claims of [{aud:'wrong'},{iss:'https://wrong.cloudflareaccess.com'},{exp:Math.floor(now/1000)},{iat:Math.floor(now/1000)+60},{sub:'human'},{email:'human@example.invalid'},{identity_nonce:'human'},{common_name:'another.access'},{type:'org'}]) await read(await f.call('/meta',{}, {headers:{'Cf-Access-Jwt-Assertion':await f.token(claims)}}),401);
  const other=await generateKeyPair('RS256'); await read(await f.call('/meta',{}, {headers:{'Cf-Access-Jwt-Assertion':await f.token({},other.privateKey)}}),401);
  await read(await f.call('/meta',{}, {headers:{'Cf-Access-Jwt-Assertion':null,Cookie:'auth_session=human'}}),401);
  await read(await f.call('/meta',{}, {headers:{'CF-Access-Client-Secret':null}}),401);
});
test('disabled flags/configuration never open a route and mutators are 405',async()=>{
  const f=await fixture();
  await read(await f.call('/meta',{}, {env:{...f.env,SGO_INTEGRATION_ENABLED:undefined}}),503);
  await read(await f.call('/meta',{}, {env:{...f.env,SGO_ACCESS_ISSUER:'https://attacker.invalid'}}),503);
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD']) assert.equal((await f.call('/meta',{}, {method})).status,405);
});
test('tuple allowlist, validity and metadata do not leak another pair',async()=>{
  const f=await fixture();
  for(const pair of [{site_id:'1',maintenance_area_id:'aires'},{site_id:'3',maintenance_area_id:'biomedico'}]) await read(await f.call('/records',{...f.base,...pair,resource:'order'}),403);
  const meta=await read(await f.call('/meta'));assert.equal(meta.meta.through_seq,null);assert.equal(meta.meta.history_available_from,'2026-09-10T06:00:00.000Z');assert.equal(meta.readiness.scope_checkpoints.length,2);assert.ok(!JSON.stringify(meta).includes('999'));
  const refs=await read(await f.call('/references'));assert.equal(refs.sites.length,1);assert.equal(refs.maintenance_areas.length,1);assert.ok(!JSON.stringify(refs).includes('PRIVATE'));
  f.principal.valid_until='2026-09-17T18:00:06Z';f.env.SGO_SERVICE_PRINCIPALS_JSON=JSON.stringify([f.principal]);await read(await f.call('/meta'),403);
});
test('records: safe DTOs, future due dates, no implicit timeline or unsupported resource',async()=>{
  const f=await fixture();f.records[0].record.clinical_note='PRIVATE';f.records[0].record.salary=12345;f.records[0].record.due_at='2026-10-01T12:00:00Z';f.records[1].record.due_date='2026-10-01';
  const all=await read(await f.call('/records',{...f.base,resource:'order'}));assert.equal(all.data.length,6);assert.ok(!JSON.stringify(all).includes('PRIVATE'));assert.ok(!JSON.stringify(all).includes('salary'));
  const due=await read(await f.call('/records',{...f.base,resource:'order',period_start:'2026-10-01',period_end:'2026-10-02',date_basis:'due'}));assert.equal(due.data.length,2);assert.equal(due.data[1].record.due_at,null);
  await read(await f.call('/records',{...f.base,resource:'order',record_id:'1',limit:'2'}),400);
  await read(await f.call('/records',{...f.base,resource:'plan'}),409);await read(await f.call('/records',{...f.base,resource:'order',record_id:'99'}),404);
  await read(await f.call('/records',{...f.base,resource:'order',updated_since:'2026-09-01T00:00:00Z'}),409);
  await read(await f.call('/records',{...f.base,resource:'order',period_start:'2026-09-01'}),400);
  for(const limit of ['0','201','1.5','abc','-1'])await read(await f.call('/records',{...f.base,resource:'order',limit}),400);
  assert.equal(instant('2026-02-30T00:00:00Z'),null);assert.equal(instant('2026-09-17'),null);
});
test('pagination binds filters, limits, principal grants and immutable snapshots',async()=>{
  const f=await fixture(),q={...f.base,resource:'order',limit:'2'};
  const one=await read(await f.call('/records',q)),cursor=one.pagination.next_cursor;
  const two=await read(await f.call('/records',{...q,cursor}));assert.equal(two.data[0].record.id,'3');
  await read(await f.call('/records',{...q,cursor,limit:'3'}),400);
  await read(await f.call('/records',{...q,cursor:cursor.slice(0,-5)+'xxxxx'}),400);
  f.principal.grant_version='2';f.env.SGO_SERVICE_PRINCIPALS_JSON=JSON.stringify([f.principal]);await read(await f.call('/records',{...q,cursor}),400);
  f.principal.grant_version='1';f.env.SGO_SERVICE_PRINCIPALS_JSON=JSON.stringify([f.principal]);f.setTime(now+16*60000);await read(await f.call('/records',{...q,cursor}),410);
});
test('changes: inclusive history boundary, removals, stale resource set and cursor after_seq',async()=>{
  const f=await fixture(),q={...f.base,after_seq:'0',projection_version:'1',resource_set_version:'1',limit:'1'};
  const one=await read(await f.call('/changes',q));assert.equal(one.data[0].seq,'1');
  const {after_seq,...rest}=q;const two=await read(await f.call('/changes',{...rest,cursor:one.pagination.next_cursor}));assert.equal(two.after_seq,'0');assert.equal(two.data[0].operation,'remove');assert.ok(!JSON.stringify(two).includes('PRIVATE'));
  f.settings.resource_set_version='2';await read(await f.call('/changes',q),409);f.settings.resource_set_version='1';
  await read(await f.call('/changes',{...q,projection_version:'old'}),409);
  f.checkpoint.minimum_available_seq='3';await read(await f.call('/changes',q),410);
});
test('KPI states, local period, elapsed hours, exclusions and signed reproducible evidence',async()=>{
  const f=await fixture(),q={...f.base,period_start:'2026-09-01',period_end:'2026-10-01'};
  const result=await read(await f.call('/kpis',q)),values=Object.fromEntries(result.data.map(x=>[x.metric_id,x]));
  assert.equal(result.meta.contract_version,'1.0.0-rc.1');assert.equal(result.meta.period.start_at,'2026-09-01T06:00:00.000Z');assert.equal(result.meta.period.is_complete,false);assert.equal(result.calculated_at,new Date(now).toISOString());
  assert.equal(values['MNT-01'].value,6);assert.equal(values['MNT-02'].value,1);assert.equal(values['MNT-03'].value,3);assert.equal(values['MNT-11'].value,3);assert.equal(values['MNT-11'].numerator,6);assert.equal(values['MNT-11'].denominator,2);assert.equal(values['MNT-11'].data_status,'partial');assert.ok(values['MNT-11'].reason_codes.includes('period_in_progress'));
  assert.ok(result.calculation_id.length<8192);assert.match(result.calculation_id,/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const again=await read(await f.call('/kpis',q));assert.equal(result.calculation_id,again.calculation_id);
  const path='/kpis/'+result.calculation_id+'/evidence';const evidence=await read(await f.call(path,f.base));
  const rows=evidence.data.filter(x=>x.metric_id==='MNT-11');assert.equal(rows.reduce((a,b)=>a+(b.numerator_contribution??0),0),6);assert.equal(rows.reduce((a,b)=>a+(b.denominator_contribution??0),0),2);
  const page=await read(await f.call(path,{...f.base,limit:'1'}));
  const different=await read(await f.call('/kpis',{...q,period_start:'2026-09-02'}));await read(await f.call('/kpis/'+different.calculation_id+'/evidence',{...f.base,limit:'1',cursor:page.pagination.next_cursor}),400);
  f.records[0].record.revision='2';await read(await f.call(path,f.base),409);
  assert.equal(f.counters.publishes,0);
});
test('unknown coverage is null, complete empty stock is zero, no cases is not_applicable',async()=>{
  const f=await fixture(),q={...f.base,period_start:'2026-09-01',period_end:'2026-10-01'};f.records.length=0;f.checkpoint.order_coverage='unknown';
  let result=await read(await f.call('/kpis',q));assert.ok(result.data.every(x=>x.value===null));assert.ok(result.data.every(x=>x.data_status==='insufficient_data'));
  f.checkpoint.order_coverage='complete';result=await read(await f.call('/kpis',q));assert.equal(result.data.find(x=>x.metric_id==='MNT-02').value,0);assert.equal(result.data.find(x=>x.metric_id==='MNT-11').data_status,'not_applicable');
  const reads=f.counters.reads;const outside=await read(await f.call('/kpis',{...q,metric_ids:'MNT-16'}));assert.equal(outside.calculation_id,null);assert.equal(outside.data[0].evaluation_status,'not_evaluated');assert.equal(outside.data[0].capability,'pending');assert.equal(f.counters.reads,reads+1);
});
test('reopening, cancellation, wrong intervals and noncorrective orders never become resolution labor',async()=>{
  const f=await fixture(),q={...f.base,period_start:'2026-09-01',period_end:'2026-10-01',metric_ids:'MNT-11'};
  f.records[3].record.status='abierta';f.records[4].record.status='cancelada';
  f.records.push(order(10,'cerrada',{type:'preventivo',completed_at:'2026-09-15T12:00:00Z'}));
  let r=await read(await f.call('/kpis',q));assert.equal(r.data[0].value,null);assert.equal(r.data[0].data_status,'not_applicable');
  f.records.push(order(11,'cerrada',{completed_at:'2026-09-14T12:00:00Z'}));r=await read(await f.call('/kpis',q));assert.equal(r.data[0].value,null);assert.equal(r.data[0].coverage.excluded_records,1);
});
test('publisher requires dedicated secret and never accepts user cookie/old CRON secret',async()=>{
  const f=await fixture(),publish=createSnapshotPublisher({store:f.store});
  const req=(method,headers={})=>new Request('https://maintenance.example.invalid/api/cron/sgo-snapshot',{method,headers});
  assert.equal((await publish(req('GET'),f.env)).status,405);
  assert.equal((await publish(req('POST',{Cookie:'auth_session=human',Authorization:'Bearer old-cron'}),f.env)).status,401);
  assert.equal((await publish(req('POST',{'X-SGO-Publish-Secret':f.env.SGO_PUBLISH_SECRET}),{...f.env,SGO_INTEGRATION_ENABLED:'false'})).status,503);
  assert.equal((await publish(req('POST',{'X-SGO-Publish-Secret':f.env.SGO_PUBLISH_SECRET}),f.env)).status,200);assert.equal(f.counters.publishes,1);
});

test('stock counts do not require a creation timestamp; age does require one',async()=>{
  const f=await fixture();f.records.length=0;f.records.push(order(99,'abierta',{created_at:null}));
  const r=await read(await f.call('/kpis',{...f.base,period_start:'2026-09-01',period_end:'2026-10-01'}));
  assert.equal(r.data.find(x=>x.metric_id==='MNT-02').value,1);assert.equal(r.data.find(x=>x.metric_id==='MNT-03').value,1);
  assert.equal(r.data.find(x=>x.metric_id==='MNT-06').value,null);assert.equal(r.data.find(x=>x.metric_id==='MNT-06').data_status,'insufficient_data');
});

test('Salvador half-open day boundaries and history coverage remain explicit',async()=>{
  const f=await fixture();f.records.length=0;
  f.records.push(order(31,'abierta',{created_at:'2026-09-01T05:59:59Z'}),order(32,'abierta',{created_at:'2026-09-01T06:00:00Z'}),order(33,'abierta',{created_at:'2026-09-02T06:00:00Z'}));
  const q={...f.base,period_start:'2026-09-01',period_end:'2026-09-02',metric_ids:'MNT-01'};
  let r=await read(await f.call('/kpis',q));assert.equal(r.data[0].value,1);assert.equal(r.data[0].data_status,'ok');
  f.checkpoint.history_available_from='2026-09-02T06:00:00Z';r=await read(await f.call('/kpis',q));assert.equal(r.data[0].value,null);assert.equal(r.data[0].numerator,1);assert.ok(r.data[0].reason_codes.includes('source_history_incomplete'));
});
test('calculation evidence rechecks grants and rejects another period/source/principal',async()=>{
  const f=await fixture(),q={...f.base,period_start:'2026-09-01',period_end:'2026-10-01'};
  const r=await read(await f.call('/kpis',q)),path='/kpis/'+r.calculation_id+'/evidence';
  await read(await f.call(path,{...f.base,site_id:'2',maintenance_area_id:'aires'}),404);
  f.principal.principal_id='another-principal';f.env.SGO_SERVICE_PRINCIPALS_JSON=JSON.stringify([f.principal]);await read(await f.call(path,f.base),404);
  f.principal.principal_id='demo-principal';f.principal.grant_version='2';f.env.SGO_SERVICE_PRINCIPALS_JSON=JSON.stringify([f.principal]);await read(await f.call(path,f.base),404);
  f.principal.grant_version='1';f.principal.scopes=f.principal.scopes.slice(1);f.env.SGO_SERVICE_PRINCIPALS_JSON=JSON.stringify([f.principal]);await read(await f.call(path,f.base),403);
});

test('outside-profile KPI preserves diagnostic capability and unit without inventing a result',async()=>{
  const f=await fixture();const r=await read(await f.call('/kpis',{...f.base,period_start:'2026-09-01',period_end:'2026-10-01',metric_ids:'MNT-04,MNT-05,MNT-07,MNT-08,MNT-09,MNT-10,MNT-12,MNT-13,MNT-14,MNT-15,MNT-16,MNT-17'}));
  assert.equal(r.calculation_id,null);assert.ok(r.data.every(x=>x.value===null&&x.evaluation_status==='not_evaluated'));
  const metrics=Object.fromEntries(r.data.map(x=>[x.metric_id,x]));
  for(const id of ['MNT-04','MNT-05','MNT-07','MNT-09','MNT-12'])assert.equal(metrics[id].capability,'partial');
  assert.equal(metrics['MNT-10'].capability,'pending');assert.equal(metrics['MNT-14'].capability,'available');
  assert.equal(metrics['MNT-12'].unit,'hours');assert.equal(metrics['MNT-08'].unit,'occurrences');assert.equal(metrics['MNT-14'].unit,'assets');
});
