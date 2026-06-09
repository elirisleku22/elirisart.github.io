module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON invalide' }); }
  }
  if (!body) return res.status(400).json({ error: 'Corps manquant' });

  const { action, token, ...data } = body;

  // Vérifie le token JWT Supabase
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  // Récupère l'utilisateur via Supabase Auth
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  // Vérifie le JWT
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Session invalide' });
  const user = await userRes.json();
  const userId = user.id;
  const userEmail = user.email;

  // Appel REST Supabase avec service role
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
    // ── Récupère les commandes du client (par email) ──────
    if (action === 'get_my_orders') {
      const { data: orders } = await sb('GET', `orders?client_email=eq.${encodeURIComponent(userEmail)}&order=created_at.desc`);
      return res.json({ orders: orders || [] });
    }

    // ── Récupère une commande spécifique (vérifie qu'elle appartient au client) ──
    if (action === 'get_order') {
      const { data } = await sb('GET', `orders?id=eq.${data.id}&client_email=eq.${encodeURIComponent(userEmail)}`);
      return res.json({ order: Array.isArray(data) ? data[0] : null });
    }

    // ── Envoie un message ──────────────────────────────────
    if (action === 'send_message') {
      // Vérifie que la commande appartient à ce client
      const { data: orderCheck } = await sb('GET', `orders?id=eq.${data.order_id}&client_email=eq.${encodeURIComponent(userEmail)}`);
      if (!orderCheck || orderCheck.length === 0) return res.status(403).json({ error: 'Accès refusé' });

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

    // ── Soumet un paiement ────────────────────────────────
    if (action === 'submit_payment') {
      const { data: orderCheck } = await sb('GET', `orders?id=eq.${data.order_id}&client_email=eq.${encodeURIComponent(userEmail)}`);
      if (!orderCheck || orderCheck.length === 0) return res.status(403).json({ error: 'Accès refusé' });

      await sb('PATCH', `orders?id=eq.${data.order_id}`, {
        payment_status: 'pending',
        payment_method: data.method,
        payment_ref: data.ref,
        payment_acompte: data.acompte
      });
      // Message automatique dans la conversation
      await sb('POST', 'messages', {
        order_id: data.order_id,
        sender: 'system',
        text: `💳 Paiement soumis — ${data.method === 'airtel' ? 'Airtel Money' : 'M-Pesa'} — Réf: ${data.ref} — Acompte: ${data.acompte} $ — En attente de confirmation.`,
        created_at: Date.now()
      });
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Action inconnue' });

  } catch(err) {
    console.error('Client API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};
