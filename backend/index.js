require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin');

// ── Firebase Admin (FCM) ───────────────────────────────────────────────────────
// FIREBASE_SERVICE_ACCOUNT debe ser el JSON de la cuenta de servicio
// codificado en base64 en las variables de entorno de Railway
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8')
    );
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('[FCM] Firebase Admin inicializado correctamente');
  } catch (err) {
    console.error('[FCM] Error inicializando Firebase Admin:', err.message);
  }
} else {
  console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT no configurado — notificaciones push desactivadas');
}

async function sendFCMNotification(fcmToken, title, body, data = {}) {
  if (!admin.apps.length) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          channelId: 'pedidos',
          sound: 'default',
          priority: 'max',
          vibrateTimingsMillis: [0, 300, 200, 300],
        },
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    });
    console.log('[FCM] Notificación enviada a:', fcmToken.slice(0, 20) + '...');
  } catch (err) {
    console.error('[FCM] Error enviando notificación:', err.message);
  }
}

// ── Supabase ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Express + HTTP + Socket.io ─────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(o => o.trim());

// ── Seguridad: headers HTTP ────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── Rate limiting ──────────────────────────────────────────────────────────────
// General: 200 req / 15 min por IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta más tarde.' },
}));

// GPS: máximo 60 req / min (1 por segundo, con holgura)
const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Límite de actualizaciones GPS alcanzado.' },
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: false,
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
});

const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '10kb' }));

// ── Helpers de validación ──────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (v) => UUID_RE.test(v);
const isValidCoord = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] cliente conectado: ${socket.id}`);

  // El cliente envía { order_id, token } — verificamos que el token corresponda
  socket.on('join:order', async ({ order_id, token }) => {
    if (!order_id || !token) return;
    try {
      const { data: order, error } = await supabase
        .from('orders')
        .select('id')
        .eq('id', order_id)
        .eq('tracking_token', token)
        .single();

      if (error || !order) {
        socket.emit('error:auth', { message: 'Token inválido' });
        return;
      }

      const room = `order_${order_id}`;
      socket.join(room);
      console.log(`[socket] ${socket.id} se unió al room ${room}`);
    } catch (err) {
      console.error('[socket] Error en join:order:', err.message);
      socket.emit('error:auth', { message: 'Error interno' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[socket] cliente desconectado: ${socket.id}`);
  });
});

// ── POST /api/courier/login ────────────────────────────────────────────────────
// Login de mensajero con teléfono + PIN. No expone el PIN en la respuesta.
app.post('/api/courier/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Demasiados intentos. Espera 15 minutos.' } }), async (req, res) => {
  const { phone, pin } = req.body;

  if (!phone || !pin) {
    return res.status(400).json({ error: 'Teléfono y PIN son requeridos' });
  }

  const cleanPhone = String(phone).trim().slice(0, 20);
  const cleanPin = String(pin).trim().slice(0, 10);

  const { data: courier, error } = await supabase
    .from('couriers')
    .select('id, name, phone, photo_url, is_active')
    .eq('phone', cleanPhone)
    .eq('pin', cleanPin)
    .eq('is_active', true)
    .single();

  if (error || !courier) {
    return res.status(401).json({ error: 'Teléfono o PIN incorrecto' });
  }

  return res.json({ courier });
});

// ── GET /api/order/:token ──────────────────────────────────────────────────────
app.get('/api/order/:token', async (req, res) => {
  const { token } = req.params;

  if (!token || token.length > 200) {
    return res.status(400).json({ error: 'Token inválido' });
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select(`*, couriers(id, name, phone, photo_url)`)
    .eq('tracking_token', token)
    .single();

  if (error || !order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  // Verificar expiración: 1 hora después de entregado
  if (order.status === 'entregado' && order.delivered_at) {
    const horasTranscurridas = (Date.now() - new Date(order.delivered_at).getTime()) / 1000 / 3600;
    if (horasTranscurridas >= 1) {
      return res.status(410).json({ error: 'El link de rastreo ha expirado' });
    }
  }

  // Consultas auxiliares independientes — fallos no bloquean la respuesta principal
  const [countResult, locationResult] = await Promise.allSettled([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('courier_id', order.courier_id)
      .eq('status', 'en_camino'),
    supabase
      .from('courier_locations')
      .select('latitude, longitude, updated_at')
      .eq('order_id', order.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single(),
  ]);

  const count    = countResult.status    === 'fulfilled' ? (countResult.value.count    ?? 0)    : 0;
  const location = locationResult.status === 'fulfilled' ? (locationResult.value.data  ?? null) : null;

  return res.json({
    order,
    active_orders_count: count,
    last_location: location,
  });
});

// ── POST /api/location ─────────────────────────────────────────────────────────
app.post('/api/location', locationLimiter, async (req, res) => {
  const { courier_id, order_id, latitude, longitude } = req.body;

  if (!courier_id || !order_id) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  if (!isValidUUID(courier_id) || !isValidUUID(order_id)) {
    return res.status(400).json({ error: 'IDs inválidos' });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (!isValidCoord(lat, lng)) {
    return res.status(400).json({ error: 'Coordenadas GPS inválidas' });
  }

  const updated_at = new Date().toISOString();

  // Emitir ubicación vía WebSocket inmediatamente (no esperar DB)
  io.to(`order_${order_id}`).emit('location:update', { latitude: lat, longitude: lng, updated_at });

  try {
    const { data: existing } = await supabase
      .from('courier_locations')
      .select('id')
      .eq('order_id', order_id)
      .limit(1)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('courier_locations')
        .update({ courier_id, latitude: lat, longitude: lng, updated_at })
        .eq('order_id', order_id);
      if (error) console.error('[location] Error actualizando ubicación:', error.message);
    } else {
      const { error } = await supabase
        .from('courier_locations')
        .insert({ courier_id, order_id, latitude: lat, longitude: lng, updated_at });
      if (error) console.error('[location] Error insertando ubicación:', error.message);
    }
  } catch (err) {
    console.error('[location] Error guardando en DB:', err.message);
    // No retornar error al mensajero — la ubicación ya fue emitida por WebSocket
  }

  return res.json({ ok: true });
});

// ── PUT /api/order/:id/status ──────────────────────────────────────────────────
app.put('/api/order/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'ID de pedido inválido' });
  }

  const validStatuses = ['pendiente', 'en_camino', 'entregado', 'cancelado'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Debe ser: ${validStatuses.join(', ')}` });
  }

  const updateData = { status };
  if (status === 'entregado') {
    updateData.delivered_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('orders')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    return res.status(500).json({ error: 'No se pudo actualizar el estado' });
  }

  io.to(`order_${id}`).emit('status:update', { status, updated_at: new Date().toISOString() });

  return res.json({ order: data });
});

// ── Listener Supabase Realtime → notificación FCM al mensajero ────────────────
// El backend escucha INSERT en orders y envía FCM directo al dispositivo.
// Esto funciona aunque la app del mensajero esté cerrada o la pantalla apagada.
function startOrdersListener() {
  supabase
    .channel('backend-new-orders')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      async (payload) => {
        const order = payload.new;
        if (!order?.courier_id) return;

        try {
          const { data: courier } = await supabase
            .from('couriers')
            .select('push_token, name')
            .eq('id', order.courier_id)
            .single();

          if (!courier?.push_token) {
            console.warn('[FCM] Mensajero sin push_token:', order.courier_id);
            return;
          }

          await sendFCMNotification(
            courier.push_token,
            '🛵 Nuevo pedido asignado',
            `${order.client_name}\n📍 ${order.delivery_address}`,
            { orderId: order.id }
          );
        } catch (err) {
          console.error('[Orders listener] Error:', err.message);
        }
      }
    )
    .subscribe((status) => {
      console.log('[Orders listener] Estado Realtime:', status);
    });
}

// ── Arrancar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[server] corriendo en http://localhost:${PORT}`);
  startOrdersListener();
});
