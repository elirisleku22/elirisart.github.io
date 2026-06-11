module.exports = async function handler(req, res) {
  // ── CORS — autorise GitHub Pages à appeler cette API ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  if (!body) return res.status(400).json({ error: 'Corps manquant' });

  const { action, token, ...reqData } = body;

  if (!token) return res.status(401).json({ error: 'Token manquant' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Variables d\'environnement manquantes' });
  }

  // ── Vérifie le token JWT Supabase ──
  let user;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_KEY }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Session invalide' });
    user = await userRes.json();
  } catch (e) {
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
      const byEmail  = await sb('GET', `orders?client_email=eq.${encodeURIComponent(userEmail)}&order=created_at.desc`);
      const byUserId = await sb('GET', `orders?user_id=eq.${userId}&order=created_at.desc`);
      const all    = [...(byEmail.data || []), ...(byUserId.data || [])];
      const unique = all.filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i);
      return res.json({ orders: unique });
    }

    if (action === 'get_order') {
      const orderResult = await sb('GET', `orders?id=eq.${reqData.id}`);
      const order = Array.isArray(orderResult.data) ? orderResult.data[0] : null;
      if (order && order.user_id !== userId && order.client_email !== userEmail) {
        return res.status(403).json({ error: 'Accès interdit' });
      }
      return res.json({ order: order || null });
    }

    if (action === 'get_messages') {
      const orderResult = await sb('GET', `orders?id=eq.${reqData.order_id}`);
      const order = Array.isArray(orderResult.data) ? orderResult.data[0] : null;
      if (!order || (order.user_id !== userId && order.client_email !== userEmail)) {
        return res.status(403).json({ error: 'Accès interdit' });
      }
      const msgResult = await sb('GET', `messages?order_id=eq.${reqData.order_id}&order=created_at.asc`);
      return res.json({ messages: Array.isArray(msgResult.data) ? msgResult.data : [] });
    }

    if (action === 'send_message') {
      const orderResult = await sb('GET', `orders?id=eq.${reqData.order_id}`);
      const order = Array.isArray(orderResult.data) ? orderResult.data[0] : null;
      if (!order || (order.user_id !== userId && order.client_email !== userEmail)) {
        return res.status(403).json({ error: 'Accès interdit' });
      }
      await sb('POST', 'messages', {
        order_id: reqData.order_id,
        sender: 'client',
        text: reqData.text || null,
        image: reqData.image || null,
        user_id: userId,
        created_at: Date.now()
      });
      return res.json({ ok: true });
    }

    if (action === 'submit_payment') {
      const orderResult = await sb('GET', `orders?id=eq.${reqData.order_id}`);
      const order = Array.isArray(orderResult.data) ? orderResult.data[0] : null;
      if (!order || (order.user_id !== userId && order.client_email !== userEmail)) {
        return res.status(403).json({ error: 'Accès interdit' });
      }
      await sb('PATCH', `orders?id=eq.${reqData.order_id}`, {
        payment_status: 'pending',
        payment_method: reqData.method,
        payment_ref:    reqData.ref,
        payment_acompte: reqData.acompte
      });
      const methodLabel = reqData.method === 'airtel' ? 'Airtel Money' : 'M-Pesa';
      await sb('POST', 'messages', {
        order_id: reqData.order_id,
        sender: 'system',
        text: `💳 Paiement soumis\nMéthode : ${methodLabel}\nRéférence : ${reqData.ref}\nMontant (10%) : ${reqData.acompte} $\n⏳ En attente de confirmation par l'artiste.`,
        created_at: Date.now()
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue : ' + action });

  } catch (err) {
    console.error('Client API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};
