module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  if (!body) return res.status(400).json({ error: 'Corps manquant' });

  const { action, token, ...data } = body;

  if (!token) return res.status(401).json({ error: 'Token manquant' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Variables d\'environnement manquantes' });
  }

  // Vérifie le token JWT
  let user;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_KEY }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Session invalide' });
    user = await userRes.json();
  } catch(e) {
    return res.status(500).json({ error: 'Erreur auth: ' + e.message });
  }

  const userId    = user.id;
  const userEmail = user.email;

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
    if (action === 'get_my_orders') {
      // Cherche par email OU par user_id pour compatibilité
      const { data: byEmail } = await sb('GET', `orders?client_email=eq.${encodeURIComponent(userEmail)}&order=created_at.desc`);
      const { data: byUserId } = await sb('GET', `orders?user_id=eq.${userId}&order=created_at.desc`);
      // Fusionne et déduplique
      const all = [...(byEmail || []), ...(byUserId || [])];
      const unique = all.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
      return res.json({ orders: unique });
    }

    if (action === 'get_order') {
      const { data } = await sb('GET', `orders?id=eq.${data.id}`);
      const order = Array.isArray(data) ? data[0] : null;
      return res.json({ order });
    }

    if (action === 'send_message') {
      await sb('POST', 'messages', {
        order_id: data.order_id,
        sender: 'client',
        text: data.text || null,
        image: data.image || null,
        user_id: userId,
        created_at: Date.now()
      });
      return res.json({ ok: true });
    }

    if (action === 'submit_payment') {
      await sb('PATCH', `orders?id=eq.${data.order_id}`, {
        payment_status: 'pending',
        payment_method: data.method,
        payment_ref: data.ref,
        payment_acompte: data.acompte
      });
      await sb('POST', 'messages', {
        order_id: data.order_id,
        sender: 'system',
        text: `💳 Paiement soumis — ${data.method === 'airtel' ? 'Airtel Money' : 'M-Pesa'} — Réf: ${data.ref} — Acompte: ${data.acompte} $ — En attente de confirmation.`,
        created_at: Date.now()
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue: ' + action });

  } catch(err) {
    console.error('Client API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};
