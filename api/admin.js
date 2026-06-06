export default async function handler(req, res) {
  const { action, password, ...data } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supa = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  if (action === 'upsert_banner') {
    const { error } = await supa.from('banner').upsert({ id:'main', ...data });
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
    const { error } = await supa.from('blog').update(data).eq('id', data.id);
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
  if (action === 'get_orders') {
    const { data: orders, error } = await supa.from('orders').select('*').order('created_at', { ascending: false });
    return res.json({ orders, error });
  }
  res.status(400).json({ error: 'Action inconnue' });
}
