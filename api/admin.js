// ════════════════════════════════════════════════════════════════════
// api/admin.js — Élirïs'Art — API Admin Sécurisée (Vercel Serverless)
// Toutes les opérations sensibles passent exclusivement par cette route
// Protection : mot de passe vérifié côté serveur à chaque requête
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

// ── Variables d'environnement (à configurer dans Vercel Dashboard) ──
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // clé service (JAMAIS côté client)
const ADMIN_PASSWORD      = process.env.ADMIN_PASSWORD;             // ex: "MonMotDePasse2025!"

// ── Client Supabase avec clé service (contourne Row Level Security) ──
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────
function ok(res, data)  { return res.status(200).json(data); }
function err(res, msg, status = 400) { return res.status(status).json({ error: msg }); }

function checkAuth(password) {
  if (!password || password !== ADMIN_PASSWORD) return false;
  return true;
}

// Génère un numéro de commande unique (ex: EL-20260612-0042)
function generateOrderNum(existing = []) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = existing.filter(o => o.order_num?.includes(date)).length + 1;
  return `EL-${date}-${String(count).padStart(4, '0')}`;
}

// ── Handler principal ─────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return err(res, 'Méthode non autorisée', 405);

  const { action, password, ...data } = req.body || {};

  // ── Authentification obligatoire pour toutes les actions ────────────
  if (!checkAuth(password)) {
    return err(res, 'Accès non autorisé — mot de passe incorrect', 401);
  }

  try {
    switch (action) {

      // ════════════════════════════════
      // COMMANDES
      // ════════════════════════════════

      case 'get_orders': {
        const { data: orders, error } = await supabase
          .from('orders')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        return ok(res, { orders });
      }

      case 'create_order': {
        // Utilisé si l'admin crée une commande manuellement
        const { name, phone, format, amount, description, photo, user_id } = data;
        if (!name || !format || !amount) return err(res, 'Champs manquants : name, format, amount');

        // Récupère les commandes du jour pour le numéro séquentiel
        const { data: existing } = await supabase.from('orders').select('order_num');
        const order_num = generateOrderNum(existing || []);

        const { data: order, error } = await supabase
          .from('orders')
          .insert({
            order_num,
            name,
            phone:         phone || '',
            format,
            amount:        Number(amount),
            description:   description || '',
            photo:         photo || null,
            status:        'new',
            payment_status:'unpaid',
            user_id:       user_id || null,
            date:          new Date().toLocaleDateString('fr-FR'),
            created_at:    new Date().toISOString(),
          })
          .select()
          .single();
        if (error) throw error;

        // Message système de bienvenue
        await supabase.from('messages').insert({
          order_id:   order.id,
          sender:     'system',
          text:       `✨ Commande ${order_num} créée\nFormat : Portrait ${format} — ${amount} $\nAcompte initial (10%) : ${Math.ceil(amount * 0.1)} $`,
          created_at: new Date().toISOString(),
        });

        return ok(res, { order });
      }

      case 'update_order_status': {
        const { id, status } = data;
        if (!id || !status) return err(res, 'id et status requis');
        const { error } = await supabase
          .from('orders')
          .update({ status })
          .eq('id', id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      case 'confirm_payment': {
        const { order_id } = data;
        if (!order_id) return err(res, 'order_id requis');
        const { error } = await supabase
          .from('orders')
          .update({ payment_status: 'confirmed' })
          .eq('id', order_id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      case 'delete_order': {
        const { id } = data;
        if (!id) return err(res, 'id requis');
        // Supprimer d'abord les messages liés
        await supabase.from('messages').delete().eq('order_id', id);
        const { error } = await supabase.from('orders').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      case 'clear_orders': {
        // Vide TOUTES les commandes et leurs messages
        const { data: allOrders } = await supabase.from('orders').select('id');
        if (allOrders?.length) {
          const ids = allOrders.map(o => o.id);
          await supabase.from('messages').delete().in('order_id', ids);
        }
        await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        return ok(res, { success: true });
      }

      // ════════════════════════════════
      // MESSAGERIE
      // ════════════════════════════════

      case 'get_messages': {
        const { order_id } = data;
        if (!order_id) return err(res, 'order_id requis');
        const { data: messages, error } = await supabase
          .from('messages')
          .select('*')
          .eq('order_id', order_id)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return ok(res, { messages });
      }

      case 'send_admin_message': {
        const { order_id, text, image } = data;
        if (!order_id || (!text && !image)) return err(res, 'order_id + (text ou image) requis');
        const { data: msg, error } = await supabase
          .from('messages')
          .insert({
            order_id,
            sender:     'admin',
            text:       text  || null,
            image:      image || null,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { message: msg });
      }

      case 'delete_message': {
        const { id } = data;
        if (!id) return err(res, 'id requis');
        const { error } = await supabase.from('messages').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      // ════════════════════════════════
      // GALERIE
      // ════════════════════════════════

      case 'insert_gallery': {
        const { src, caption } = data;
        if (!src) return err(res, 'src requis');
        const { data: item, error } = await supabase
          .from('gallery')
          .insert({ src, caption: caption || '', created_at: new Date().toISOString() })
          .select()
          .single();
        if (error) throw error;
        return ok(res, { item });
      }

      case 'delete_gallery': {
        const { id } = data;
        if (!id) return err(res, 'id requis');
        const { error } = await supabase.from('gallery').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      // ════════════════════════════════
      // BLOG
      // ════════════════════════════════

      case 'save_blog': {
        const { id, title, excerpt, category, cover, content } = data;
        if (!title) return err(res, 'title requis');

        const post = {
          title,
          excerpt:    excerpt  || '',
          category:   category || 'Article',
          cover:      cover    || null,
          content:    content  || '',
          date:       new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
          updated_at: new Date().toISOString(),
        };

        let result, error;
        if (id) {
          ({ data: result, error } = await supabase
            .from('blog').update(post).eq('id', id).select().single());
        } else {
          post.created_at = new Date().toISOString();
          ({ data: result, error } = await supabase
            .from('blog').insert(post).select().single());
        }
        if (error) throw error;
        return ok(res, { post: result });
      }

      case 'delete_blog': {
        const { id } = data;
        if (!id) return err(res, 'id requis');
        const { error } = await supabase.from('blog').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      // ════════════════════════════════
      // BANNIÈRE
      // ════════════════════════════════

      case 'save_banner': {
        const { text, active, bg_color, text_color } = data;
        // Upsert sur la ligne unique id='main'
        const { error } = await supabase
          .from('banner')
          .upsert({
            id:         'main',
            text:       text       || '',
            active:     active     ?? false,
            bg_color:   bg_color   || '#C9A84C',
            text_color: text_color || '#042C53',
            updated_at: new Date().toISOString(),
          });
        if (error) throw error;
        return ok(res, { success: true });
      }

      // ════════════════════════════════
      // TÉMOIGNAGES
      // ════════════════════════════════

      case 'approve_testimonial': {
        const { id } = data;
        if (!id) return err(res, 'id requis');
        const { error } = await supabase
          .from('testimonials')
          .update({ approved: true })
          .eq('id', id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      case 'delete_testimonial': {
        const { id } = data;
        if (!id) return err(res, 'id requis');
        const { error } = await supabase.from('testimonials').delete().eq('id', id);
        if (error) throw error;
        return ok(res, { success: true });
      }

      case 'get_pending_testimonials': {
        const { data: testis, error } = await supabase
          .from('testimonials')
          .select('*')
          .eq('approved', false)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return ok(res, { testimonials: testis });
      }

      // ════════════════════════════════
      // PHOTOS DE COMMANDES
      // ════════════════════════════════

      case 'get_order_photos': {
        const { data: orders, error } = await supabase
          .from('orders')
          .select('id, order_num, name, format, photo')
          .not('photo', 'is', null)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return ok(res, { orders: orders.filter(o => o.photo) });
      }

      default:
        return err(res, `Action inconnue : ${action}`, 400);
    }
  } catch (e) {
    console.error('[admin.js error]', e);
    return err(res, e.message || 'Erreur serveur interne', 500);
  }
}
