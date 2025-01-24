// server.js
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
});

// Inicializace databáze
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255),
        opened BOOLEAN DEFAULT false,
        clicked BOOLEAN DEFAULT false,
        last_opened TIMESTAMP,
        last_clicked TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tracking (
        id SERIAL PRIMARY KEY,
        contact_id INTEGER REFERENCES contacts(id),
        tracking_id VARCHAR(32) UNIQUE NOT NULL,
        campaign_name VARCHAR(255),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        opened_at TIMESTAMP,
        clicked_at TIMESTAMP
      );
    `);
  } finally {
    client.release();
  }
}

initDB();

// Tracking endpoints
app.post('/track/register', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { email, name, campaign } = req.body;
    const trackingId = crypto.randomBytes(16).toString('hex');

    const contactResult = await client.query(
      'INSERT INTO contacts (email, name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id',
      [email, name]
    );

    await client.query(
      'INSERT INTO tracking (contact_id, tracking_id, campaign_name) VALUES ($1, $2, $3)',
      [contactResult.rows[0].id, trackingId, campaign]
    );

    await client.query('COMMIT');
    res.status(201).json({ trackingId });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Chyba registrace' });
  } finally {
    client.release();
  }
});

app.get('/track/:id/open.gif', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const result = await client.query(
      'UPDATE tracking SET opened_at = CURRENT_TIMESTAMP WHERE tracking_id = $1 RETURNING contact_id',
      [req.params.id]
    );

    if (result.rows[0]) {
      await client.query(
        'UPDATE contacts SET opened = true, last_opened = CURRENT_TIMESTAMP WHERE id = $1',
        [result.rows[0].contact_id]
      );
    }

    await client.query('COMMIT');
    
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': gif.length,
      'Cache-Control': 'no-store'
    });
    res.end(gif);
  } catch (error) {
    await client.query('ROLLBACK');
    res.end(gif);
  } finally {
    client.release();
  }
});

app.get('/track/:id/click', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const result = await client.query(
      'UPDATE tracking SET clicked_at = CURRENT_TIMESTAMP WHERE tracking_id = $1 RETURNING contact_id',
      [req.params.id]
    );

    if (result.rows[0]) {
      await client.query(
        'UPDATE contacts SET clicked = true, last_clicked = CURRENT_TIMESTAMP WHERE id = $1',
        [result.rows[0].contact_id]
      );
    }

    await client.query('COMMIT');
    res.redirect(req.query.url);
  } catch (error) {
    await client.query('ROLLBACK');
    res.redirect(req.query.url || '/');
  } finally {
    client.release();
  }
});

// Dashboard endpoints
app.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN opened THEN 1 END) as opened,
        COUNT(CASE WHEN clicked THEN 1 END) as clicked
      FROM contacts
    `);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Chyba statistik' });
  }
});

app.get('/contacts/filter', async (req, res) => {
  const { type } = req.query;
  try {
    let query = 'SELECT name, email FROM contacts WHERE 1=1';
    if (type === 'clicked') query += ' AND clicked = true';
    if (type === 'opened') query += ' AND opened = true AND clicked = false';
    if (type === 'inactive') query += ' AND opened = false';
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Chyba filtru' });
  }
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));