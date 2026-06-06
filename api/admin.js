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

  if (!password || password !== process.env.ADMIN_PASSWORD) {
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
    if (action === 'get_orders') {
      const { data } = await sb('GET', 'orders?order=created_at.desc');
      return res.json({ orders: data || [] });
    }
    if (action === 'upsert_banner') {
      await sb('POST', 'banner?on_conflict=id', { id: 'main', ...data });
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

    return res.status(400).json({ error: 'Action inconnue : ' + action });

  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};
