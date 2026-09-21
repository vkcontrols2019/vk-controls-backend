require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized:false } : undefined }) : null;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', async (_req,res) => {
  let database = 'not-configured';
  if (pool) { try { await pool.query('SELECT 1'); database='connected'; } catch(e) { database='error'; } }
  res.json({ok:true,app:'VK Controls Inventory',service:'backend',version:'1.2.0',database});
});

app.get('/api', (_req,res) => res.json({name:'VK Controls Inventory API',status:'ready',modules:['users','outlets','departments','food','liquor','coffee','inventory','reports']}));

function requireDb(_req,res,next){ if(!pool) return res.status(503).json({ok:false,error:'DATABASE_URL is not configured'}); next(); }

app.get('/api/departments', requireDb, async (_req,res) => {
  const {rows}=await pool.query('SELECT id,code,name,active FROM departments WHERE active=true ORDER BY name');
  res.json(rows);
});

app.get('/api/outlets', requireDb, async (req,res) => {
  const department=(req.query.department||'').toUpperCase();
  const params=[]; let sql='SELECT id,code,name,department_code,active FROM outlets WHERE active=true';
  if(department){params.push(department);sql+=' AND department_code=$1';}
  sql+=' ORDER BY name';
  const {rows}=await pool.query(sql,params); res.json(rows);
});


function normalizeDepartment(value){ return String(value||'').trim().toUpperCase(); }

app.post('/api/outlets/sync', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const name=String(b.name||'').trim();
  const department_code=normalizeDepartment(b.department_code||b.type);
  const entity_type=b.entity_type==='branch'?'branch':'group';
  const parent_firestore_id=b.parent_firestore_id?String(b.parent_firestore_id):null;
  if(!firestore_id || !name || !department_code) return res.status(400).json({ok:false,error:'firestore_id, name and department_code are required'});
  if(!['FOOD','LIQUOR','COFFEE'].includes(department_code)) return res.status(400).json({ok:false,error:'Invalid department_code'});
  const code=`FS-${firestore_id}`;
  const {rows}=await pool.query(`
    INSERT INTO outlets(firestore_id,code,name,department_code,entity_type,parent_firestore_id,active)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (firestore_id) DO UPDATE SET name=EXCLUDED.name,department_code=EXCLUDED.department_code,entity_type=EXCLUDED.entity_type,parent_firestore_id=EXCLUDED.parent_firestore_id,active=EXCLUDED.active
    RETURNING id,firestore_id,code,name,department_code,entity_type,parent_firestore_id,active`,
    [firestore_id,code,name,department_code,entity_type,parent_firestore_id,b.active!==false]);
  res.json({ok:true,outlet:rows[0]});
});

app.patch('/api/outlets/sync/:firestoreId', requireDb, async (req,res) => {
  const id=String(req.params.firestoreId); const {name,active}=req.body||{};
  const {rows}=await pool.query('UPDATE outlets SET name=COALESCE($1,name), active=COALESCE($2,active) WHERE firestore_id=$3 RETURNING id,firestore_id,code,name,department_code,entity_type,parent_firestore_id,active',[name,active,id]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Outlet mirror not found'});
  res.json({ok:true,outlet:rows[0]});
});

app.delete('/api/outlets/sync/:firestoreId', requireDb, async (req,res) => {
  await pool.query('DELETE FROM outlets WHERE firestore_id=$1',[String(req.params.firestoreId)]);
  res.json({ok:true});
});

app.post('/api/outlets', requireDb, async (req,res) => {
  const {code,name,department_code}=req.body||{};
  if(!code||!name||!department_code) return res.status(400).json({ok:false,error:'code, name and department_code are required'});
  if(!['FOOD','LIQUOR','COFFEE'].includes(String(department_code).toUpperCase())) return res.status(400).json({ok:false,error:'Invalid department_code'});
  const {rows}=await pool.query('INSERT INTO outlets(code,name,department_code) VALUES($1,$2,$3) RETURNING *',[code,name,String(department_code).toUpperCase()]);
  res.status(201).json(rows[0]);
});

app.patch('/api/outlets/:id', requireDb, async (req,res) => {
  const {name,active}=req.body||{};
  const {rows}=await pool.query('UPDATE outlets SET name=COALESCE($1,name),active=COALESCE($2,active) WHERE id=$3 RETURNING *',[name,active,req.params.id]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Outlet not found'}); res.json(rows[0]);
});



app.post('/api/coffee/items/sync', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const outlet_firestore_id=String(b.outlet_firestore_id||'').trim();
  const name=String(b.name||'').trim();
  if(!firestore_id || !outlet_firestore_id || !name) return res.status(400).json({ok:false,error:'firestore_id, outlet_firestore_id and name are required'});
  const q=`INSERT INTO coffee_items
    (firestore_id,outlet_firestore_id,name,category,uom,opening,receipt,transfer,consumption,physical_closing,landing_cost,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (firestore_id) DO UPDATE SET outlet_firestore_id=EXCLUDED.outlet_firestore_id,name=EXCLUDED.name,category=EXCLUDED.category,uom=EXCLUDED.uom,opening=EXCLUDED.opening,receipt=EXCLUDED.receipt,transfer=EXCLUDED.transfer,consumption=EXCLUDED.consumption,physical_closing=EXCLUDED.physical_closing,landing_cost=EXCLUDED.landing_cost,active=EXCLUDED.active,updated_at=NOW()
    RETURNING *`;
  const vals=[firestore_id,outlet_firestore_id,name,String(b.category||'Other'),String(b.uom||'pcs'),Number(b.opening)||0,Number(b.receipt)||0,Number(b.transfer)||0,Number(b.consumption)||0,Number(b.physicalClosing ?? b.physical_closing)||0,Number(b.landingCost ?? b.landing_cost)||0,b.active!==false];
  const {rows}=await pool.query(q,vals); res.json({ok:true,item:rows[0]});
});

app.patch('/api/coffee/items/sync/:firestoreId', requireDb, async (req,res) => {
  const b=req.body||{};
  const {rows}=await pool.query(`UPDATE coffee_items SET
    name=COALESCE($1,name),category=COALESCE($2,category),uom=COALESCE($3,uom),opening=COALESCE($4,opening),receipt=COALESCE($5,receipt),transfer=COALESCE($6,transfer),consumption=COALESCE($7,consumption),physical_closing=COALESCE($8,physical_closing),landing_cost=COALESCE($9,landing_cost),active=COALESCE($10,active),updated_at=NOW()
    WHERE firestore_id=$11 RETURNING *`,
    [b.name,b.category,b.uom,b.opening===undefined?null:Number(b.opening)||0,b.receipt===undefined?null:Number(b.receipt)||0,b.transfer===undefined?null:Number(b.transfer)||0,b.consumption===undefined?null:Number(b.consumption)||0,b.physicalClosing===undefined && b.physical_closing===undefined?null:Number(b.physicalClosing ?? b.physical_closing)||0,b.landingCost===undefined && b.landing_cost===undefined?null:Number(b.landingCost ?? b.landing_cost)||0,b.active===undefined?null:b.active,String(req.params.firestoreId)]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Coffee item mirror not found'}); res.json({ok:true,item:rows[0]});
});

app.delete('/api/coffee/items/sync/:firestoreId', requireDb, async (req,res) => {
  await pool.query('DELETE FROM coffee_items WHERE firestore_id=$1',[String(req.params.firestoreId)]); res.json({ok:true});
});

app.post('/api/food/recipes/sync', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const outlet_firestore_id=String(b.outlet_firestore_id||'').trim();
  const name=String(b.name||'').trim();
  if(!firestore_id || !outlet_firestore_id || !name) return res.status(400).json({ok:false,error:'firestore_id, outlet_firestore_id and name are required'});
  const ingredients=Array.isArray(b.ingredients)?b.ingredients:[];
  const q=`INSERT INTO food_recipes(firestore_id,outlet_firestore_id,name,recipe_code,category,yield_qty,yield_uom,selling_price,ingredients,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    ON CONFLICT(firestore_id) DO UPDATE SET outlet_firestore_id=EXCLUDED.outlet_firestore_id,name=EXCLUDED.name,recipe_code=EXCLUDED.recipe_code,category=EXCLUDED.category,yield_qty=EXCLUDED.yield_qty,yield_uom=EXCLUDED.yield_uom,selling_price=EXCLUDED.selling_price,ingredients=EXCLUDED.ingredients,active=EXCLUDED.active,updated_at=NOW()
    RETURNING *`;
  const vals=[firestore_id,outlet_firestore_id,name,String(b.recipe_code||''),String(b.category||'Main Course'),Number(b.yield_qty)>0?Number(b.yield_qty):1,String(b.yield_uom||'portion'),Number(b.selling_price)||0,JSON.stringify(ingredients),b.active!==false];
  const {rows}=await pool.query(q,vals); res.json({ok:true,recipe:rows[0]});
});

app.patch('/api/food/recipes/sync/:firestoreId', requireDb, async (req,res) => {
  const b=req.body||{};
  const ingredients=b.ingredients===undefined?null:JSON.stringify(Array.isArray(b.ingredients)?b.ingredients:[]);
  const {rows}=await pool.query(`UPDATE food_recipes SET name=COALESCE($1,name),recipe_code=COALESCE($2,recipe_code),category=COALESCE($3,category),yield_qty=COALESCE($4,yield_qty),yield_uom=COALESCE($5,yield_uom),selling_price=COALESCE($6,selling_price),ingredients=COALESCE($7::jsonb,ingredients),active=COALESCE($8,active),updated_at=NOW() WHERE firestore_id=$9 RETURNING *`,[b.name??null,b.recipe_code??null,b.category??null,b.yield_qty===undefined?null:Number(b.yield_qty)||0,b.yield_uom??null,b.selling_price===undefined?null:Number(b.selling_price)||0,ingredients,b.active===undefined?null:b.active,String(req.params.firestoreId)]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Food recipe mirror not found'});
  res.json({ok:true,recipe:rows[0]});
});

app.delete('/api/food/recipes/sync/:firestoreId', requireDb, async (req,res) => {
  await pool.query('DELETE FROM food_recipes WHERE firestore_id=$1',[String(req.params.firestoreId)]); res.json({ok:true});
});

app.post('/api/coffee/recipes/sync', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const outlet_firestore_id=String(b.outlet_firestore_id||'').trim();
  const name=String(b.name||'').trim();
  if(!firestore_id || !outlet_firestore_id || !name) return res.status(400).json({ok:false,error:'firestore_id, outlet_firestore_id and name are required'});
  const ingredients=Array.isArray(b.ingredients)?b.ingredients:[];
  const q=`INSERT INTO coffee_recipes(firestore_id,outlet_firestore_id,name,ingredients,active)
    VALUES($1,$2,$3,$4::jsonb,$5)
    ON CONFLICT(firestore_id) DO UPDATE SET outlet_firestore_id=EXCLUDED.outlet_firestore_id,name=EXCLUDED.name,ingredients=EXCLUDED.ingredients,active=EXCLUDED.active,updated_at=NOW()
    RETURNING *`;
  const {rows}=await pool.query(q,[firestore_id,outlet_firestore_id,name,JSON.stringify(ingredients),b.active!==false]);
  res.json({ok:true,recipe:rows[0]});
});

app.patch('/api/coffee/recipes/sync/:firestoreId', requireDb, async (req,res) => {
  const b=req.body||{};
  const ingredients=b.ingredients===undefined?null:JSON.stringify(Array.isArray(b.ingredients)?b.ingredients:[]);
  const {rows}=await pool.query(`UPDATE coffee_recipes SET name=COALESCE($1,name),ingredients=COALESCE($2::jsonb,ingredients),active=COALESCE($3,active),updated_at=NOW() WHERE firestore_id=$4 RETURNING *`,[b.name||null,ingredients,b.active===undefined?null:b.active,String(req.params.firestoreId)]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Coffee recipe mirror not found'});
  res.json({ok:true,recipe:rows[0]});
});

app.delete('/api/coffee/recipes/sync/:firestoreId', requireDb, async (req,res) => {
  await pool.query('DELETE FROM coffee_recipes WHERE firestore_id=$1',[String(req.params.firestoreId)]);
  res.json({ok:true});
});


app.post('/api/coffee/audit-days/sync', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const outlet_firestore_id=String(b.outlet_firestore_id||'').trim();
  const audit_date=String(b.audit_date||b.date||'').trim();
  if(!firestore_id || !outlet_firestore_id || !/^\d{4}-\d{2}-\d{2}$/.test(audit_date)) return res.status(400).json({ok:false,error:'firestore_id, outlet_firestore_id and audit_date are required'});
  const items=b.items && typeof b.items==='object' ? b.items : {};
  const q=`INSERT INTO coffee_audit_days(firestore_id,outlet_firestore_id,audit_date,items,closed,opened_at,closed_at,updated_at)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,NOW())
    ON CONFLICT (firestore_id) DO UPDATE SET outlet_firestore_id=EXCLUDED.outlet_firestore_id,audit_date=EXCLUDED.audit_date,items=EXCLUDED.items,closed=EXCLUDED.closed,opened_at=EXCLUDED.opened_at,closed_at=EXCLUDED.closed_at,updated_at=NOW()
    RETURNING *`;
  const vals=[firestore_id,outlet_firestore_id,audit_date,JSON.stringify(items),b.closed===true,b.openedAt?new Date(b.openedAt):null,b.closedAt?new Date(b.closedAt):null];
  const {rows}=await pool.query(q,vals); res.json({ok:true,day:rows[0]});
});

app.get('/api/coffee/audit-days', requireDb, async (req,res) => {
  const outlet=String(req.query.outlet||'').trim();
  const date=String(req.query.date||'').trim();
  const params=[]; let sql='SELECT * FROM coffee_audit_days WHERE 1=1';
  if(outlet){params.push(outlet);sql+=` AND outlet_firestore_id=$${params.length}`;}
  if(date){params.push(date);sql+=` AND audit_date=$${params.length}`;}
  sql+=' ORDER BY audit_date DESC';
  const {rows}=await pool.query(sql,params); res.json(rows);
});

app.patch('/api/coffee/audit-days/sync/:firestoreId', requireDb, async (req,res) => {
  const b=req.body||{}; const id=String(req.params.firestoreId);
  const items=b.items===undefined?null:JSON.stringify(b.items&&typeof b.items==='object'?b.items:{});
  const {rows}=await pool.query(`UPDATE coffee_audit_days SET items=COALESCE($1::jsonb,items),closed=COALESCE($2,closed),opened_at=COALESCE($3,opened_at),closed_at=COALESCE($4,closed_at),updated_at=NOW() WHERE firestore_id=$5 RETURNING *`,[items,b.closed===undefined?null:b.closed,b.openedAt?new Date(b.openedAt):null,b.closedAt?new Date(b.closedAt):null,id]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Coffee audit day mirror not found'});
  res.json({ok:true,day:rows[0]});
});

app.post('/api/coffee/sales', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const outlet_firestore_id=String(b.outlet_firestore_id||'').trim();
  const recipe_firestore_id=String(b.recipe_firestore_id||b.recipeId||'').trim();
  const recipe_name=String(b.recipe_name||b.recipeName||'').trim();
  const sale_date=String(b.sale_date||b.date||'').trim();
  const qty=Number(b.qty)||0;
  const amount=Number(b.amount)||0;
  const ingredients=Array.isArray(b.ingredients)?b.ingredients:[];
  if(!firestore_id || !outlet_firestore_id || !recipe_firestore_id || !recipe_name || !/^\\d{4}-\\d{2}-\\d{2}$/.test(sale_date) || qty<=0) return res.status(400).json({ok:false,error:'firestore_id, outlet_firestore_id, recipe, sale_date and positive qty are required'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query('SELECT id FROM coffee_sales WHERE firestore_id=$1',[firestore_id]);
    if(existing.rows[0]){ await client.query('COMMIT'); return res.json({ok:true,duplicate:true,sale:existing.rows[0]}); }
    for(const ing of ingredients){
      const itemId=String(ing.itemId||ing.firestoreId||'').trim();
      const consume=(Number(ing.qty)||0)*qty;
      if(!itemId || consume===0) continue;
      const r=await client.query('UPDATE coffee_items SET consumption=consumption+$1, updated_at=NOW() WHERE firestore_id=$2 AND outlet_firestore_id=$3 RETURNING id',[consume,itemId,outlet_firestore_id]);
      if(!r.rows[0]) throw new Error(`Coffee ingredient not found: ${itemId}`);
    }
    const q=`INSERT INTO coffee_sales(firestore_id,outlet_firestore_id,recipe_firestore_id,recipe_name,sale_date,qty,amount,sold_by,ts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
    const {rows}=await client.query(q,[firestore_id,outlet_firestore_id,recipe_firestore_id,recipe_name,sale_date,qty,amount,b.by||b.sold_by||null,Number(b.ts)||Date.now()]);
    await client.query('COMMIT');
    res.status(201).json({ok:true,sale:rows[0]});
  }catch(e){ await client.query('ROLLBACK'); res.status(400).json({ok:false,error:e.message||'Coffee sale failed'}); }
  finally{ client.release(); }
});

app.get('/api/coffee/sales', requireDb, async (req,res) => {
  const outlet=String(req.query.outlet||'').trim(); const from=String(req.query.from||'').trim(); const to=String(req.query.to||'').trim();
  const params=[]; let sql='SELECT * FROM coffee_sales WHERE 1=1';
  if(outlet){params.push(outlet);sql+=` AND outlet_firestore_id=$${params.length}`;}
  if(from){params.push(from);sql+=` AND sale_date >= $${params.length}`;}
  if(to){params.push(to);sql+=` AND sale_date <= $${params.length}`;}
  sql+=' ORDER BY sale_date DESC, ts DESC'; const {rows}=await pool.query(sql,params); res.json(rows);
});

app.delete('/api/coffee/sales/:firestoreId', requireDb, async (req,res) => {
  const {rows}=await pool.query('DELETE FROM coffee_sales WHERE firestore_id=$1 RETURNING *',[String(req.params.firestoreId)]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Coffee sale not found'}); res.json({ok:true,sale:rows[0]});
});

app.post('/api/coffee/sales/sync', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const outlet_firestore_id=String(b.outlet_firestore_id||'').trim();
  const recipe_firestore_id=String(b.recipe_firestore_id||'').trim();
  const recipe_name=String(b.recipe_name||'').trim();
  const sale_date=String(b.sale_date||b.date||'').trim();
  const qty=Number(b.qty);
  const amount=Number(b.amount)||0;
  const sold_by=b.sold_by?String(b.sold_by):null;
  const ingredients=Array.isArray(b.ingredients)?b.ingredients:[];
  if(!firestore_id||!outlet_firestore_id||!recipe_firestore_id||!recipe_name||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(sale_date)||!(qty>0)) return res.status(400).json({ok:false,error:'firestore_id, outlet_firestore_id, recipe_firestore_id, recipe_name, sale_date and qty are required'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query('SELECT id FROM coffee_sales WHERE firestore_id=$1',[firestore_id]);
    if(existing.rows.length){ await client.query('COMMIT'); return res.json({ok:true,duplicate:true}); }
    for(const ing of ingredients){
      const itemId=String(ing.item_firestore_id||ing.itemId||'').trim();
      const perSale=Number(ing.qty)||0;
      if(!itemId || perSale===0) continue;
      const result=await client.query(`UPDATE coffee_items SET consumption=consumption+$1,updated_at=NOW() WHERE firestore_id=$2 AND outlet_firestore_id=$3 RETURNING firestore_id`,[perSale*qty,itemId,outlet_firestore_id]);
      if(!result.rows.length) throw new Error(`Coffee item mirror not found: ${itemId}`);
    }
    const ins=await client.query(`INSERT INTO coffee_sales(firestore_id,outlet_firestore_id,recipe_firestore_id,recipe_name,qty,amount,sale_date,sold_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[firestore_id,outlet_firestore_id,recipe_firestore_id,recipe_name,qty,amount,sale_date,sold_by]);
    await client.query('COMMIT');
    res.status(201).json({ok:true,sale:ins.rows[0]});
  }catch(e){ try{await client.query('ROLLBACK')}catch{}; res.status(500).json({ok:false,error:e.message||'Coffee sale sync failed'}); }
  finally{client.release();}
});

app.get('/api/coffee/sales', requireDb, async (req,res) => {
  const outlet=String(req.query.outlet||'').trim(); const date=String(req.query.date||'').trim();
  const params=[]; let sql='SELECT * FROM coffee_sales WHERE 1=1';
  if(outlet){params.push(outlet);sql+=` AND outlet_firestore_id=$${params.length}`;}
  if(date){params.push(date);sql+=` AND sale_date=$${params.length}`;}
  sql+=' ORDER BY sale_date DESC, created_at DESC';
  const {rows}=await pool.query(sql,params); res.json(rows);
});

app.get('/api/coffee/recipes', requireDb, async (req,res) => {
  const outlet=String(req.query.outlet||'').trim();
  const params=[]; let sql='SELECT * FROM coffee_recipes WHERE active=true';
  if(outlet){params.push(outlet);sql+=' AND outlet_firestore_id=$1';}
  sql+=' ORDER BY name';
  const {rows}=await pool.query(sql,params); res.json(rows);
});



// Food Item Master mirror. Firestore remains the live source during migration.
app.post('/api/food/items/sync', requireDb, async (req,res) => {
  const b=req.body||{};
  const firestore_id=String(b.firestore_id||'').trim();
  const outlet_firestore_id=String(b.outlet_firestore_id||'').trim();
  const name=String(b.name||'').trim();
  if(!firestore_id||!outlet_firestore_id||!name) return res.status(400).json({ok:false,error:'firestore_id, outlet_firestore_id and name are required'});
  const q=`INSERT INTO food_items(firestore_id,outlet_firestore_id,name,category,unit,current_stock,par_level,vendor,unit_cost,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(firestore_id) DO UPDATE SET outlet_firestore_id=EXCLUDED.outlet_firestore_id,name=EXCLUDED.name,category=EXCLUDED.category,unit=EXCLUDED.unit,current_stock=EXCLUDED.current_stock,par_level=EXCLUDED.par_level,vendor=EXCLUDED.vendor,unit_cost=EXCLUDED.unit_cost,active=EXCLUDED.active,updated_at=NOW()
    RETURNING *`;
  const vals=[firestore_id,outlet_firestore_id,name,String(b.category||'Groceries'),String(b.unit||'pcs'),Number(b.current_stock)||0,Number(b.par_level)||0,String(b.vendor||''),Number(b.unit_cost)||0,b.active!==false];
  const {rows}=await pool.query(q,vals); res.json({ok:true,item:rows[0]});
});
app.patch('/api/food/items/sync/:firestoreId', requireDb, async (req,res) => {
  const b=req.body||{}; const id=String(req.params.firestoreId);
  const {rows}=await pool.query(`UPDATE food_items SET name=COALESCE($1,name),category=COALESCE($2,category),unit=COALESCE($3,unit),current_stock=COALESCE($4,current_stock),par_level=COALESCE($5,par_level),vendor=COALESCE($6,vendor),unit_cost=COALESCE($7,unit_cost),active=COALESCE($8,active),updated_at=NOW() WHERE firestore_id=$9 RETURNING *`,[b.name??null,b.category??null,b.unit??null,b.current_stock===undefined?null:Number(b.current_stock)||0,b.par_level===undefined?null:Number(b.par_level)||0,b.vendor??null,b.unit_cost===undefined?null:Number(b.unit_cost)||0,b.active===undefined?null:b.active,id]);
  if(!rows[0]) return res.status(404).json({ok:false,error:'Food item mirror not found'}); res.json({ok:true,item:rows[0]});
});
app.delete('/api/food/items/sync/:firestoreId', requireDb, async (req,res) => {
  await pool.query('DELETE FROM food_items WHERE firestore_id=$1',[String(req.params.firestoreId)]); res.json({ok:true});
});
app.get('/api/food/items', requireDb, async (req,res) => {
  const outlet=String(req.query.outlet||'').trim(); const params=[]; let sql='SELECT * FROM food_items WHERE active=TRUE';
  if(outlet){params.push(outlet);sql+=` AND outlet_firestore_id=$${params.length}`;} sql+=' ORDER BY category,name';
  const {rows}=await pool.query(sql,params); res.json(rows);
});
app.get('/api/coffee/items', requireDb, async (req,res) => {
  const outlet=String(req.query.outlet||'').trim();
  const params=[]; let sql='SELECT * FROM coffee_items WHERE active=true';
  if(outlet){params.push(outlet);sql+=' AND outlet_firestore_id=$1';}
  sql+=' ORDER BY category,name';
  const {rows}=await pool.query(sql,params); res.json(rows);
});

app.listen(PORT,()=>console.log(`VK Controls backend running on http://localhost:${PORT}`));
