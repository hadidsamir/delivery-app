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
    // Mensaje de datos silencioso (sin campo 'notification') para evitar la
    // notificación doble: el OS no la muestra automáticamente y la app local
    // (keepalive / realtime) crea la notificación con botones ACEPTAR/RECHAZAR.
    await admin.messaging().send({
      token: fcmToken,
      android: { priority: 'high' },
      data: {
        title,
        body,
        channelId: 'pedidos',
        ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      },
    });
    console.log('[FCM] Señal silenciosa enviada a:', fcmToken.slice(0, 20) + '...');
  } catch (err) {
    console.error('[FCM] Error enviando notificación:', err.message);
  }
}

// Envía notificación FCM a TODOS los mensajeros (nuevo servicio del cliente)
async function sendFCMBroadcast(tokens, title, body, data = {}) {
  if (!admin.apps.length || !tokens.length) return;
  const dataStr = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );
  // FCM permite máximo 500 tokens por llamada
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));
  let enviados = 0;
  for (const chunk of chunks) {
    try {
      // Mensaje de datos silencioso — evita doble notificación.
      // Android NO muestra la notificación automáticamente.
      // El keepalive (checkAvailableOrders) crea la notificación local
      // con el canal 'nuevo_servicio' y el sonido personalizado.
      const response = await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        android: { priority: 'high' },
        data: { ...dataStr, title, body },
      });
      enviados += response.successCount;
      console.log(`[FCM Broadcast] ${response.successCount}/${chunk.length} enviados`);
    } catch (err) {
      console.error('[FCM Broadcast] Error:', err.message);
    }
  }
  console.log(`[FCM Broadcast] Total entregados: ${enviados}/${tokens.length}`);
}

// ── Supabase ───────────────────────────────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios');
}
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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

// Pedidos públicos: máximo 10 req / hora por IP (anti-spam)
const publicOrderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiadas solicitudes. Intenta más tarde.' },
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
app.set('trust proxy', 1);

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

  // El admin se une al room — verificar token de admin
  socket.on('join:admin', ({ token } = {}) => {
    if (token !== process.env.ADMIN_SOCKET_TOKEN) {
      socket.emit('error:auth', { message: 'Token de admin inválido' });
      return;
    }
    socket.join('admin_dashboard');
    console.log(`[socket] admin ${socket.id} se unió a admin_dashboard`);
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

  // Verificar expiración: 2 horas después de entregado
  const TRACKING_EXPIRY_HOURS = 2;
  if (order.status === 'entregado' && order.delivered_at) {
    const horasTranscurridas = (Date.now() - new Date(order.delivered_at).getTime()) / 1000 / 3600;
    if (horasTranscurridas >= TRACKING_EXPIRY_HOURS) {
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

  // R-02: Verificar que el mensajero está asignado a este pedido
  const { data: orderCheck, error: orderCheckError } = await supabase
    .from('orders')
    .select('courier_id')
    .eq('id', order_id)
    .single();

  if (orderCheckError || !orderCheck) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }
  if (orderCheck.courier_id !== courier_id) {
    return res.status(403).json({ error: 'No autorizado para este pedido' });
  }

  // Emitir ubicación vía WebSocket inmediatamente (no esperar DB)
  io.to(`order_${order_id}`).emit('location:update', { latitude: lat, longitude: lng, updated_at });

  try {
    const { error } = await supabase
      .from('courier_locations')
      .upsert(
        { courier_id, order_id, latitude: lat, longitude: lng, updated_at },
        { onConflict: 'order_id' }
      );
    if (error) console.error('[location] Error guardando ubicación:', error.message);
  } catch (err) {
    console.error('[location] Error guardando en DB:', err.message);
    // No retornar error al mensajero — la ubicación ya fue emitida por WebSocket
  }

  return res.json({ ok: true });
});

// ── PUT /api/order/:id/status ──────────────────────────────────────────────────
app.put('/api/order/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, courier_id, admin } = req.body;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'ID de pedido inválido' });
  }

  const validStatuses = ['pendiente', 'en_camino', 'entregado', 'cancelado'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Debe ser: ${validStatuses.join(', ')}` });
  }

  // R-01: courier_id obligatorio salvo que sea el admin
  if (!admin) {
    if (!courier_id) {
      return res.status(400).json({ error: 'courier_id es obligatorio' });
    }
    if (!isValidUUID(courier_id)) {
      return res.status(400).json({ error: 'courier_id inválido' });
    }
    const { data: orderCheck, error: orderError } = await supabase
      .from('orders')
      .select('courier_id')
      .eq('id', id)
      .maybeSingle();

    if (orderError) {
      console.error('[status] Error consultando pedido:', orderError.message);
      return res.status(500).json({ error: 'Error consultando pedido' });
    }
    if (!orderCheck) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    if (orderCheck.courier_id !== courier_id) {
      return res.status(403).json({ error: 'No autorizado para modificar este pedido' });
    }
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

// ── POST /api/orders/public ───────────────────────────────────────────────────
// Formulario público del cliente — crea pedido sin mensajero y notifica a todos
app.post('/api/orders/public', publicOrderLimiter, async (req, res) => {
  const { pickup_address, pickup_lat, pickup_lng, delivery_address, delivery_lat, delivery_lng,
          base_amount, payment_method, description, client_name, client_phone, whatsapp_phone } = req.body;

  // Validaciones
  if (!pickup_address || !delivery_address) {
    return res.status(400).json({ error: 'Las direcciones de recogida y entrega son requeridas' });
  }
  if (!payment_method || !['efectivo', 'transferencia'].includes(payment_method)) {
    return res.status(400).json({ error: 'Método de pago inválido. Debe ser efectivo o transferencia' });
  }
  if (base_amount !== undefined && (isNaN(Number(base_amount)) || Number(base_amount) < 0 || Number(base_amount) > 10000000)) {
    return res.status(400).json({ error: 'Base inválida' });
  }

  const lat_p = pickup_lat  ? parseFloat(pickup_lat)  : null;
  const lng_p = pickup_lng  ? parseFloat(pickup_lng)  : null;
  const lat_d = delivery_lat ? parseFloat(delivery_lat) : null;
  const lng_d = delivery_lng ? parseFloat(delivery_lng) : null;

  if (lat_p !== null && !isValidCoord(lat_p, lng_p)) {
    return res.status(400).json({ error: 'Coordenadas de recogida inválidas' });
  }
  if (lat_d !== null && !isValidCoord(lat_d, lng_d)) {
    return res.status(400).json({ error: 'Coordenadas de entrega inválidas' });
  }

  try {
    // Insertar pedido sin courier_id (source='cliente')
    const { data: order, error: insertError } = await supabase
      .from('orders')
      .insert({
        client_name:     client_name  ? String(client_name).slice(0, 80)  : null,
        client_phone:    client_phone ? String(client_phone).slice(0, 20) : null,
        pickup_address:  String(pickup_address).slice(0, 300),
        pickup_lat:      lat_p,
        pickup_lng:      lng_p,
        delivery_address: String(delivery_address).slice(0, 300),
        delivery_lat:    lat_d,
        delivery_lng:    lng_d,
        base_amount:     base_amount ? Number(base_amount) : null,
        payment_method,
        description:     description ? String(description).slice(0, 500) : null,
        whatsapp_phone:  whatsapp_phone ? String(whatsapp_phone).slice(0, 20) : null,
        source:          'cliente',
        status:          'pendiente',
        courier_id:      null,
      })
      .select('id, tracking_token')
      .single();

    if (insertError || !order) {
      console.error('[orders/public] Error insertando:', insertError?.message);
      return res.status(500).json({ error: 'No se pudo crear la solicitud' });
    }

    // Notificar a TODOS los mensajeros activos con push_token
    const { data: couriers } = await supabase
      .from('couriers')
      .select('push_token')
      .eq('is_active', true)
      .not('push_token', 'is', null);

    const tokens = (couriers || []).map(c => c.push_token).filter(Boolean);
    if (tokens.length > 0) {
      await sendFCMBroadcast(
        tokens,
        '🔔 Nuevo Servicio Disponible',
        `📍 Recogida: ${String(pickup_address).slice(0, 80)}${base_amount ? ` — Base: $${Number(base_amount).toLocaleString('es-CO')}` : ''}`,
        { type: 'nuevo_servicio', orderId: order.id }
      );
    }

    // Notificar al admin en tiempo real
    io.to('admin_dashboard').emit('order:new_public', { order_id: order.id });

    console.log(`[orders/public] Pedido creado: ${order.id} — Notificados: ${tokens.length} mensajeros`);
    return res.json({ order_id: order.id, tracking_token: order.tracking_token });

  } catch (err) {
    console.error('[orders/public] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/orders/whatsapp ─────────────────────────────────────────────────
// Crea pedido desde el bot de WhatsApp — sin coordenadas ni método de pago obligatorio
app.post('/api/orders/whatsapp', async (req, res) => {
  const { pickup_address, delivery_address, client_name, client_phone, whatsapp_phone, description } = req.body;

  if (!pickup_address || !delivery_address) {
    return res.status(400).json({ error: 'Se requieren dirección de recogida y entrega' });
  }
  if (!whatsapp_phone) {
    return res.status(400).json({ error: 'whatsapp_phone es obligatorio' });
  }

  // Geocodificar dirección de entrega para mostrar en mapa correctamente (Valledupar)
  async function geocodeValledupar(address) {
    try {
      const MAPS_KEY = process.env.GOOGLE_MAPS_KEY;
      if (!MAPS_KEY) return { lat: null, lng: null };
      const full = `${address}, Valledupar, Cesar, Colombia`;
      const url  = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(full)}&key=${MAPS_KEY}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.results?.[0]) {
        const { lat, lng } = data.results[0].geometry.location;
        return { lat, lng };
      }
    } catch {}
    return { lat: null, lng: null };
  }

  try {
    const deliveryCoords = await geocodeValledupar(delivery_address);

    const { data: order, error: insertError } = await supabase
      .from('orders')
      .insert({
        client_name:      client_name      ? String(client_name).slice(0, 80)      : null,
        client_phone:     client_phone     ? String(client_phone).slice(0, 20)     : null,
        pickup_address:   String(pickup_address).slice(0, 300),
        delivery_address: String(delivery_address).slice(0, 300),
        delivery_lat:     deliveryCoords.lat,
        delivery_lng:     deliveryCoords.lng,
        whatsapp_phone:   String(whatsapp_phone).slice(0, 20),
        description:      description ? String(description).slice(0, 500) : null,
        payment_method:   'efectivo',
        source:           'whatsapp',
        status:           'pendiente',
        courier_id:       null,
      })
      .select('id, tracking_token')
      .single();

    if (insertError || !order) {
      console.error('[orders/whatsapp] Error insertando:', insertError?.message);
      return res.status(500).json({ error: 'No se pudo crear el pedido' });
    }

    // Notificar en tiempo real al dashboard admin y a los mensajeros
    io.to('admin_dashboard').emit('order:new_public', { order_id: order.id });
    io.emit('order:available', {
      order_id:        order.id,
      pickup_address:  String(pickup_address).slice(0, 80),
      delivery_address: String(delivery_address).slice(0, 80),
    });

    const trackingUrl = `https://1012rastreo.1012studiocreativo.com/track/${order.tracking_token}`;
    console.log(`[orders/whatsapp] Pedido creado: ${order.id}`);
    return res.json({ order_id: order.id, tracking_token: order.tracking_token, tracking_url: trackingUrl });

  } catch (err) {
    console.error('[orders/whatsapp] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── GET /api/orders/available ─────────────────────────────────────────────────
// Lista pedidos sin mensajero asignado (para la app del mensajero)
app.get('/api/orders/available', async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, pickup_address, pickup_lat, pickup_lng, delivery_address, base_amount, payment_method, description, created_at')
      .is('courier_id', null)
      .eq('status', 'pendiente')
      .eq('source', 'cliente')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[orders/available] Error:', error.message);
      return res.status(500).json({ error: 'Error obteniendo pedidos disponibles' });
    }

    return res.json({ orders: orders || [] });
  } catch (err) {
    console.error('[orders/available] Error:', err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
});

// ── POST /api/orders/:id/claim ────────────────────────────────────────────────
// El mensajero toma un pedido disponible — transacción atómica anti-race condition
app.post('/api/orders/:id/claim', async (req, res) => {
  const { id } = req.params;
  const { courier_id } = req.body;

  if (!isValidUUID(id) || !isValidUUID(courier_id)) {
    return res.status(400).json({ error: 'IDs inválidos' });
  }

  try {
    // Verificar que el mensajero existe y está activo
    const { data: courier, error: courierError } = await supabase
      .from('couriers')
      .select('id, name')
      .eq('id', courier_id)
      .eq('is_active', true)
      .single();

    if (courierError || !courier) {
      return res.status(403).json({ error: 'Mensajero no encontrado o inactivo' });
    }

    // Verificar que tiene menos de 2 pedidos activos en_camino
    const { count: activeCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('courier_id', courier_id)
      .eq('status', 'en_camino');

    if (activeCount >= 2) {
      return res.status(409).json({ error: 'Ya tienes 2 servicios activos. Entrega uno primero.' });
    }

    // UPDATE atómico: solo asigna si courier_id sigue siendo NULL
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({ courier_id, status: 'en_camino' })
      .eq('id', id)
      .is('courier_id', null)
      .eq('status', 'pendiente')
      .select('id, tracking_token, pickup_address, delivery_address, base_amount, payment_method, description, whatsapp_phone, client_name, client_phone')
      .single();

    if (updateError || !updated) {
      // Otro mensajero ya lo tomó
      return res.status(409).json({ error: 'Este servicio ya fue tomado por otro mensajero' });
    }

    // Notificar al admin en tiempo real
    io.to('admin_dashboard').emit('order:claimed', {
      order_id: id,
      courier_id,
      courier_name: courier.name,
    });

    // Notificar al cliente por WhatsApp si el pedido vino del bot
    if (updated.whatsapp_phone) {
      const trackingUrl = `https://1012rastreo.1012studiocreativo.com/track/${updated.tracking_token}`;
      const msg =
        `🛵 ¡Hola ${updated.client_name || 'cliente'}! Tu domicilio fue aceptado.\n\n` +
        `Mensajero: *${courier.name}*\n` +
        `📍 Entrega en: ${updated.delivery_address}\n\n` +
        `Sigue tu pedido en tiempo real aquí:\n${trackingUrl}`;
      sendWhatsApp(updated.whatsapp_phone, msg).catch(err =>
        console.error('[claim] Error enviando WhatsApp al cliente:', err.message)
      );
    }

    console.log(`[orders/claim] Pedido ${id} tomado por mensajero ${courier.name}`);
    return res.json({ ok: true, order: updated });

  } catch (err) {
    console.error('[orders/claim] Error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/courier/idle-location ──────────────────────────────────────────
// GPS idle del mensajero cuando NO está en entrega activa
const idleLocationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Límite de actualizaciones de ubicación idle alcanzado.' },
});

app.post('/api/courier/idle-location', idleLocationLimiter, async (req, res) => {
  const { courier_id, latitude, longitude } = req.body;

  if (!isValidUUID(courier_id)) {
    return res.status(400).json({ error: 'courier_id inválido' });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (!isValidCoord(lat, lng)) {
    return res.status(400).json({ error: 'Coordenadas inválidas' });
  }

  try {
    const now = new Date().toISOString();

    // Guardar en courier_idle_locations (tabla original)
    await supabase
      .from('courier_idle_locations')
      .upsert(
        { courier_id, latitude: lat, longitude: lng, updated_at: now },
        { onConflict: 'courier_id' }
      );

    // También actualizar courier_locations para que el mapa en vivo lo muestre
    // Buscar si ya existe alguna fila para este mensajero
    const { data: existing } = await supabase
      .from('courier_locations')
      .select('id, order_id')
      .eq('courier_id', courier_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Actualizar la fila existente
      await supabase
        .from('courier_locations')
        .update({ latitude: lat, longitude: lng, updated_at: now })
        .eq('id', existing.id);
    } else {
      // Insertar fila sin order_id (idle)
      await supabase
        .from('courier_locations')
        .insert({ courier_id, latitude: lat, longitude: lng, updated_at: now });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[idle-location] Error:', err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
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
        // Pedidos de cliente sin asignar: la notificación ya la envía /api/orders/public
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

// ── SOPORTE WHATSAPP: endpoints para escalación a humano ──────────────────────

if (!process.env.YCLOUD_API_KEY || !process.env.YCLOUD_FROM) {
  throw new Error('YCLOUD_API_KEY y YCLOUD_FROM son obligatorios');
}
const YCLOUD_API_KEY = process.env.YCLOUD_API_KEY;
const YCLOUD_FROM    = process.env.YCLOUD_FROM;

// Enviar mensaje WhatsApp via YCloud
async function sendWhatsApp(to, body) {
  const phone = String(to).replace(/\D/g, '');
  const normalized = phone.startsWith('57') ? phone : `57${phone}`;
  console.log(`[YCloud] Enviando a ${normalized} desde ${YCLOUD_FROM}, key: ${YCLOUD_API_KEY?.slice(0,8)}...`);
  const res = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify({ from: YCLOUD_FROM, to: normalized, type: 'text', text: { body } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[YCloud] Error ${res.status}: ${errText}`);
  }
  return res.ok;
}

// GET /api/support/chats — listar conversaciones escaladas (o todas activas)
app.get('/api/support/chats', async (req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    // Traer mensajes en paralelo (más eficiente que secuencial)
    const results = await Promise.all((sessions || []).map(async (s) => {
      const { data: messages } = await supabase
        .from('chat_messages')
        .select('id, phone, direction, sender, body, created_at')
        .eq('phone', s.phone)
        .order('created_at', { ascending: true })
        .limit(50);
      return { ...s, messages: messages || [] };
    }));

    res.json(results);
  } catch (err) {
    console.error('[Support] Error listando chats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/support/reply — admin responde al cliente
app.post('/api/support/reply', async (req, res) => {
  const { phone, body } = req.body;
  if (!phone || !body) return res.status(400).json({ error: 'phone y body requeridos' });

  try {
    const ok = await sendWhatsApp(phone, body);
    if (!ok) return res.status(502).json({ error: 'Error enviando WhatsApp via YCloud' });

    // Guardar mensaje del humano en BD
    await supabase.from('chat_messages').insert({
      phone, direction: 'outbound', sender: 'human', body,
    });
    // Actualizar timestamp de sesión
    await supabase.from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('phone', phone);

    res.json({ ok: true });
  } catch (err) {
    console.error('[Support] Error enviando respuesta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/support/resume — admin reactiva el bot para esa conversación
app.post('/api/support/resume', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requerido' });

  try {
    await supabase.from('chat_sessions').update({
      human_takeover: false,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('phone', phone);

    // Avisar al cliente que el bot retoma
    await sendWhatsApp(phone, '✅ Hemos resuelto tu caso. El asistente virtual está de nuevo disponible para ayudarte. ¡Escríbenos cuando quieras!');

    res.json({ ok: true });
  } catch (err) {
    console.error('[Support] Error reanudando bot:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/support/inbound — recibe mensajes del cliente cuando está en modo humano
// (n8n llama este endpoint en vez de procesar con IA)
app.post('/api/support/inbound', async (req, res) => {
  const { phone, body, display_name } = req.body;
  if (!phone || !body) return res.status(400).json({ error: 'phone y body requeridos' });

  try {
    // Upsert sesión
    await supabase.from('chat_sessions').upsert({
      phone,
      display_name: display_name || phone,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone', ignoreDuplicates: false });

    // Guardar mensaje entrante
    await supabase.from('chat_messages').insert({
      phone, direction: 'inbound', sender: 'client', body,
    });

    // Emitir evento Socket.io para que el panel admin lo vea en tiempo real
    io.emit('support:message', { phone, body, sender: 'client', created_at: new Date().toISOString() });

    res.json({ ok: true });
  } catch (err) {
    console.error('[Support] Error guardando mensaje entrante:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/support/escalate — n8n llama esto cuando el bot decide escalar
app.post('/api/support/escalate', async (req, res) => {
  const { phone, display_name, reason, summary } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requerido' });

  try {
    await supabase.from('chat_sessions').upsert({
      phone,
      display_name: display_name || phone,
      human_takeover: true,
      takeover_reason: reason || 'Solicitado por cliente',
      takeover_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone' });

    // Notificar al admin via Socket.io
    io.emit('support:escalated', { phone, display_name, reason, summary });

    // Notificar al admin via WhatsApp personal
    const nombre  = display_name || phone;
    const motivo  = reason || 'Solicitado por cliente';
    const resumen = summary ? `\n\nResumen: ${summary}` : '';
    if (!process.env.ADMIN_WHATSAPP) throw new Error('ADMIN_WHATSAPP no configurado');
    await sendWhatsApp(process.env.ADMIN_WHATSAPP,
      `⚠️ *Atención requerida*\n\n` +
      `El cliente *${nombre}* (${phone}) necesita hablar con un agente humano.\n` +
      `Motivo: ${motivo}${resumen}\n\n` +
      `Respóndele desde el panel: https://1012delivery.1012studiocreativo.com/support`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('[Support] Error escalando:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Arrancar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[server] corriendo en http://localhost:${PORT}`);
  startOrdersListener();
});
