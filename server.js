const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/vk_controls',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Root route (FIX for "Cannot GET /")
app.get('/', (req, res) => {
  res.json({ 
    message: 'VK Controls Backend API',
    status: 'online',
    version: '9.0',
    endpoints: {
      outlets: '/api/outlets/sync',
      coffee_items: '/api/coffee/items/sync',
      coffee_recipes: '/api/coffee/recipes/sync',
      coffee_audit: '/api/coffee/audit-days/sync',
      coffee_sales: '/api/coffee/sales/sync',
      food_items: '/api/food/items/sync',
      food_recipes: '/api/food/recipes/sync'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Outlets endpoints
app.post('/api/outlets/sync', async (req, res) => {
  try {
    const { outlets } = req.body;
    if (!outlets || !Array.isArray(outlets)) {
      return res.status(400).json({ error: 'Invalid outlets format' });
    }
    
    for (const outlet of outlets) {
      await pool.query(
        `INSERT INTO outlets (firestore_id, name, active, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (firestore_id) DO UPDATE SET
         name = $2, active = $3, updated_at = NOW()`,
        [outlet.firestore_id, outlet.name, outlet.active !== false]
      );
    }
    
    res.json({ success: true, synced: outlets.length });
  } catch (error) {
    console.error('Outlets sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/outlets/sync', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM outlets WHERE active = true ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Coffee Items endpoints
app.post('/api/coffee/items/sync', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Invalid items format' });
    }
    
    for (const item of items) {
      await pool.query(
        `INSERT INTO coffee_items (firestore_id, outlet_firestore_id, name, unit, par_level, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (firestore_id) DO UPDATE SET
         name = $3, unit = $4, par_level = $5, active = $6, updated_at = NOW()`,
        [item.firestore_id, item.outlet_firestore_id, item.name, item.unit, item.par_level, item.active !== false]
      );
    }
    
    res.json({ success: true, synced: items.length });
  } catch (error) {
    console.error('Coffee items sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/coffee/items/sync', async (req, res) => {
  try {
    const { outlet_id } = req.query;
    let query = 'SELECT * FROM coffee_items WHERE active = true';
    const params = [];
    
    if (outlet_id) {
      query += ' AND outlet_firestore_id = $1';
      params.push(outlet_id);
    }
    
    query += ' ORDER BY name LIMIT 1000';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Coffee Recipes endpoints
app.post('/api/coffee/recipes/sync', async (req, res) => {
  try {
    const { recipes } = req.body;
    if (!recipes || !Array.isArray(recipes)) {
      return res.status(400).json({ error: 'Invalid recipes format' });
    }
    
    for (const recipe of recipes) {
      await pool.query(
        `INSERT INTO coffee_recipes (firestore_id, outlet_firestore_id, item_firestore_id, ingredients, cost_per_unit, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (firestore_id) DO UPDATE SET
         ingredients = $4, cost_per_unit = $5, active = $6, updated_at = NOW()`,
        [recipe.firestore_id, recipe.outlet_firestore_id, recipe.item_firestore_id, JSON.stringify(recipe.ingredients || []), recipe.cost_per_unit, recipe.active !== false]
      );
    }
    
    res.json({ success: true, synced: recipes.length });
  } catch (error) {
    console.error('Coffee recipes sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/coffee/recipes/sync', async (req, res) => {
  try {
    const { outlet_id } = req.query;
    let query = 'SELECT * FROM coffee_recipes WHERE active = true';
    const params = [];
    
    if (outlet_id) {
      query += ' AND outlet_firestore_id = $1';
      params.push(outlet_id);
    }
    
    query += ' ORDER BY item_firestore_id LIMIT 1000';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Coffee Audit Days endpoints
app.post('/api/coffee/audit-days/sync', async (req, res) => {
  try {
    const { audit_days } = req.body;
    if (!audit_days || !Array.isArray(audit_days)) {
      return res.status(400).json({ error: 'Invalid audit_days format' });
    }
    
    for (const audit of audit_days) {
      await pool.query(
        `INSERT INTO coffee_audit_days (firestore_id, outlet_firestore_id, audit_date, items, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (firestore_id) DO UPDATE SET
         items = $4, notes = $5, updated_at = NOW()`,
        [audit.firestore_id, audit.outlet_firestore_id, audit.audit_date, JSON.stringify(audit.items || []), audit.notes]
      );
    }
    
    res.json({ success: true, synced: audit_days.length });
  } catch (error) {
    console.error('Coffee audit sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/coffee/audit-days/sync', async (req, res) => {
  try {
    const { outlet_id, limit = 1000 } = req.query;
    let query = 'SELECT * FROM coffee_audit_days';
    const params = [];
    
    if (outlet_id) {
      query += ' WHERE outlet_firestore_id = $1';
      params.push(outlet_id);
    }
    
    query += ` ORDER BY audit_date DESC LIMIT ${Math.min(parseInt(limit) || 1000, 10000)}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Coffee Sales endpoints
app.post('/api/coffee/sales/sync', async (req, res) => {
  try {
    const { sales } = req.body;
    if (!sales || !Array.isArray(sales)) {
      return res.status(400).json({ error: 'Invalid sales format' });
    }
    
    for (const sale of sales) {
      await pool.query(
        `INSERT INTO coffee_sales (firestore_id, outlet_firestore_id, item_firestore_id, sale_date, qty_sold, price, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (firestore_id) DO UPDATE SET
         qty_sold = $5, price = $6, updated_at = NOW()`,
        [sale.firestore_id, sale.outlet_firestore_id, sale.item_firestore_id, sale.sale_date, sale.qty_sold, sale.price]
      );
    }
    
    res.json({ success: true, synced: sales.length });
  } catch (error) {
    console.error('Coffee sales sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/coffee/sales/sync', async (req, res) => {
  try {
    const { outlet_id, start_date, end_date, limit = 1000 } = req.query;
    let query = 'SELECT * FROM coffee_sales WHERE 1=1';
    const params = [];
    
    if (outlet_id) {
      query += ' AND outlet_firestore_id = $' + (params.length + 1);
      params.push(outlet_id);
    }
    
    if (start_date) {
      query += ' AND sale_date >= $' + (params.length + 1);
      params.push(start_date);
    }
    
    if (end_date) {
      query += ' AND sale_date <= $' + (params.length + 1);
      params.push(end_date);
    }
    
    query += ` ORDER BY sale_date DESC LIMIT ${Math.min(parseInt(limit) || 1000, 10000)}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Food Items endpoints
app.post('/api/food/items/sync', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Invalid items format' });
    }
    
    for (const item of items) {
      await pool.query(
        `INSERT INTO food_items (firestore_id, outlet_firestore_id, name, category, unit, par_level, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (firestore_id) DO UPDATE SET
         name = $3, category = $4, unit = $5, par_level = $6, active = $7, updated_at = NOW()`,
        [item.firestore_id, item.outlet_firestore_id, item.name, item.category, item.unit, item.par_level, item.active !== false]
      );
    }
    
    res.json({ success: true, synced: items.length });
  } catch (error) {
    console.error('Food items sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/food/items/sync', async (req, res) => {
  try {
    const { outlet_id, limit = 1000 } = req.query;
    let query = 'SELECT * FROM food_items WHERE active = true';
    const params = [];
    
    if (outlet_id) {
      query += ' AND outlet_firestore_id = $1';
      params.push(outlet_id);
    }
    
    query += ` ORDER BY name LIMIT ${Math.min(parseInt(limit) || 1000, 10000)}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Food Recipes endpoints
app.post('/api/food/recipes/sync', async (req, res) => {
  try {
    const { recipes } = req.body;
    if (!recipes || !Array.isArray(recipes)) {
      return res.status(400).json({ error: 'Invalid recipes format' });
    }
    
    for (const recipe of recipes) {
      await pool.query(
        `INSERT INTO food_recipes (firestore_id, outlet_firestore_id, item_firestore_id, ingredients, cost_per_unit, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (firestore_id) DO UPDATE SET
         ingredients = $4, cost_per_unit = $5, active = $6, updated_at = NOW()`,
        [recipe.firestore_id, recipe.outlet_firestore_id, recipe.item_firestore_id, JSON.stringify(recipe.ingredients || []), recipe.cost_per_unit, recipe.active !== false]
      );
    }
    
    res.json({ success: true, synced: recipes.length });
  } catch (error) {
    console.error('Food recipes sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/food/recipes/sync', async (req, res) => {
  try {
    const { outlet_id, limit = 1000 } = req.query;
    let query = 'SELECT * FROM food_recipes WHERE active = true';
    const params = [];
    
    if (outlet_id) {
      query += ' AND outlet_firestore_id = $1';
      params.push(outlet_id);
    }
    
    query += ` ORDER BY item_firestore_id LIMIT ${Math.min(parseInt(limit) || 1000, 10000)}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`VK Controls Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
