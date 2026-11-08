// backend/server.js — Production REST API Server for Makeen PostgreSQL Backend
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool, testConnection } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 1. Health check & DB status
app.get('/api/health', async (req, res) => {
  const dbStatus = await testConnection();
  res.json({
    status: 'ok',
    service: 'Makeen PostgreSQL API Server',
    version: '2.0.0',
    database: dbStatus
  });
});

// 2. List Community Shares
app.get('/api/community', async (req, res) => {
  try {
    const { type, sort, author_id, q } = req.query;
    let query = 'SELECT * FROM community_shares WHERE 1=1';
    const params = [];

    if (type && type !== 'all') {
      params.push(type);
      query += ` AND type = $${params.length}`;
    }

    if (author_id) {
      params.push(author_id);
      query += ` AND author_id = $${params.length}`;
    }

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      query += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR LOWER(author_name) LIKE $${params.length})`;
    }

    if (sort === 'rating') {
      query += ' ORDER BY rating DESC, visits DESC';
    } else if (sort === 'newest') {
      query += ' ORDER BY created_at DESC';
    } else {
      query += ' ORDER BY visits DESC, created_at DESC';
    }

    const result = await pool.query(query, params);
    const mapped = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      titleEn: row.title_en,
      description: row.description,
      descriptionEn: row.description_en,
      author: row.author_name,
      authorAvatar: row.author_avatar,
      authorId: row.author_id,
      isAnonymous: row.is_anonymous,
      category: row.category,
      isPaid: row.is_paid,
      price: Number(row.price),
      currency: row.currency,
      visits: row.visits,
      rating: Number(row.rating),
      ratingsCount: row.ratings_count,
      itemsCount: row.items_count,
      totalDurationSeconds: row.total_duration_seconds,
      thumbnail: row.thumbnail,
      items: row.items_json || [],
      pathCourses: row.path_courses_json || [],
      playlistData: row.playlist_data_json,
      pdfData: row.pdf_data_json,
      cardsData: row.cards_data_json,
      noteContent: row.note_content,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime()
    }));

    res.json({ ok: true, count: mapped.length, shares: mapped });
  } catch (err) {
    console.error('Failed to list community shares:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Publish Community Share
app.post('/api/community', async (req, res) => {
  try {
    const data = req.body;
    const id = data.id || `comm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const type = data.type || 'playlist';
    const title = (data.title || '').trim();
    const titleEn = data.titleEn || title;
    const authorName = data.isAnonymous ? 'مشارك مجهول (Anonymous)' : (data.author || 'طالب مَكِين');
    const authorAvatar = data.isAnonymous ? '' : (data.authorAvatar || '');
    const authorId = data.creatorId || data.authorId || 'guest';
    const isPaid = Boolean(data.isPaid && Number(data.price) > 0);
    const price = isPaid ? Math.max(0, Number(data.price)) : 0;
    const items = Array.isArray(data.items) ? data.items : [];
    const pathCourses = Array.isArray(data.pathCourses) ? data.pathCourses : [];
    const totalDurationSeconds = Number(data.totalDurationSeconds) || 0;

    const query = `
      INSERT INTO community_shares (
        id, type, title, title_en, description, description_en,
        author_id, author_name, author_avatar, is_anonymous, category,
        is_paid, price, currency, visits, rating, ratings_count,
        items_count, total_duration_seconds, thumbnail, items_json,
        path_courses_json, playlist_data_json, pdf_data_json, cards_data_json,
        note_content, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23, $24, $25,
        $26, NOW(), NOW()
      )
      RETURNING *;
    `;

    const values = [
      id, type, title, titleEn, data.description || '', data.descriptionEn || '',
      authorId, authorName, authorAvatar, Boolean(data.isAnonymous), data.category || 'general',
      isPaid, price, data.currency || 'EGP', 1, 5.0, 1,
      data.itemsCount || items.length || 1, totalDurationSeconds, data.thumbnail || '',
      JSON.stringify(items), JSON.stringify(pathCourses),
      data.playlistData ? JSON.stringify(data.playlistData) : null,
      data.pdfData ? JSON.stringify(data.pdfData) : null,
      data.cardsData ? JSON.stringify(data.cardsData) : null,
      data.noteContent || ''
    ];

    const result = await pool.query(query, values);
    res.json({ ok: true, share: result.rows[0] });
  } catch (err) {
    console.error('Failed to publish share:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Update Community Share
app.put('/api/community/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const query = `
      UPDATE community_shares SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        thumbnail = COALESCE($3, thumbnail),
        is_paid = COALESCE($4, is_paid),
        price = COALESCE($5, price),
        items_json = COALESCE($6, items_json),
        path_courses_json = COALESCE($7, path_courses_json),
        total_duration_seconds = COALESCE($8, total_duration_seconds),
        updated_at = NOW()
      WHERE id = $9
      RETURNING *;
    `;

    const values = [
      data.title, data.description, data.thumbnail,
      data.isPaid !== undefined ? Boolean(data.isPaid) : null,
      data.price !== undefined ? Number(data.price) : null,
      data.items ? JSON.stringify(data.items) : null,
      data.pathCourses ? JSON.stringify(data.pathCourses) : null,
      data.totalDurationSeconds !== undefined ? Number(data.totalDurationSeconds) : null,
      id
    ];

    const result = await pool.query(query, values);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Share not found' });
    }
    res.json({ ok: true, share: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Delete Community Share
app.delete('/api/community/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM community_shares WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. Record Share Visit
app.post('/api/community/:id/visit', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE community_shares SET visits = visits + 1 WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 7. Orders: Submit & Verify Payments
app.get('/api/orders', async (req, res) => {
  try {
    const { share_id, buyer_id } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (share_id) {
      params.push(share_id);
      query += ` AND share_id = $${params.length}`;
    }
    if (buyer_id) {
      params.push(buyer_id);
      query += ` AND buyer_id = $${params.length}`;
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json({ ok: true, orders: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const data = req.body;
    const id = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const query = `
      INSERT INTO orders (
        id, share_id, share_title, share_price, buyer_id, buyer_name,
        buyer_email, buyer_note, receipt_image, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
      RETURNING *;
    `;
    const values = [
      id, data.shareId, data.shareTitle, data.sharePrice,
      data.buyerId || 'guest', data.buyerName || 'طالب مَكِين',
      data.buyerEmail || '', data.buyerNote || '', data.receiptImage || ''
    ];
    const result = await pool.query(query, values);
    res.json({ ok: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const query = `
      UPDATE orders SET status = $1, reviewed_at = NOW()
      WHERE id = $2 RETURNING *;
    `;
    const result = await pool.query(query, [status, id]);
    res.json({ ok: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 8. Reviews
app.get('/api/community/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM reviews WHERE share_id = $1 ORDER BY created_at DESC', [id]);
    res.json({ ok: true, reviews: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/community/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userName, rating, comment } = req.body;
    const revId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const numRating = Math.max(1, Math.min(5, Number(rating) || 5));

    await pool.query(
      'INSERT INTO reviews (id, share_id, user_id, user_name, rating, comment, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [revId, id, userId || 'guest', userName || 'طالب مَكِين', numRating, comment || '']
    );

    // Recalculate average rating on share
    const agg = await pool.query('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE share_id = $1', [id]);
    const avg = Number(agg.rows[0].avg_rating) || 5.0;
    const count = Number(agg.rows[0].count) || 1;

    await pool.query('UPDATE community_shares SET rating = $1, ratings_count = $2 WHERE id = $3', [avg, count, id]);

    res.json({ ok: true, rating: avg, count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Makeen PostgreSQL API Server running on port ${PORT}`);
});
