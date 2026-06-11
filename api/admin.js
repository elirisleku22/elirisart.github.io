module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  if (!body) return res.status(400).json({ error: 'Corps manquant' });

  // ⚠️ CORRECTION : renommé ...reqData pour éviter le shadowing de `data` plus bas
  const { action, password, ...reqData } = body;

  const isPhotoUpload = action === 'save_order_photo' && password && password.startsWith('CLIENT_PHOTO_');
  const isAdmin = password === process.env.ADMIN_PASSWORD;

  if (!isAdmin && !isPhotoUpload) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  async function sb(method, path, bodyData) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const opts = {
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
      }
    };
    if (bodyData) opts.body = JSON.stringify(bodyData);
    const r = await fetch(url, opts);
    const text = await r.text();
    try { return { data: JSON.parse(text), status: r.status }; }
    catch { return { data: text, status: r.status }; }
  }

  try {

    // ─── COMMANDES ───────────────────────────────────────
    if (action === 'get_orders') {
      // ⚠️ CORRECTION : renommé result pour éviter le shadowing de reqData
      const result = await sb('GET', 'orders?order=created_at.desc');
      return res.json({ orders: result.data || [] });
    }

    if (action === 'get_order') {
      // ⚠️ CORRECTION : renommé result pour éviter le shadowing
      const result = await sb('GET', `orders?id=eq.${reqData.id}`);
      return res.json({ order: Array.isArray(result.data) ? result.data[0] : null });
    }

    if (action === 'update_order_status') {
      await sb('PATCH', `orders?id=eq.${reqData.id}`, { status: reqData.status });
      return res.json({ error: null });
    }

    if (action === 'confirm_payment') {
      await sb('PATCH', `orders?id=eq.${reqData.order_id}`, { payment_status: 'confirmed' });
      return res.json({ ok: true });
    }

    if (action === 'clear_orders') {
      await sb('DELETE', 'orders?id=neq.00000000-0000-0000-0000-000000000000');
      return res.json({ error: null });
    }

    // ─── MESSAGES ────────────────────────────────────────
    // ⚠️ AJOUT : action get_messages manquante → causait "Action inconnue" dans admin
    if (action === 'get_messages') {
      const result = await sb('GET', `messages?order_id=eq.${reqData.order_id}&order=created_at.asc`);
      return res.json({ messages: Array.isArray(result.data) ? result.data : [] });
    }

    if (action === 'send_admin_message') {
      await sb('POST', 'messages', {
        order_id: reqData.order_id,
        sender: 'admin',
        text: reqData.text || null,
        image: reqData.image || null,
        created_at: Date.now()
      });
      return res.json({ ok: true });
    }

    if (action === 'delete_message') {
      await sb('DELETE', `messages?id=eq.${reqData.id}`);
      return res.json({ ok: true });
    }

    // ─── GALERIE ─────────────────────────────────────────
    if (action === 'insert_gallery') {
      await sb('POST', 'gallery', reqData);
      return res.json({ error: null });
    }

    if (action === 'delete_gallery') {
      await sb('DELETE', `gallery?id=eq.${reqData.id}`);
      return res.json({ error: null });
    }

    // ─── BLOG ─────────────────────────────────────────────
    if (action === 'insert_blog') {
      await sb('POST', 'blog', reqData);
      return res.json({ error: null });
    }

    if (action === 'update_blog') {
      const { id, ...rest } = reqData;
      await sb('PATCH', `blog?id=eq.${id}`, rest);
      return res.json({ error: null });
    }

    if (action === 'delete_blog') {
      await sb('DELETE', `blog?id=eq.${reqData.id}`);
      return res.json({ error: null });
    }

    // ─── BANNIÈRE ─────────────────────────────────────────
    if (action === 'upsert_banner') {
      const upd = await sb('PATCH', 'banner?id=eq.main', { text: reqData.text, active: reqData.active });
      if (upd.status === 404 || (Array.isArray(upd.data) && upd.data.length === 0)) {
        await sb('POST', 'banner', { id: 'main', text: reqData.text, active: reqData.active });
      }
      return res.json({ error: null });
    }

    // ─── TÉMOIGNAGES ──────────────────────────────────────
    if (action === 'delete_testimonial') {
      await sb('DELETE', `testimonials?id=eq.${reqData.id}`);
      return res.json({ error: null });
    }

    // ─── PHOTOS COMMANDES ─────────────────────────────────
    if (action === 'save_order_photo') {
      await sb('POST', 'order_photos', {
        order_num: reqData.order_num,
        client_name: reqData.client_name,
        photo: reqData.photo,
        created_at: Date.now()
      });
      return res.json({ error: null });
    }

    if (action === 'get_order_photos') {
      const result = await sb('GET', `order_photos?order_num=eq.${reqData.order_num}&order=created_at.desc`);
      return res.json({ photos: result.data || [] });
    }

    if (action === 'get_all_photos') {
      const result = await sb('GET', 'order_photos?order=created_at.desc');
      return res.json({ photos: result.data || [] });
    }

    return res.status(400).json({ error: 'Action inconnue : ' + action });

  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};
