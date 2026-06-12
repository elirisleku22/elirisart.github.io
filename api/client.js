// ════════════════════════════════════════════════════════════════════
// api/client.js — Élirïs'Art — API Client Authentifiée (Vercel Serverless)
// Toutes les opérations client passent par cette route.
// Protection : JWT Supabase vérifié côté serveur à chaque requête.
// Un client ne peut accéder QU'À SES PROPRES commandes.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

// ── Variables d'environnement ──────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;

// Client service (pour opérations admin de la route)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ────────────────────────────────────────────────────────
function ok(res, data)  { return res.status(200).json(data); }
function err(res, msg, status = 400) { return res.status(status).json({ error: msg }); }

// Génère un numéro de commande séquentiel
async function generateOrderNum() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const { count } = await supabaseAdmin
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .like('order_num', `EL-${date}-%`);
  const seq = (count || 0) + 1;
  return `EL-${date}-${String(seq).padStart(4, '0')}`;
}

// Vérifie le JWT Supabase et retourne l'utilisateur ou null
async function verifyToken(token) {
  if (!token) return null;
  try {
    // Crée un client Supabase "utilisateur" avec son token pour valider
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: { user }, error } = await supabaseUser.auth.getUser();
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

// ── Handler principal ──────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return err(res, 'Méthode non autorisée', 405);

  const { action, token, ...data } = req.body || {};

  // ── Actions publiques (sans auth) ─────────────────────────────────
  if (action === 'submit_order') {
    return handleSubmitOrder(req, res, data, token);
  }

  // ── Toutes les autres actions nécessitent un JWT valide ───────────
  const user = await verifyToken(token);
  if (!user) return err(res, 'Non authentifié — veuillez vous connecter', 401);

  try {
    switch (action) {

      // ════════════════════════════════
      // COMMANDES DU CLIENT
      // ════════════════════════════════

      case 'get_my_orders': {
        const { data: orders, error } = await supabaseAdmin
          .from('orders')
          .select('id, order_num, format, amount, date, status, payment_status, description, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return ok(res, { orders: orders || [] });
      }

      case 'get_order': {
        const { id } = data;
        if (!id) return err(res, 'id requis');
        const { data: order, error } = await supabaseAdmin
          .from('orders')
          .select('*')
          .eq('id', id)
          .eq('user_id', user.id) // SÉCURITÉ : le client ne peut voir que ses commandes
          .single();
        if (error || !order) return err(res, 'Commande introuvable', 404);
        return ok(res, { order });
      }

      // ════════════════════════════════
      // MESSAGERIE CLIENT
      // ════════════════════════════════

      case 'get_messages': {
        const { order_id } = data;
        if (!order_id) return err(res, 'order_id requis');

        // Vérifie que la commande appartient au client
        const { data: order } = await supabaseAdmin
          .from('orders').select('id').eq('id', order_id).eq('user_id', user.id).single();
        if (!order) return err(res, 'Accès refusé à cette commande', 403);

        const { data: messages, error } = await supabaseAdmin
          .from('messages')
          .select('*')
          .eq('order_id', order_id)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return ok(res, { messages: messages || [] });
      }

      case 'send_message': {
        const { order_id, text, image, sender } = data;
        if (!order_id || (!text && !image)) return err(res, 'order_id + (text ou image) requis');
        if (sender && sender !== 'client') return err(res, 'sender invalide');

        // Vérifie que la commande appartient au client
        const { data: order } = await supabaseAdmin
          .from('orders').select('id').eq('id', order_id).eq('user_id', user.id).single();
        if (!order) return err(res, 'Accès refusé à cette commande', 403);

        const { data: msg, error } = await supabaseAdmin
          .from('messages')
          .insert({
            order_id,
            sender:     'client',
            text:       text  || null,
            image:      image || null,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { message: msg });
      }

      // ════════════════════════════════
      // PAIEMENT CLIENT
      // ════════════════════════════════

      case 'submit_payment': {
        const { order_id, method, ref, acompte } = data;
        if (!order_id || !method || !ref) return err(res, 'order_id, method et ref requis');

        // Vérifie ownership
        const { data: order } = await supabaseAdmin
          .from('orders').select('*').eq('id', order_id).eq('user_id', user.id).single();
        if (!order) return err(res, 'Accès refusé à cette commande', 403);
        if (order.payment_status === 'confirmed') return err(res, 'Paiement déjà confirmé');

        // Met à jour le statut en "pending" (en attente de confirmation par l'admin)
        const { error } = await supabaseAdmin
          .from('orders')
          .update({ payment_status: 'pending' })
          .eq('id', order_id);
        if (error) throw error;

        // Message système dans la conversation
        await supabaseAdmin.from('messages').insert({
          order_id,
          sender:     'system',
          text:       `💳 Paiement soumis par le client\n` +
                      `Méthode : ${method}\n` +
                      `Référence : ${ref}\n` +
                      `Montant : ${acompte || '?'} $\n` +
                      `→ En attente de confirmation par l'artiste`,
          created_at: new Date().toISOString(),
        });

        return ok(res, { success: true });
      }

      default:
        return err(res, `Action inconnue : ${action}`, 400);
    }
  } catch (e) {
    console.error('[client.js error]', e);
    return err(res, e.message || 'Erreur serveur interne', 500);
  }
}

// ════════════════════════════════════════════════════════════════════
// CRÉATION DE COMMANDE — peut être appelée avec OU sans token
// (commande publique via formulaire + commande authentifiée)
// ════════════════════════════════════════════════════════════════════
async function handleSubmitOrder(req, res, data, token) {
  const { name, phone, format, amount, description, photo } = data;
  if (!name || !format || !amount) return err(res, 'Champs manquants : name, format, amount');

  // Tente de récupérer user_id si connecté
  let user_id = null;
  if (token) {
    const user = await verifyToken(token);
    if (user) user_id = user.id;
  }

  try {
    const order_num = await generateOrderNum();

    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .insert({
        order_num,
        name:           name.trim(),
        phone:          phone?.trim() || '',
        format,
        amount:         Number(amount),
        description:    description?.trim() || '',
        photo:          photo || null,
        status:         'new',
        payment_status: 'unpaid',
        user_id,
        date:           new Date().toLocaleDateString('fr-FR'),
        created_at:     new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Message système automatique de bienvenue dans la conversation
    const acompte = Math.ceil(Number(amount) * 0.1);
    await supabaseAdmin.from('messages').insert({
      order_id:   order.id,
      sender:     'system',
      text:       `🎨 Bienvenue ${name.trim()} !\n` +
                  `Votre commande ${order_num} a bien été enregistrée.\n\n` +
                  `📋 Récapitulatif :\n` +
                  `• Format : Portrait ${format}\n` +
                  `• Montant total : ${amount} $\n` +
                  `• Acompte initial (10%) : ${acompte} $\n\n` +
                  `Pour confirmer votre commande, veuillez envoyer l'acompte de ${acompte} $ via :\n` +
                  `• Airtel Money : +243 995 562 489 (Élie LEKU)\n` +
                  `• M-Pesa : +243 820 603 485 (Élie LEKU)\n\n` +
                  `Puis soumettez votre référence de paiement dans la section ci-dessous. ✅`,
      created_at: new Date().toISOString(),
    });

    return ok(res, { order });
  } catch (e) {
    console.error('[client.js submit_order error]', e);
    return err(res, e.message || 'Erreur lors de la création de la commande', 500);
  }
}
