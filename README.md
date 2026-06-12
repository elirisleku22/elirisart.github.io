elirisart-github-io/          ← GitHub Pages (frontend statique)
│  index.html                 ← Site complet (HTML + CSS + JS)
│
elirisart-github-io.vercel.app/  ← Vercel (API serverless)
│  api/
│     admin.js                ← Route protégée par mot de passe
│     client.js               ← Route protégée par JWT Supabase
│  vercel.json
│  package.json
│
Supabase                      ← Base de données + Auth + Realtime
   orders, messages, gallery, blog, testimonials, banner
