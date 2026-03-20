require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── Express + HTTP + Socket.io ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(o => o.trim());

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
app.options('*', cors(corsOptions)); // preflight explícito para todas las rutas

// Middleware CORS explícito — maneja preflight OPTIONS en producción
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] cliente conectado: ${socket.id}`);

  // El cliente envía { order_id } para unirse al room de su pedido
  socket.on('join:order', (order_id) => {
    const room = `order_${order_id}`;
    socket.join(room);
    console.log(`[socket] ${socket.id} se unió al room ${room}`);
  });

  socket.on('disconnect', () => {
    console.log(`[socket] cliente desconectado: ${socket.id}`);
  });
});

// ── GET /api/order/:token ─────────────────────────────────────────────────────
// Busca el pedido por tracking_token, incluye datos del mensajero y
// cuenta cuántos pedidos activos (en_camino) tiene ese mensajero.
app.get('/api/order/:token', async (req, res) => {
  const { token } = req.params;

  // 1. Traer el pedido con su mensajero
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      *,
      couriers (
        id,
        name,
        phone,
        photo_url
      )
    `)
    .eq('tracking_token', token)
    .single();

  if (error || !order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  // 2. Contar pedidos activos del mensajero
  const { count, error: countError } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('courier_id', order.courier_id)
    .eq('status', 'en_camino');

  if (countError) {
    return res.status(500).json({ error: 'Error al contar pedidos activos' });
  }

  // 3. Traer última ubicación conocida del mensajero para este pedido
  const { data: location } = await supabase
    .from('courier_locations')
    .select('latitude, longitude, updated_at')
    .eq('order_id', order.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  return res.json({
    order,
    active_orders_count: count ?? 0,
    last_location: location ?? null,
  });
});

// ── POST /api/location ────────────────────────────────────────────────────────
// Recibe { courier_id, order_id, latitude, longitude },
// hace upsert en courier_locations y emite 'location:update' al room.
app.post('/api/location', async (req, res) => {
  const { courier_id, order_id, latitude, longitude } = req.body;

  if (!courier_id || !order_id || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }

  console.log(`[GPS] courier=${courier_id} | lat=${latitude} lng=${longitude}`);

  const updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('courier_locations')
    .upsert(
      { courier_id, order_id, latitude, longitude, updated_at },
      { onConflict: 'order_id' }
    );

  // Emitir al room del pedido siempre (independiente del resultado del upsert)
  io.to(`order_${order_id}`).emit('location:update', {
    latitude,
    longitude,
    updated_at,
  });

  if (error) {
    console.error('[location] error upsert:', error.message);
  }

  return res.json({ ok: true });
});

// ── PUT /api/order/:id/status ─────────────────────────────────────────────────
// Actualiza el campo status del pedido.
app.put('/api/order/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['pendiente', 'en_camino', 'entregado'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status inválido. Debe ser: ${validStatuses.join(', ')}` });
  }

  const updateData = { status };

  // Si se marca como entregado, guardar timestamp para calcular expiración del token
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
    return res.status(500).json({ error: 'No se pudo actualizar el status' });
  }

  // Notificar al room del pedido sobre el cambio de status
  io.to(`order_${id}`).emit('status:update', { status, updated_at: new Date().toISOString() });

  return res.json({ order: data });
});

// ── Arrancar servidor ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[server] corriendo en http://localhost:${PORT}`);
});
