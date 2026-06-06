const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // Parse body manuellement si nécessaire
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  if (!body) {
    return res.status(400).json({ error: 'Corps de requête manquant' });
  }

  const { action, password, ...data } = body;

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Variables d\'environnement manquantes' });
  }

  const supa = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    if (action === 'get_orders') {
      const { data: orders, error } = await supa.from('orders').select('*').order('created_at', { ascending: false });
      return res.json({ orders: orders || [], error });
    }
    if (action === 'upsert_banner') {
      const { error } = await supa.from('banner').upsert({ id: 'main', ...data });
      return res.json({ error });
    }
    if (action === 'insert_gallery') {
      const { error } = await supa.from('gallery').insert(data);
      return res.json({ error });
    }
    if (action === 'delete_gallery') {
      const { error } = await supa.from('gallery').delete().eq('id', data.id);
      return res.json({ error });
    }
    if (action === 'insert_blog') {
      const { error } = await supa.from('blog').insert(data);
      return res.json({ error });
    }
    if (action === 'update_blog') {
      const { id, ...rest } = data;
      const { error } = await supa.from('blog').update(rest).eq('id', id);
      return res.json({ error });
    }
    if (action === 'delete_blog') {
      const { error } = await supa.from('blog').delete().eq('id', data.id);
      return res.json({ error });
    }
    if (action === 'delete_testimonial') {
      const { error } = await supa.from('testimonials').delete().eq('id', data.id);
      return res.json({ error });
    }
    if (action === 'update_order_status') {
      const { error } = await supa.from('orders').update({ status: data.status }).eq('id', data.id);
      return res.json({ error });
    }
    if (action === 'clear_orders') {
      const { error } = await supa.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      return res.json({ error });
    }

    return res.status(400).json({ error: 'Action inconnue : ' + action });

  } catch (err) {
    console.error('Admin API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};
