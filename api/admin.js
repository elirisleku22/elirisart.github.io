module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  if (!body) return res.status(400).json({ error: 'Corps manquant' });

  const { action, password, ...data } = body;

  // Les photos clients utilisent un token spécial basé sur le N° commande
  const isPhotoUpload = action === 'save_order_photo' && password && password.startsWith('CLIENT_PHOTO_');
  const isAdmin = password === process.env.ADMIN_PASSWORD;

  if (!isAdmin && !isPhotoUpload) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Fonction utilitaire pour appeler Supabase REST directement (sans SDK)
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
    if (action === 'get_order') {
      const { data: order } = await sb('GET', `orders?id=eq.${data.id}`);
      return res.json({ order: Array.isArray(order) ? order[0] : null });
    }
    if (action === 'send_admin_message') {
      await sb('POST', 'messages', {
        order_id: data.order_id,
        sender: 'admin',
        text: data.text || null,
        image: data.image || null,
        created_at: Date.now()
      });
      return res.json({ ok: true });
    }
    if (action === 'confirm_payment') {
      await sb('PATCH', `orders?id=eq.${data.order_id}`, { payment_status: 'confirmed' });
      return res.json({ ok: true });
    }
    if (action === 'get_orders') {
      const { data } = await sb('GET', 'orders?order=created_at.desc');
      return res.json({ orders: data || [] });
    }
    if (action === 'upsert_banner') {
      // Essaie d'abord un UPDATE, sinon INSERT
      const upd = await sb('PATCH', 'banner?id=eq.main', { text: data.text, active: data.active });
      if (upd.status === 404 || (Array.isArray(upd.data) && upd.data.length === 0)) {
        await sb('POST', 'banner', { id: 'main', text: data.text, active: data.active });
      }
      return res.json({ error: null });
    }
    if (action === 'insert_gallery') {
      await sb('POST', 'gallery', data);
      return res.json({ error: null });
    }
    if (action === 'delete_gallery') {
      await sb('DELETE', `gallery?id=eq.${data.id}`);
      return res.json({ error: null });
    }
    if (action === 'insert_blog') {
      await sb('POST', 'blog', data);
      return res.json({ error: null });
    }
    if (action === 'update_blog') {
      const { id, ...rest } = data;
      await sb('PATCH', `blog?id=eq.${id}`, rest);
      return res.json({ error: null });
    }
    if (action === 'delete_blog') {
      await sb('DELETE', `blog?id=eq.${data.id}`);
      return res.json({ error: null });
    }
    if (action === 'delete_testimonial') {
      await sb('DELETE', `testimonials?id=eq.${data.id}`);
      return res.json({ error: null });
    }
    if (action === 'update_order_status') {
      await sb('PATCH', `orders?id=eq.${data.id}`, { status: data.status });
      return res.json({ error: null });
    }
    if (action === 'clear_orders') {
      await sb('DELETE', 'orders?id=neq.00000000-0000-0000-0000-000000000000');
      return res.json({ error: null });
    }
    if (action === 'save_order_photo') {
      // Sauvegarde une photo liée à une commande (base64 + order_num)
      const { error } = await sb('POST', 'order_photos', {
        order_num: data.order_num,
        client_name: data.client_name,
        photo: data.photo, // base64
        created_at: Date.now()
      });
      return res.json({ error });
    }
    if (action === 'get_order_photos') {
      // Récupère les photos d'une commande spécifique (admin uniquement)
      const { data: photos } = await sb('GET', `order_photos?order_num=eq.${data.order_num}&order=created_at.desc`);
      return res.json({ photos: photos || [] });
    }
    if (action === 'get_all_photos') {
      // Récupère toutes les photos (admin uniquement)
      const { data: photos } = await sb('GET', 'order_photos?order=created_at.desc');
      return res.json({ photos: photos || [] });
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
