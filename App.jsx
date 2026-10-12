import { useState, useId, useEffect, useRef, useCallback } from "react";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2"; // MODO LOCAL: desactivado
import { PackagePlus, Scale, Info, Wallet, KeyRound, EyeOff, Check, Plus, Minus, Leaf as LeafIcon, Users, Shield, Package, ClipboardList, X, ChevronRight, Clock, ShoppingBag, FlaskConical, Tag as TagIcon, Ban, Search, MapPin, Pencil, Trash2, LogOut, Loader2 } from "lucide-react";

/* ═════ MODO LOCAL / MOCK ═════
   Supabase queda reemplazado por un stub no-op: ninguna llamada sale a la red (cero 401 en consola).
   Para volver a la base real: descomentá el import de arriba y el bloque ORIGINAL de abajo, y borrá el stub. */
const LOCAL = true;
const LOCAL_TOKEN = "token-local-dev-ok";
const LOCAL_EMP = { id: 1, name: "Admin (Local)", role: "Administrador", kind: "warrior", admin: true };
const LOCAL_SESSION = { id: 1, name: "Admin (Local)", token: LOCAL_TOKEN, exp: Math.floor(Date.now() / 1000) + 86400 * 365, day: null };
const mockData = () => ({ emps: [LOCAL_EMP], strains: [], members: [], pack: [], orders: [], tasks: [], log: [] });
let TOKEN = LOCAL_TOKEN;

/* Query encadenable y "esperable": cualquier .select/.eq/.order/... devuelve la misma query y al await resuelve { data, error: null } */
const noopQuery = () => {
  const res = { data: [{ id: Date.now() }], error: null };
  const q = new Proxy(function () {}, {
    get: (_, p) => p === "then" ? (f, r) => Promise.resolve(res).then(f, r)
      : p === "single" || p === "maybeSingle" ? () => Promise.resolve({ data: res.data[0], error: null })
      : () => q,
    apply: () => q,
  });
  return q;
};
const supabase = {
  from: () => noopQuery(),
  rpc: () => noopQuery(),
  channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
  removeChannel: () => {},
  realtime: { setAuth: () => {} },
  functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
};

/* ORIGINAL (desactivado en modo local)
const SB_URL = "https://ijamykdaxesqnqzvibsd.supabase.co";
const SB_KEY = "sb_publishable_GmFk8lElJTjof9PgQ6Rjzw_XS4Byh0F";
let TOKEN = null;
const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false }, global: { headers: { "x-client-info": "local-dev" } } });
*/

/* Único dato local: el JWT del turno y el día. Nunca se guardan PIN ni datos del club. */
const STORE = "clubops:v2:";
const load = (name, fallback) => {
  try { const raw = window.localStorage.getItem(STORE + name); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; }
};
const save = (name, value) => {
  try { window.localStorage.setItem(STORE + name, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
};

/* Consultas: lanzan el error en vez de devolverlo, así cada acción se maneja con try/catch */
const ok = async (q) => { const { data, error } = await q; if (error) throw error; return data; };
/* Compare-and-swap: solo escribe si el valor sigue siendo el que vio este dispositivo (evita pisar a otro empleado) */
const cas = async (table, id, old, patch) => {
  let q = supabase.from(table).update(patch).eq("id", id);
  for (const [k, v] of Object.entries(old)) q = q.eq(k, v);
  if (!(await ok(q.select("id"))).length) throw new Error("CONFLICT");
};
/* Operación de varios pasos: si uno falla, revierte los anteriores */
const tx = async (fn) => {
  const undo = [];
  try { return await fn(undo); } catch (e) { await Promise.allSettled(undo.map((f) => f())); throw e; }
};
const casU = async (undo, t, id, old, patch) => { await cas(t, id, old, patch); undo.push(() => cas(t, id, patch, old)); };
const del = async (t, id) => {
  if (!(await ok(supabase.from(t).delete().eq("id", id).select("id"))).length) throw new Error("No se pudo eliminar: sin permiso o ya no existe.");
};
const isAuthErr = (e) => /jwt|jws|token/i.test(String((e && e.message) || "")) || /^PGRST30/.test((e && e.code) || "");

/* ───────── Fila de la base ⇄ forma que usa la interfaz ───────── */
const num = (v) => Number(v) || 0;
const nul = (v) => (v == null || v === "auto" ? undefined : v);
const opt = (v) => (v == null ? undefined : num(v));
const EMP_COLS = "id,nombre,rol,cargo,avatar_svg,created_at"; // nunca se pide `pin`
const ESTADOS = ["pendiente", "listo", "en_camino", "entregado"];
const PACK_K = { bolsa: "bag", frasco: "jar", caja: "box", etiqueta: "lab", nutriente: "nut" };
const packTipo = (n = "") => /bolsa|ziploc/i.test(n) ? "bolsa" : /frasco/i.test(n) ? "frasco" : /caja/i.test(n) ? "caja" : /etiqueta/i.test(n) ? "etiqueta" : /nutri/i.test(n) ? "nutriente" : /sustrato/i.test(n) ? "sustrato" : "otro";
const isPk = (p) => p.k === "bag" || p.k === "box"; // bolsas y cajas se descuentan en cada entrega
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const fmtWhen = (ts) => {
  const d = new Date(ts), t = new Date(), hm = d.toTimeString().slice(0, 5);
  const diff = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return diff <= 0 ? `Hoy ${hm}` : diff === 1 ? `Ayer ${hm}` : diff < 7 ? `${DIAS[d.getDay()]} ${hm}` : `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} ${hm}`;
};
const fromEmp = (r) => ({ id: r.id, name: r.nombre, role: r.cargo, kind: r.avatar_svg, admin: r.rol === "admin" });
const fromStrain = (r) => ({ id: r.id, name: r.nombre, type: r.categoria, stock: num(r.gramos_stock), min: num(r.stock_minimo), max: num(r.stock_maximo), p: num(r.precio_gramo), avatar: nul(r.avatar_svg) });
const fromMember = (r, mov = []) => ({
  id: r.id, first: r.nombre, last: r.apellido, active: r.membresia === "activa", grams: num(r.consumo_mes), limit: num(r.limite_mensual), balance: num(r.saldo_cuenta),
  avatar: nul(r.avatar_cogollito), addr: { street: r.direccion_calle, zone: r.direccion_zona || "CABA", partido: r.direccion_partido, notes: r.direccion_notas }, mov,
});
const fromPack = (r) => ({ id: r.id, name: r.nombre_insumo, unit: r.unidad, qty: num(r.cantidad), min: num(r.cantidad_minima), max: num(r.cantidad_maxima), uc: num(r.costo_unitario) || undefined, k: PACK_K[r.tipo] });
const fromOrder = (r) => {
  const a = r.direccion_entrega || {};
  return {
    id: r.id, m: r.socio_id ?? 0, items: (r.items_json || []).map((i) => ({ s: i.genetica_id, g: num(i.gramos) })), st: Math.max(0, ESTADOS.indexOf(r.estado)), h: r.hora_entrega,
    c: r.estado === "cancelado", cAt: r.cancelado_en ? Date.parse(r.cancelado_en) : undefined, addr: a.street ? a : undefined, alt: r.es_alternativa,
  };
};
const fromTask = (r, emps) => ({ id: r.id, u: emps.findIndex((e) => e.id === r.empleado_id), t: r.descripcion, d: r.completada, f: r.frecuencia === "semanal" ? "s" : "d" });
const fromLog = (r, kinds) => {
  const d = {};
  if (r.cambio_gramos != null) d.g = num(r.cambio_gramos);
  if (r.cambio_dinero != null) d.m = num(r.cambio_dinero);
  if (r.cambio_unidades != null) d.u = num(r.cambio_unidades);
  return {
    id: r.id, ts: Date.parse(r.timestamp), u: r.empleado_nombre || "Sistema", k: kinds[r.empleado_id] || kinds[r.empleado_nombre] || "calm", cat: r.categoria_badge, txt: r.descripcion,
    d: Object.keys(d).length ? d : undefined, why: r.justificacion_merma || undefined, before: opt(r.stock_antes), after: opt(r.stock_despues), unit: r.unidad || undefined,
  };
};

/* MODO LOCAL: devuelve datos mock en memoria (antes leía todas las tablas de Supabase) */
const loadAll = async () => mockData(); // MODO LOCAL: sin red
const RT_TABLES = ["geneticas", "socios", "socio_movimientos", "inventario", "pedidos", "tareas", "audit_log"];

/* ───────── Tokens ───────── */
const INK = "#000";
const CREAM = "#F6F3EC";
const G1 = "#D4D4D8";
const G2 = "#A1A1AA";
const line = (w = 3) => ({ border: `${w}px solid ${INK}` });

/* ───────── Primitivas de UI ───────── */
export function Spark({ x = 0, y = 0, s = 1, c = INK }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0-11q1.5 9.5 11 11-9.5 1.5-11 11-1.5-9.5-11-11 9.5-1.5 11-11z"
      fill={c}
    />
  );
}

const SparkIcon = ({ c = "#fff" }) => (
  <svg viewBox="-12 -12 24 24" width="18" height="18"><Spark c={c} /></svg>
);

function usePress() {
  const [d, setD] = useState(false);
  return {
    style: { transform: d ? "scale(.96)" : "none", transition: "transform .08s" },
    onPointerDown: () => setD(true),
    onPointerUp: () => setD(false),
    onPointerLeave: () => setD(false),
  };
}

export function Pill({ children, onClick, dark, icon: Icon }) {
  const p = usePress();
  return (
    <button
      onClick={onClick}
      {...p}
      style={{ ...line(3), ...p.style, background: dark ? INK : "#fff", color: dark ? "#fff" : INK }}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-3 text-sm font-black"
    >
      {Icon && <Icon size={18} strokeWidth={3} />}
      {children}
    </button>
  );
}

export function Cta({ children, onClick, disabled, light }) {
  const p = usePress();
  const c = light ? INK : "#fff";
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      {...p}
      style={{ ...p.style, background: light ? CREAM : INK, color: c, opacity: disabled ? 0.35 : 1 }}
      className="flex h-14 w-full items-center justify-between rounded-full px-5 text-sm font-black tracking-wide"
    >
      <SparkIcon c={c} />
      {children}
      <SparkIcon c={c} />
    </button>
  );
}

export function RoundBtn({ icon: Icon, label, onClick }) {
  const p = usePress();
  return (
    <button onClick={onClick} {...p} className="flex flex-col items-center gap-1.5" style={p.style}>
      <span
        style={{ ...line(3), width: 72, height: 72, background: CREAM }}
        className="flex items-center justify-center rounded-full"
      >
        <Icon size={30} strokeWidth={2.6} />
      </span>
      <span className="text-xs font-black">{label}</span>
    </button>
  );
}

export function Card({ children }) {
  return (
    <div
      className="rounded-3xl p-5"
      style={{ ...line(3), background: CREAM, color: INK, boxShadow: "0 0 0 3px #3F3F46" }}
    >
      {children}
    </div>
  );
}

export function Tag({ children, dark }) {
  return (
    <span
      style={{ ...line(2), background: dark ? INK : "#fff", color: dark ? "#fff" : INK }}
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-black"
    >
      {children}
    </span>
  );
}

export function Bar({ value, max, min, left, right, compact }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className={`relative w-full overflow-hidden rounded-full bg-white ${compact ? "h-4" : "h-7"}`} style={line(compact ? 2 : 3)}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: INK, transition: "width .3s" }} />
        {min != null && (
          <div className="absolute top-0 h-full" style={{ left: `${(min / max) * 100}%`, width: 3, background: G2 }} />
        )}
      </div>
      {!compact && (
        <div className="mt-1.5 flex justify-between text-sm font-bold">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  );
}

function Blob({ id, c, sh = 6 }) {
  return (
    <g>
      {c.map(([x, y, r], i) => (
        <circle key={"o" + i} cx={x} cy={y} r={r} fill="#fff" stroke={INK} strokeWidth="7" />
      ))}
      {c.map(([x, y, r], i) => (
        <circle key={"g" + i} cx={x} cy={y} r={r} fill={G1} />
      ))}
      <clipPath id={id}>
        {c.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} />
        ))}
      </clipPath>
      <g clipPath={`url(#${id})`}>
        {c.map(([x, y, r], i) => (
          <circle key={"w" + i} cx={x - sh} cy={y - sh} r={r} fill="#fff" />
        ))}
      </g>
    </g>
  );
}

const Arc = ({ x, y, w = 12 }) => (
  <path d={`M${x} ${y}q${w / 2} 6 ${w} 0`} fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
);
const Leaf = ([x, y, r], i) => (
  <path
    key={i}
    transform={`translate(${x} ${y}) rotate(${r})`}
    d="M0 0q7-14 16 0-9 14-16 0z"
    fill={G2}
    stroke={INK}
    strokeWidth="3"
    strokeLinejoin="round"
  />
);
const St = { fill: "none", stroke: INK, strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round" };

const HEAD = [[80, 38, 22], [56, 54, 21], [104, 54, 21], [64, 76, 23], [96, 76, 23], [80, 62, 27]];
const TORSO = [[80, 128, 29], [58, 124, 19], [102, 124, 19]];
const LEAVES = [[40, 38, -60], [112, 26, 20], [128, 58, 60], [26, 66, -110], [70, 14, -20]];

const Cann = ({ x = 0, y = 0, s = 1, r = 0, fill = G2, sw = 3 }) => (
  <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
    {[-70, -35, 35, 70, 0].map((a) => (
      <path
        key={a}
        transform={`rotate(${a})`}
        d={a === 0 ? "M0 0q-8-20 0-42 8 22 0 42z" : "M0 0q-6-15 0-30 6 15 0 30z"}
        fill={fill}
        stroke={INK}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    ))}
    <path d="M0 0v14" stroke={INK} strokeWidth={sw} strokeLinecap="round" />
  </g>
);

const FACE = {
  zen: (<><path d="M58 66q8 7 16 0M86 66q8 7 16 0M74 82h12" {...St} /></>),
  warrior: (<><path d="M58 58l17 7M102 58l-17 7M72 84q8-4 16 0" {...St} /><circle cx="68" cy="70" r="3.4" fill={INK} /><circle cx="92" cy="70" r="3.4" fill={INK} /></>),
  mage: (<><circle cx="68" cy="68" r="3.4" fill={INK} /><circle cx="92" cy="68" r="3.4" fill={INK} /><path d="M72 80q8 6 16 0" {...St} />{Leaf([71, 50, -30], 0)}</>),
  third: (
    <>
      {[[64, 68], [96, 68], [80, 48]].map(([x, y]) => (
        <g key={x + y}>
          <circle cx={x} cy={y} r="8" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx={x + 1} cy={y + 1} r="3.2" fill={INK} />
        </g>
      ))}
      <path d="M70 84q10 8 20 0" {...St} />
    </>
  ),
  sleepy: (
    <>
      {[58, 86].map((x) => (
        <g key={x}>
          <path d={`M${x} 66h16q-2 9-8 9t-8-9z`} fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <circle cx={x + 8} cy="70" r="2.6" fill={INK} />
          <path d={`M${x + 1} 79q7 4 14 0`} {...St} strokeWidth="2.4" />
        </g>
      ))}
      <ellipse cx="80" cy="90" rx="4.5" ry="5.5" fill="#fff" stroke={INK} strokeWidth="3" />
    </>
  ),
  cheer: (<><circle cx="66" cy="66" r="3.4" fill={INK} /><circle cx="94" cy="66" r="3.4" fill={INK} /><path d="M70 78q10 14 20 0z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" /></>),
  calm: (<><circle cx="68" cy="68" r="3.4" fill={INK} /><circle cx="92" cy="68" r="3.4" fill={INK} /><path d="M72 80q8 6 16 0" {...St} /></>),
  grumpy: (<><path d="M58 58l17 8M102 58l-17 8M72 88q8-7 16 0" {...St} /><circle cx="68" cy="72" r="3.4" fill={INK} /><circle cx="92" cy="72" r="3.4" fill={INK} /></>),
  shy: (<><circle cx="68" cy="68" r="3.4" fill={INK} /><circle cx="92" cy="68" r="3.4" fill={INK} /><path d="M54 78l4-5M60 78l4-5M106 78l-4-5M100 78l-4-5M72 84q4-3 8 0t8 0" {...St} strokeWidth="2.6" /></>),
  smug: (
    <>
      {[58, 84].map((x) => (
        <g key={x}>
          <path d={`M${x} 64q8 9 16 0z`} fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <circle cx={x + 10} cy="67" r="2.6" fill={INK} />
          <path d={`M${x} 64h16`} {...St} />
        </g>
      ))}
      <path d="M58 55q8-6 18-2M68 84q14 6 26-6M86 83l3 6 3-7" {...St} />
    </>
  ),
};

const SWIRL = <path d="M132 30a7 7 0 1 1 10 5 12 12 0 1 0-17-8" {...St} />;
const DECOR = {
  zen: (<><Spark x={20} y={40} /><Spark x={142} y={30} s={0.7} /><Spark x={26} y={104} s={0.6} /></>),
  warrior: (<><Spark x={18} y={44} s={0.9} /><Spark x={150} y={152} s={0.8} /></>),
  mage: (<><Spark x={22} y={34} /><Spark x={22} y={150} s={0.7} /><Spark x={152} y={100} s={0.6} /></>),
  third: (<>{SWIRL}<Spark x={22} y={36} s={0.8} /><Spark x={146} y={80} s={0.6} /></>),
  sleepy: (<><text x="124" y="42" fontSize="22" fontWeight="900" fill={INK}>z</text><text x="140" y="22" fontSize="15" fontWeight="900" fill={INK}>z</text></>),
  cheer: (<><Spark x={16} y={22} /><Spark x={146} y={24} s={0.8} /><path d="M50 186q-5 4 0 9M110 186q5 4 0 9" {...St} /></>),
  calm: (<><Spark x={22} y={40} s={0.8} /><Spark x={142} y={34} s={0.6} /></>),
  grumpy: (<path d="M126 28l9 9M135 28l-9 9" {...St} />),
  shy: (<><Spark x={22} y={44} s={0.7} /><path d="M134 40q-6-8 0-12 6 4 0 12z" fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round" /></>),
  smug: (<>{SWIRL}<Spark x={24} y={40} s={0.8} /><Spark x={150} y={70} s={0.5} /></>),
};

export function Bud({ kind = "zen", size = 170, crop = false }) {
  const u = useId().replace(/:/g, "");
  const zen = kind === "zen", up = kind === "cheer";
  const legs = zen
    ? [[[54, 158, 17], [80, 164, 16], [106, 158, 17]]]
    : [[[64, 162, 14], [64, 150, 12]], [[96, 162, 14], [96, 150, 12]]];
  const armL = up ? [[40, 98, 12], [30, 78, 11]] : zen ? [[46, 122, 12], [62, 134, 10]] : [[38, 122, 13], [34, 138, 11]];
  const armR = up ? [[120, 98, 12], [130, 78, 11]]
    : kind === "smug" ? [[124, 110, 12], [136, 92, 11]]
    : zen ? [[114, 122, 12], [98, 134, 10]]
    : kind === "warrior" ? [[124, 122, 13], [140, 114, 10]]
    : kind === "mage" ? [[124, 124, 12], [140, 122, 10]]
    : [[122, 122, 13], [126, 138, 11]];
  return (
    <svg viewBox={crop ? "20 6 120 120" : "0 0 160 200"} width={size} height={crop ? size : (size * 200) / 160}>
      {zen && <ellipse cx="80" cy="192" rx="34" ry="5" fill={INK} />}
      <g transform={zen ? "translate(0 -6)" : up ? "translate(0 -4)" : undefined}>
        {kind === "mage" && (
          <g>
            <path d="M140 192V46" stroke={INK} strokeWidth="8" strokeLinecap="round" />
            <path d="M140 192V46" stroke={G2} strokeWidth="2.5" strokeLinecap="round" />
            <path d="M140 18l8 14-8 14-8-14z" fill="#fff" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
          </g>
        )}
        {kind === "warrior" && (
          <g>
            <path d="M134 110V58l6-20 6 20v52z" fill="#fff" stroke={INK} strokeWidth="4.5" strokeLinejoin="round" />
            <path d="M140 54v50" stroke={G2} strokeWidth="2.5" strokeLinecap="round" />
            <path d="M126 110h28" stroke={INK} strokeWidth="6" strokeLinecap="round" />
          </g>
        )}
        {legs.map((c, i) => <Blob key={i} id={u + "l" + i} c={c} />)}
        <Blob id={u + "t"} c={TORSO} />
        {[[66, 130], [88, 140], [74, 148], [96, 124]].map(([x, y]) => <Arc key={x} x={x} y={y} w={10} />)}
        {kind === "warrior" && (
          <g>
            <path d="M52 104q30 24 56 46" stroke={INK} strokeWidth="7" fill="none" strokeLinecap="round" />
            <path d="M52 104q30 24 56 46" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
            {Leaf([76, 122, -40], 0)}
          </g>
        )}
        {kind === "mage" && (
          <path d="M50 128q30 10 60 0l6 30-14-6-10 12-12-10-12 10-10-12-14 6z" fill={G2} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
        )}
        <Blob id={u + "al"} c={armL} />
        <Blob id={u + "ar"} c={armR} />
        {zen && <Blob id={u + "h"} c={[[80, 134, 10]]} />}
        <Blob id={u + "hd"} c={HEAD} />
        {[[50, 46], [94, 32], [100, 64], [56, 90], [82, 94]].map(([x, y]) => <Arc key={x} x={x} y={y} w={11} />)}
        {FACE[kind] || FACE.calm}
        {LEAVES.map(Leaf)}
        {!crop && (DECOR[kind] || DECOR.calm)}
      </g>
    </svg>
  );
}

const Svg = ({ size, children }) => (
  <svg viewBox="0 0 160 200" width={size} height={(size * 200) / 160}>{children}</svg>
);

function GorillaArt({ size = 190 }) {
  const u = useId().replace(/:/g, "");
  return (
    <Svg size={size}>
      <Blob id={u + "l0"} c={[[62, 172, 15], [62, 160, 13]]} />
      <Blob id={u + "l1"} c={[[98, 172, 15], [98, 160, 13]]} />
      <Blob id={u + "t"} c={[[80, 140, 32], [50, 134, 20], [110, 134, 20]]} />
      {[[62, 140], [88, 148], [74, 158], [98, 132]].map(([x, y]) => <Arc key={x} x={x} y={y} w={10} />)}
      <Cann x={80} y={166} s={0.45} fill="#fff" sw={4} />
      <Blob id={u + "al"} c={[[26, 130, 18], [20, 154, 16]]} />
      <Blob id={u + "ar"} c={[[134, 130, 18], [140, 154, 16]]} />
      <circle cx="40" cy="76" r="11" fill="#fff" stroke={INK} strokeWidth="4" />
      <circle cx="120" cy="76" r="11" fill="#fff" stroke={INK} strokeWidth="4" />
      <Blob id={u + "hd"} c={[[80, 50, 18], [80, 70, 30], [58, 78, 20], [102, 78, 20]]} />
      <ellipse cx="80" cy="95" rx="21" ry="14" fill="#fff" stroke={INK} strokeWidth="4" />
      <path d="M52 65q28-12 56 0" {...St} strokeWidth="7" />
      <circle cx="67" cy="74" r="3.6" fill={INK} />
      <circle cx="93" cy="74" r="3.6" fill={INK} />
      <path d="M74 91h3M83 91h3M70 100q10 5 20 0" {...St} strokeWidth="3" />
      {[[62, 30, -70], [90, 28, 20], [34, 112, -120], [128, 108, 30]].map(Leaf)}
      <path d="M26 182q-6 8 0 12 6-4 0-12zM140 182q-6 8 0 12 6-4 0-12z" fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <Spark x={18} y={44} s={0.9} />
      <Spark x={146} y={40} s={0.7} />
    </Svg>
  );
}

const LEMON = "M12 104q8-4 16-16 16-36 52-36t52 36q8 12 16 16-8 4-16 16-16 36-52 36t-52-36q-8-12-16-16z";
function LemonArt({ size = 190 }) {
  const u = useId().replace(/:/g, "");
  return (
    <Svg size={size}>
      <Blob id={u + "l0"} c={[[64, 162, 12], [60, 174, 11]]} />
      <Blob id={u + "l1"} c={[[96, 162, 12], [100, 174, 11]]} />
      <Blob id={u + "al"} c={[[22, 126, 10], [15, 140, 9]]} />
      <Blob id={u + "ar"} c={[[138, 126, 10], [145, 140, 9]]} />
      <clipPath id={u + "c"}><path d={LEMON} /></clipPath>
      <path d={LEMON} fill={G1} stroke={INK} strokeWidth="6" strokeLinejoin="round" />
      <g clipPath={`url(#${u}c)`}><path d={LEMON} transform="translate(-8 -8)" fill="#fff" /></g>
      <path d={LEMON} fill="none" stroke={INK} strokeWidth="6" strokeLinejoin="round" />
      {[[40, 82], [122, 80], [100, 62], [58, 138], [112, 134], [36, 112]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.8" fill={INK} />)}
      <path d="M52 84q10-8 20-2M92 80q10-6 20 2" {...St} />
      {[[62, 98, 64], [98, 98, 100]].map(([x, y, p]) => (
        <g key={x}>
          <circle cx={x} cy={y} r="9" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx={p + 1} cy={y + 2} r="4" fill={INK} />
          <circle cx={p - 1} cy={y} r="1.3" fill="#fff" />
        </g>
      ))}
      <path d="M52 117q28 8 56 0-4 22-28 22t-28-22z" fill="#fff" stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M66 119v14M80 120v18M94 119v14" {...St} strokeWidth="2.4" />
      <path d="M44 106l7 2M44 113h7M116 106l-7 2M116 113h-7" {...St} strokeWidth="2.4" />
      <path d="M80 54q-2-10 6-14" {...St} />
      <Cann x={90} y={40} s={0.62} r={25} />
      <Spark x={18} y={60} s={0.8} />
      <Spark x={148} y={50} s={0.6} />
    </Svg>
  );
}

const COOKIE = [[80, 100, 42], ...Array.from({ length: 12 }, (_, i) => [80 + 40 * Math.cos((i * Math.PI) / 6), 100 + 40 * Math.sin((i * Math.PI) / 6), 15])];
function CookieArt({ size = 190 }) {
  const u = useId().replace(/:/g, "");
  return (
    <Svg size={size}>
      <Blob id={u + "l0"} c={[[64, 162, 12], [62, 174, 11]]} />
      <Blob id={u + "l1"} c={[[96, 162, 12], [98, 174, 11]]} />
      <Blob id={u + "al"} c={[[24, 112, 10], [17, 126, 9]]} />
      <Blob id={u + "ar"} c={[[136, 104, 10], [145, 88, 9]]} />
      <Blob id={u + "b"} c={COOKIE} sh={7} />
      {[[50, 76, 20], [112, 84, -30], [52, 128, 40], [106, 128, -20], [82, 142, 10], [124, 108, 60], [38, 104, -50]].map(([x, y, r]) => (
        <ellipse key={x} cx={x} cy={y} rx="6.5" ry="4.5" transform={`rotate(${r} ${x} ${y})`} fill={INK} />
      ))}
      <Cann x={80} y={78} s={0.5} fill="#fff" sw={3.5} />
      <circle cx="66" cy="96" r="4" fill={INK} />
      <circle cx="94" cy="96" r="4" fill={INK} />
      <circle cx="67.4" cy="94.6" r="1.2" fill="#fff" />
      <circle cx="95.4" cy="94.6" r="1.2" fill="#fff" />
      <path d="M64 108q16 14 32 0z" fill="#fff" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M54 104l6 2M54 110h6M106 104l-6 2M106 110h-6" {...St} strokeWidth="2.4" />
      {[[22, 66, 3.5], [138, 150, 3], [30, 160, 2.6]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill={G2} stroke={INK} strokeWidth="2" />)}
      <Spark x={20} y={40} s={0.8} />
      <Spark x={146} y={56} s={0.7} />
    </Svg>
  );
}

const Berry = ({ x, y, r }) => (
  <g>
    <circle cx={x} cy={y} r={r} fill="#71717A" stroke={INK} strokeWidth="5" />
    <path d={`M${x - r * 0.55} ${y - r * 0.1}q0 ${-r * 0.45} ${r * 0.45} ${-r * 0.55}`} fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
    <Spark x={x + r * 0.15} y={y - r * 0.5} s={r / 40} />
  </g>
);
function BlueberryArt({ size = 190 }) {
  const u = useId().replace(/:/g, "");
  return (
    <Svg size={size}>
      <Blob id={u + "l0"} c={[[62, 166, 10], [60, 176, 9]]} />
      <Blob id={u + "l1"} c={[[92, 166, 10], [94, 176, 9]]} />
      <Blob id={u + "al"} c={[[36, 134, 9], [30, 148, 8]]} />
      <Berry x={44} y={100} r={26} />
      <Berry x={116} y={98} r={28} />
      <Berry x={80} y={72} r={24} />
      <Berry x={122} y={140} r={17} />
      <Berry x={76} y={124} r={34} />
      {[[64, 118], [88, 118]].map(([x, y]) => (
        <g key={x}>
          <circle cx={x} cy={y} r="8" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx={x + 1} cy={y + 1} r="3.3" fill={INK} />
        </g>
      ))}
      <path d="M64 134q12 10 24 0" {...St} />
      <path d="M52 128l5 2M52 134h5M100 128l-5 2M100 134h-5" {...St} strokeWidth="2.4" />
      <path d="M80 44q-2-12 5-18" {...St} />
      <path d="M85 28q16-20 40-10-6 22-40 10z" fill={G1} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
      <path d="M88 28q16-6 30-8" {...St} strokeWidth="2.2" />
      <Spark x={18} y={70} s={0.8} />
      <Spark x={148} y={64} s={0.6} />
    </Svg>
  );
}

export const STRAIN_ART = { gorilla: GorillaArt, lemon: LemonArt, cookie: CookieArt, blueberry: BlueberryArt };
const STRAIN_RULES = [
  [/gorilla|gg4|glue/i, "gorilla"],
  [/lemon/i, "lemon"],
  [/cookie|girl\s*scout|gsc/i, "cookie"],
  [/blue/i, "blueberry"],
];
export const strainKey = (name = "") => (STRAIN_RULES.find(([r]) => r.test(name)) || [])[1];

export const MEMBER_BUDS = ["calm", "zen", "third", "sleepy", "cheer", "smug", "grumpy", "shy"];
const hash = (s = "") => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export const budFor = (seed) => MEMBER_BUDS[hash(seed) % MEMBER_BUDS.length];
export const budKind = (avatar, seed) => (MEMBER_BUDS.includes(avatar) ? avatar : budFor(seed));
const isUrl = (s) => typeof s === "string" && /^(https?:|data:|\/)/.test(s);

const STRAIN_BUDS = [[/kush/i, "warrior"], [/purple|punch/i, "third"], [/amnesia/i, "sleepy"], [/skittl|zkittl/i, "cheer"]];

export function StrainAvatar({ name, avatar, size = 190 }) {
  if (isUrl(avatar)) return <img src={avatar} alt={name} width={size} height={size} className="object-contain" />;
  if (avatar && typeof avatar !== "string") return avatar;
  if (FACE[avatar] && !STRAIN_ART[avatar]) return <Bud kind={avatar} size={size} />;
  const A = STRAIN_ART[avatar] || STRAIN_ART[strainKey(name)];
  if (A) return <A size={size} />;
  const b = (STRAIN_BUDS.find(([r]) => r.test(name)) || [])[1];
  return <Bud kind={b || "calm"} size={size} />;
}

export function MemberAvatar({ id, name, avatar, size = 96 }) {
  let inner;
  if (isUrl(avatar)) inner = <img src={avatar} alt={name} className="h-full w-full object-cover" />;
  else if (avatar && typeof avatar !== "string") inner = avatar;
  else inner = <Bud kind={budKind(avatar, id ?? name)} size={size - 6} crop />;
  return (
    <div className="flex flex-none items-center justify-center overflow-hidden rounded-full" style={{ ...line(3), background: "#fff", width: size, height: size }}>
      {inner}
    </div>
  );
}

const ST = ["Pendiente", "Listo p/ despacho", "En camino", "Entregado"];
const NEXT = ["Marcar listo", "Despachar", "Entregar"];
const nowHM = () => new Date().toTimeString().slice(0, 5);
const gOf = (items, sid) => r2(items.filter((i) => i.s === sid).reduce((a, i) => a + i.g, 0));
const isActive = (o) => !o.c && o.st < 3;
const leftTxt = (cAt) => {
  const ms = CANCEL_TTL - (Date.now() - cAt);
  if (ms <= 0) return "en breve";
  const h = Math.ceil(ms / 3600000);
  return h >= 24 ? `en ${Math.ceil(h / 24)} d` : `en ${h} h`;
};

const fieldStyle = { ...line(3), background: "#fff", color: INK };
const Lbl = ({ children }) => <div className="mb-1.5 mt-4 text-sm font-black">{children}</div>;
const Num = ({ value, onChange, placeholder }) => (
  <input type="number" inputMode="decimal" min="0" step="any" value={value} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)} className="h-14 w-full rounded-2xl px-4 text-xl font-black" style={fieldStyle} />
);
const Sel = ({ value, onChange, children }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="h-14 w-full rounded-2xl px-3 text-base font-black" style={fieldStyle}>
    {children}
  </select>
);
const Seg = ({ opts, value, onChange, dark }) => (
  <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
    {opts.map(([v, l]) => {
      const on = String(value) === String(v);
      return (
        <button key={v} onClick={() => onChange(v)} className="flex-none flex-grow rounded-full px-4 py-2.5 text-sm font-black whitespace-nowrap"
          style={{
            border: `3px solid ${dark ? CREAM : INK}`,
            background: on ? (dark ? CREAM : INK) : dark ? "transparent" : "#fff",
            color: on ? (dark ? INK : "#fff") : dark ? CREAM : INK,
          }}>
          {l}
        </button>
      );
    })}
  </div>
);
const Chips = ({ vals, onPick, fmt = (v) => `${v}g` }) => (
  <div className="mt-2 flex gap-2">
    {vals.map((v) => (
      <button key={v} onClick={() => onPick(v)} className="rounded-full bg-white px-3.5 py-1.5 text-sm font-black" style={line(2)}>{fmt(v)}</button>
    ))}
  </div>
);

function Sheet({ title, onClose, children, z = 50, wide, narrow }) {
  return (
    <div className="fixed inset-0 flex items-end justify-center md:items-center md:p-6" style={{ background: "rgba(0,0,0,.72)", zIndex: z }}>
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={`relative max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-t-3xl border-t-[3px] border-black px-5 pt-3 md:max-h-[88vh] md:rounded-3xl md:border-[3px] md:px-8 md:pt-6 ${narrow ? "md:max-w-md" : wide ? "md:max-w-2xl lg:max-w-4xl" : "md:max-w-2xl"}`}
        style={{ background: CREAM, color: INK, paddingBottom: "calc(28px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-black md:hidden" />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-3xl font-black tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full bg-white" style={line(3)}>
            <X size={22} strokeWidth={3} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const BalanceTag = ({ bal }) =>
  bal === 0 ? <Tag>Al día</Tag> : bal < 0 ? <Tag dark>Debe ${fg(-bal)}</Tag> : <Tag>A favor ${fg(bal)}</Tag>;

const CANCEL_TTL = 2 * 24 * 3600 * 1000;
const GONE_MEMBER = { id: 0, first: "Socio eliminado", last: "", avatar: undefined };

function DeleteBtn({ children, onClick }) {
  const p = usePress();
  return (
    <button onClick={onClick} {...p} style={{ ...p.style, border: `3px dashed ${INK}`, background: "#fff", color: INK }}
      className="flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2.5 text-sm font-black">
      <Trash2 size={18} strokeWidth={3} />
      {children}
    </button>
  );
}

function ConfirmSheet({ title, question, warn, blocked, onConfirm, onClose }) {
  return (
    <Sheet title={title || (blocked ? "No se puede eliminar" : "Eliminar")} onClose={onClose} z={55} narrow>
      <div className="mt-2 rounded-2xl bg-white p-4" style={line(3)}>
        {blocked ? (
          <p className="text-base font-black leading-snug">{blocked}</p>
        ) : (
          <>
            <p className="text-lg font-black leading-snug">{question}</p>
            <p className="mt-1 text-sm font-bold">Esta acción no se puede deshacer.</p>
            {warn && <div className="mt-3 rounded-xl px-3 py-2 text-sm font-black text-white" style={{ background: INK }}>{warn}</div>}
          </>
        )}
      </div>
      <div className="mt-4 flex gap-2.5">
        {blocked ? (
          <Pill dark icon={Check} onClick={onClose}>Entendido</Pill>
        ) : (
          <>
            <Pill icon={X} onClick={onClose}>Cancelar</Pill>
            <Pill dark icon={Trash2} onClick={onConfirm}>Sí, eliminar</Pill>
          </>
        )}
      </div>
    </Sheet>
  );
}

function MemberSheet({ m, onPay, onSaveAddr, onDelete, onClose }) {
  const [amt, setAmt] = useState("");
  const [edit, setEdit] = useState(false);
  const [ad, setAd] = useState(addrOf(m.addr));
  const v = +amt;
  const debt = m.balance < 0;
  return (
    <Sheet title="Ficha del socio" onClose={onClose} wide>
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-10">
      <div>
      <div className="flex justify-center"><Bud kind={budKind(m.avatar, m.id)} size={210} /></div>
      <h3 className="text-center text-4xl font-black leading-none tracking-tight">{m.first} {m.last}</h3>
      <div className="mt-2 flex justify-center"><Tag dark={m.active}>{m.active ? "Membresía activa" : "Membresía vencida"}</Tag></div>
      <div className="mb-1.5 mt-5 flex items-baseline justify-between">
        <span className="text-sm font-black">Consumo del mes</span>
        <span className="text-sm font-bold">{fg(m.grams)}g{m.grams > m.limit ? " • excedido" : ""}</span>
      </div>
      <Bar value={m.grams} max={m.limit} left="0g" right={`${m.limit}g`} />
      <div className="mt-3 flex h-14 items-center justify-between rounded-full px-5 font-black"
        style={{ ...line(3), background: debt ? INK : "#fff", color: debt ? "#fff" : INK }}>
        <span className="flex items-center gap-2">
          {m.balance === 0 ? <Check size={20} strokeWidth={3} /> : <Wallet size={20} strokeWidth={3} />}
          {m.balance === 0 ? "Cuenta al día" : debt ? "Debe" : "Saldo a favor"}
        </span>
        <span className="text-2xl">${fg(Math.abs(m.balance))}</span>
      </div>
      <Lbl>Dirección de entrega (principal)</Lbl>
      {!edit ? (
        <>
          <div className="-mt-1"><DestBox a={m.addr} /></div>
          <div className="mt-3 flex"><Pill icon={MapPin} onClick={() => { setAd(addrOf(m.addr)); setEdit(true); }}>{hasAddr(m.addr) ? "Editar dirección" : "Cargar dirección"}</Pill></div>
        </>
      ) : (
        <div className="rounded-2xl p-3" style={{ border: `3px dashed ${INK}` }}>
          <div className="-mt-4"><AddrFields v={ad} onChange={setAd} /></div>
          <div className="mt-4 flex gap-2.5">
            <Pill dark icon={Check} onClick={() => { if (validAddr(ad)) { onSaveAddr(m.id, cleanAddr(ad)); setEdit(false); } }}>Guardar</Pill>
            <Pill icon={X} onClick={() => setEdit(false)}>Cancelar</Pill>
          </div>
          {!validAddr(ad) && <Warn>{ad.zone === "GBA" ? "Completá calle y partido para guardar." : "Completá calle y altura para guardar."}</Warn>}
        </div>
      )}
      </div>
      <div className="lg:-mt-4">
      <Lbl>Registrar movimiento</Lbl>
      <Num value={amt} onChange={setAmt} placeholder="Monto $" />
      <Chips vals={[10, 20, 50]} fmt={(x) => `$${x}`} onPick={setAmt} />
      <div className="mt-3 flex gap-2.5">
        <Pill dark icon={Plus} onClick={() => v > 0 && (onPay(m.id, v), setAmt(""))}>Registrar pago</Pill>
        <Pill icon={Minus} onClick={() => v > 0 && (onPay(m.id, -v), setAmt(""))}>Anotar fiado</Pill>
      </div>
      <Lbl>Cuenta corriente detallada</Lbl>
      <div className="rounded-2xl bg-white px-4 py-1" style={line(3)}>
        {m.mov.length === 0 && <p className="py-3 text-sm font-bold">Sin movimientos todavía.</p>}
        {m.mov.slice(0, 8).map((x, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-2.5" style={i ? { borderTop: "2px solid #000" } : undefined}>
            <div className="min-w-0">
              <div className="truncate text-sm font-black">{x.txt}</div>
              <div className="text-xs font-bold text-zinc-500">{x.t}</div>
            </div>
            <span className={`flex-none text-base font-black ${x.amt < 0 ? "rounded-full bg-black px-2.5 py-0.5 text-white" : ""}`}>
              {x.amt === 0 ? "Pagado" : x.amt > 0 ? `+$${fg(x.amt)}` : `−$${fg(-x.amt)}`}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-6"><DeleteBtn onDelete={onDelete}>Eliminar socio</DeleteBtn></div>
      </div>
      </div>
    </Sheet>
  );
}

function OrderSheet({ strains, members, avail, orderId, onConfirm, onClose }) {
  const [mid, setMid] = useState(String(members[0]?.id ?? ""));
  const [sid, setSid] = useState(String(strains[0]?.id ?? ""));
  const [g, setG] = useState("");
  const [h, setH] = useState("19:00");
  const [alt, setAlt] = useState(false);
  const [ad, setAd] = useState(emptyAddr());
  const adding = orderId != null;
  if (!strains.length || (!adding && !members.length)) {
    return (
      <Sheet title="Nuevo pedido" onClose={onClose}>
        <p className="mt-2 text-base font-black">{!strains.length ? "No hay genéticas cargadas." : "No hay socios cargados."} Agregá {!strains.length ? "una genética" : "un socio"} con el botón + antes de crear un pedido.</p>
      </Sheet>
    );
  }
  const n = +g;
  const a = avail(+sid);
  const mem = members.find((x) => x.id === +mid);
  const hasMain = hasAddr(mem && mem.addr);
  const useAlt = alt || !hasMain;
  const okDest = adding || (useAlt ? validAddr(ad) : true);
  return (
    <Sheet title={adding ? `Sumar al pedido #${orderId}` : "Nuevo pedido"} onClose={onClose}>
      {!adding && (<><Lbl>Socio</Lbl><Sel value={mid} onChange={setMid}>{members.map((m) => <option key={m.id} value={m.id}>{m.first} {m.last}</option>)}</Sel></>)}
      <Lbl>Genética</Lbl>
      <Sel value={sid} onChange={setSid}>{strains.map((s) => <option key={s.id} value={s.id}>{s.name} • disp. {fg(avail(s.id))}g</option>)}</Sel>
      <Lbl>Gramos</Lbl>
      <Num value={g} onChange={setG} placeholder="0" />
      {!adding && (<><Lbl>Hora de despacho</Lbl><input type="time" value={h} onChange={(e) => setH(e.target.value)} className="h-14 w-full rounded-2xl px-4 text-xl font-black" style={fieldStyle} /></>)}
      {!adding && (
        <>
          <Lbl>Dirección de entrega</Lbl>
          {!useAlt && <div className="-mt-1"><DestBox a={mem.addr} /></div>}
          {!hasMain && <Warn>Este socio no tiene dirección principal: cargá la de este envío (podés guardarla en su ficha).</Warn>}
          {hasMain && (
            <button onClick={() => setAlt((x) => !x)} className="mt-3 flex w-full items-center gap-3 rounded-full bg-white px-3 py-2.5 text-left text-sm font-black" style={line(3)}>
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-white" style={{ ...line(3), background: alt ? INK : "#fff" }}>{alt && <Check size={14} strokeWidth={4} />}</span>
              Usar dirección alternativa para este pedido
            </button>
          )}
          {useAlt && (
            <div className="mt-2 rounded-2xl p-3" style={{ border: `3px dashed ${INK}` }}>
              <div className="-mt-4"><AddrFields v={ad} onChange={setAd} /></div>
              {hasMain && <Warn>Solo para este envío: la dirección del perfil no se modifica.</Warn>}
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-sm font-bold">{n > a ? `Sin stock disponible (${fg(a)}g)` : "El stock y la bolsa quedan reservados hasta la entrega."}</p>
      <div className="mt-4"><Cta disabled={!(n > 0) || n > a || !okDest} onClick={() => onConfirm({ mid: +mid, sid: +sid, g: n, h, addr: useAlt ? cleanAddr(ad) : { ...(mem && mem.addr) }, alt: hasMain && useAlt })}>{adding ? "SUMAR PRODUCTO" : "CREAR Y RESERVAR"}</Cta></div>
    </Sheet>
  );
}

const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function Splash({ children, onRetry }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center text-white" style={{ background: "#0F0F0F", fontFamily: FONT }}>
      {!onRetry && <Loader2 size={48} strokeWidth={3} className="animate-spin" aria-hidden="true" />}
      <p className="text-xl font-black" role="status">{children}</p>
      {onRetry && <div className="w-full max-w-xs"><Cta light onClick={onRetry}>REINTENTAR</Cta></div>}
    </div>
  );
}

function LoginScreen({ emps, onSubmit }) {
  const [sel, setSel] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const until = err ? err.until : 0;
  const locked = until > now;
  const secs = Math.max(1, Math.ceil((until - now) / 1000));
  const submit = async (v) => {
    if (sel == null || locked || busy || v.length !== 4) return;
    
    // BYPASS LOCAL: Si ponés 0000, entra directo
    if (v === "0000") {
      setBusy(true);
      await onSubmit(sel, "0000");
      setBusy(false);
      return;
    }

    setBusy(true);
    const r = await onSubmit(sel, v);
    setBusy(false);
    if (r && !r.ok) { 
      setErr({ motivo: r.motivo, left: r.intentos_restantes, until: r.bloqueado_hasta ? Date.parse(r.bloqueado_hasta) : 0 }); 
      setPin(""); 
      setNow(Date.now()); 
    }
  };

  const typed = (raw) => {
    const v = raw.replace(/\D/g, "").slice(0, 4);
    setPin(v); setErr(null);
    if (v.length === 4) submit(v);
  };
  const msg = !err ? null : locked ? `Demasiados intentos. Probá de nuevo en ${secs} s.`
    : err.motivo === "pin_incorrecto" ? `PIN incorrecto. Te quedan ${err.left} intentos.`
    : err.motivo === "red" ? "No se pudo conectar. Revisá la conexión e intentá de nuevo."
    : "No se pudo iniciar sesión. Intentá de nuevo.";
  return (
    <div className="min-h-screen text-white md:flex md:items-center md:justify-center" style={{ background: "#0F0F0F", fontFamily: FONT }}>
      <div className="mx-auto w-full max-w-sm px-4 md:max-w-md" style={{ paddingTop: "calc(32px + env(safe-area-inset-top, 0px))", paddingBottom: "calc(32px + env(safe-area-inset-bottom, 0px))" }}>
        <h1 className="text-4xl font-black tracking-tight">Iniciar turno</h1>
        <p className="mt-1 text-sm font-bold text-zinc-400">Elegí tu nombre e ingresá tu PIN de 4 dígitos.</p>
        <div className="mt-6 flex flex-col gap-2">
          {emps.map((e) => {
            const on = sel === e.id;
            return (
              <button key={e.id} onClick={() => { setSel(e.id); setPin(""); setErr(null); }} aria-pressed={on}
                className="flex items-center gap-3 rounded-full px-3 py-2 text-left font-black"
                style={{ border: `3px solid ${CREAM}`, background: on ? INK : CREAM, color: on ? CREAM : INK }}>
                <span className="flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full" style={{ ...line(2), background: "#fff" }}>
                  <Bud kind={e.kind} size={40} crop />
                </span>
                <span className="flex-1 text-lg">{e.name}</span>
              </button>
            );
          })}
        </div>
        <div className="mb-1.5 mt-6 text-sm font-black">PIN</div>
        <input type="password" inputMode="numeric" autoComplete="off" aria-label="PIN" maxLength={4} value={pin}
          disabled={sel == null || locked || busy} placeholder={sel == null ? "Elegí tu nombre primero" : "••••"} onChange={(e) => typed(e.target.value)}
          className="h-14 w-full rounded-2xl px-4 text-center text-2xl font-black tracking-widest" style={{ ...fieldStyle, opacity: sel == null || locked ? 0.5 : 1 }} />
        {msg && <p className="mt-2 text-sm font-black">{msg}</p>}
        <div className="mt-5"><Cta light disabled={sel == null || locked || busy || pin.length !== 4} onClick={() => submit(pin)}>{busy ? "VERIFICANDO..." : "INGRESAR"}</Cta></div>
      </div>
    </div>
  );
}

function SessionSheet({ me, onLogout, onClose }) {
  return (
    <Sheet title="Tu turno" onClose={onClose}>
      <div className="flex justify-center"><Bud kind={me.kind} size={130} /></div>
      <h3 className="text-center text-3xl font-black leading-none tracking-tight">{me.name}</h3>
      <div className="mt-2 flex justify-center gap-1.5"><Tag dark>Sesión activa</Tag><Tag>{me.admin ? "Administrador" : me.role}</Tag></div>
      <p className="mt-4 text-center text-sm font-bold">Al cambiar de turno se cierra tu sesión y el siguiente empleado ingresa con su PIN.</p>
      <div className="mt-4"><Cta onClick={onLogout}>CAMBIAR TURNO</Cta></div>
    </Sheet>
  );
}

const r2 = (x) => Math.round(x * 100) / 100;
const fg = (x) => String(r2(x));
const minOf = (s) => s.min ?? Math.round(s.max * 0.15);
const nivelOf = (s) => (s.stock <= minOf(s) ? "Stock bajo" : s.stock < s.max / 2 ? "Stock medio" : "Stock alto");
const Txt = ({ value, onChange, placeholder, type = "text", maxLength }) => (
  <input type={type} value={value} placeholder={placeholder} maxLength={maxLength}
    inputMode={type === "password" ? "numeric" : undefined}
    onChange={(e) => onChange(e.target.value)} className="h-14 w-full rounded-2xl px-4 text-lg font-black" style={fieldStyle} />
);
const Warn = ({ children }) => <p className="mt-2 text-sm font-black">{children}</p>;

function Picker({ items, value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {items.map(({ k, label, node }) => {
        const on = value === k;
        return (
          <button key={k} onClick={() => onChange(k)} aria-pressed={on}
            className="flex w-24 flex-none flex-col items-center gap-1 rounded-2xl p-2"
            style={{ border: `${on ? 4 : 3}px solid #000`, background: on ? "#fff" : CREAM, boxShadow: on ? "3px 3px 0 #000" : "none" }}>
            <div className="flex h-24 items-center justify-center">{node}</div>
            <span className="text-xs font-black">{label}</span>
            <span className="h-3.5">{on && <Check size={14} strokeWidth={4} />}</span>
          </button>
        );
      })}
    </div>
  );
}

function StockPreview({ s, delta }) {
  const next = Math.max(0, r2(s.stock + delta));
  const mx = next > s.max ? Math.ceil(next / 100) * 100 : s.max;
  const mn = minOf(s);
  return (
    <div className="mt-4 rounded-2xl bg-white p-3" style={line(3)}>
      <div className="mb-2 flex items-baseline justify-between text-sm font-black">
        <span>Stock en tiempo real</span>
        <span>{fg(s.stock)}g → {fg(next)}g</span>
      </div>
      <Bar value={next} max={mx} min={mn} left={`mín ${fg(mn)}g`} right={`${fg(next)}g / ${mx}g`} />
    </div>
  );
}

const StrainHead = ({ s, extra }) => (
  <div className="flex items-center gap-3">
    <div className="flex-none"><StrainAvatar name={s.name} avatar={s.avatar} size={70} /></div>
    <div>
      <div className="text-xl font-black">{s.name}</div>
      <div className="text-sm font-bold text-zinc-600">{extra}</div>
    </div>
  </div>
);

const emptyAddr = () => ({ street: "", zone: "CABA", partido: "", notes: "" });
const addrOf = (a) => ({ ...emptyAddr(), ...(a || {}) });
const hasAddr = (a) => !!(a && a.street && a.street.trim());
const validAddr = (a) => a.street.trim().length >= 3 && (a.zone === "CABA" || a.partido.trim().length >= 2);
const cleanAddr = (a) => ({ street: a.street.trim(), zone: a.zone, partido: a.partido.trim(), notes: a.notes.trim() });
const destText = (a) =>
  a.zone === "GBA" ? `${a.street} - Partido: ${a.partido || "s/d"} (GBA)` : `${a.street} - CABA${a.partido ? ` • ${a.partido}` : ""}`;

function AddrFields({ v, onChange }) {
  const set = (k) => (x) => onChange({ ...v, [k]: x });
  return (
    <>
      <Lbl>Calle y altura / piso / depto</Lbl>
      <Txt value={v.street} onChange={set("street")} placeholder="Ej: Av. Corrientes 1234 4B" />
      <Lbl>Zona / Jurisdicción</Lbl>
      <Seg opts={[["CABA", "CABA"], ["GBA", "Conurbano / GBA"]]} value={v.zone} onChange={set("zone")} />
      <Lbl>{v.zone === "GBA" ? "Partido / Localidad" : "Barrio (opcional)"}</Lbl>
      <Txt value={v.partido} onChange={set("partido")} placeholder={v.zone === "GBA" ? "Ej: Vicente López, Lanús, San Isidro" : "Ej: Palermo"} />
      <Lbl>Notas para el delivery (opcional)</Lbl>
      <Txt value={v.notes} onChange={set("notes")} placeholder="Ej: Timbre no funciona, llamar al celular" maxLength={140} />
    </>
  );
}

function DestBox({ a, alt }) {
  if (!hasAddr(a)) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white p-3 text-sm font-black" style={{ border: `3px dashed ${INK}` }}>
        <MapPin size={20} strokeWidth={3} className="flex-none" /> Sin dirección de entrega cargada
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-2xl bg-white p-3" style={line(3)}>
      <div className="flex items-start gap-2 text-base font-black leading-snug">
        <MapPin size={22} strokeWidth={3} className="mt-0.5 flex-none" /><span>{destText(a)}</span>
      </div>
      {a.notes && <div className="mt-2 rounded-xl px-3 py-1.5 text-sm font-black text-white" style={{ background: INK }}>Notas: {a.notes}</div>}
      {alt && <div className="mt-2"><Tag>Dirección alternativa</Tag></div>}
    </div>
  );
}

function OutSheet({ strain, members, avail, onConfirm, onClose }) {
  const [g, setG] = useState("");
  const [mid, setMid] = useState("0");
  const [paid, setPaid] = useState("1");
  const n = +g;
  const bad = !(n > 0) || n > avail;
  const fiado = mid !== "0" && paid === "0";
  return (
    <Sheet title="Salida rápida" onClose={onClose}>
      <StrainHead s={strain} extra={`Disponible ${fg(avail)}g • $${strain.p}/g`} />
      <Lbl>Gramos exactos</Lbl>
      <Num value={g} onChange={setG} placeholder="Ej: 3.5" />
      <StockPreview s={strain} delta={n > 0 ? -n : 0} />
      <Lbl>Socio</Lbl>
      <Sel value={mid} onChange={(v) => { setMid(v); if (v === "0") setPaid("1"); }}>
        <option value="0">Mostrador (sin socio)</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.first} {m.last}</option>)}
      </Sel>
      {mid !== "0" && (<><Lbl>Cobro</Lbl><Seg opts={[["1", "Pagado"], ["0", "Fiado"]]} value={paid} onChange={setPaid} /></>)}
      <Warn>{n > avail ? `Supera el stock disponible (${fg(avail)}g)` : n > 0 ? `Total $${fg(n * strain.p)}${fiado ? " • queda en cuenta corriente" : ""}` : "Escribí los gramos exactos a descontar"}</Warn>
      <div className="mt-4"><Cta disabled={bad} onClick={() => onConfirm(n, +mid, paid === "1")}>CONFIRMAR SALIDA</Cta></div>
    </Sheet>
  );
}

function MermaSheet({ strain, avail, onConfirm, onClose }) {
  const [g, setG] = useState("");
  const [why, setWhy] = useState("Humedad");
  const [detail, setDetail] = useState("");
  const n = +g;
  const okWhy = detail.trim().length >= 3;
  return (
    <Sheet title="Ajuste / Merma" onClose={onClose}>
      <StrainHead s={strain} extra={`Disponible ${fg(avail)}g`} />
      <Lbl>Gramos perdidos (exactos)</Lbl>
      <Num value={g} onChange={setG} placeholder="Ej: 3.2" />
      <StockPreview s={strain} delta={n > 0 ? -n : 0} />
      <Lbl>Motivo</Lbl>
      <Seg opts={[["Humedad", "Humedad"], ["Tallos", "Tallos"], ["Balanza", "Balanza"]]} value={why} onChange={setWhy} />
      <Lbl>Razón / Justificación (obligatoria)</Lbl>
      <Txt value={detail} onChange={setDetail} placeholder="Ej: Ajuste por humedad / secado en frasco" maxLength={120} />
      <Warn>{n > avail ? `Supera el stock disponible (${fg(avail)}g)` : "Pérdida real de peso: no se descuenta a ningún socio."}</Warn>
      <div className="mt-4"><Cta disabled={!(n > 0) || n > avail || !okWhy} onClick={() => onConfirm(n, `${why} — ${detail.trim()}`)}>REGISTRAR MERMA</Cta></div>
    </Sheet>
  );
}

function IngresoSheet({ strain, onConfirm, onClose }) {
  const [g, setG] = useState("");
  const [lote, setLote] = useState("");
  const n = +g;
  const next = r2(strain.stock + (n > 0 ? n : 0));
  return (
    <Sheet title="Ingreso de stock" onClose={onClose}>
      <StrainHead s={strain} extra={`Stock actual ${fg(strain.stock)}g`} />
      <Lbl>Gramos recibidos (cosecha o lote)</Lbl>
      <Num value={g} onChange={setG} placeholder="Ej: 125.5" />
      <StockPreview s={strain} delta={n > 0 ? n : 0} />
      <Lbl>Origen o lote (opcional)</Lbl>
      <Txt value={lote} onChange={setLote} placeholder="Ej: Cosecha octubre" />
      {next > strain.max && <Warn>La capacidad se amplía a {Math.ceil(next / 100) * 100}g.</Warn>}
      <div className="mt-4"><Cta disabled={!(n > 0)} onClick={() => onConfirm(n, lote.trim())}>REGISTRAR INGRESO</Cta></div>
    </Sheet>
  );
}

const STRAIN_PICK = [["gorilla", "Gorila"], ["lemon", "Limón"], ["cookie", "Galleta"], ["blueberry", "Arándano"], ["zen", "Zen"], ["warrior", "Guerrero"], ["mage", "Mago"], ["third", "Tercer ojo"], ["sleepy", "Dormido"], ["cheer", "Festejo"], ["calm", "Tranquilo"]];
const MEMBER_PICK = [["calm", "Tranquilo"], ["zen", "Zen"], ["third", "Tercer ojo"], ["sleepy", "Dormido"], ["cheer", "Festejo"], ["smug", "Canchero"], ["grumpy", "Gruñón"], ["shy", "Tímido"]];
const STAFF_PICK = [["warrior", "Guerrero"], ["mage", "Mago"], ["cheer", "Festejo"], ["zen", "Zen"], ["third", "Tercer ojo"], ["smug", "Canchero"], ["calm", "Tranquilo"], ["shy", "Tímido"]];

function AddStrainSheet({ strains, onConfirm, onClose }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("Sativa");
  const [g, setG] = useState("");
  const [min, setMin] = useState("");
  const [avatar, setAvatar] = useState("auto");
  const [max, setMax] = useState("");
  const [p, setP] = useState("");
  const init = +g || 0;
  const dup = strains.some((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  const mx = +max > 0 ? +max : Math.max(1000, Math.ceil(init / 100) * 100);
  const mn = min === "" ? Math.round(mx * 0.15) : +min;
  const bad = !name.trim() || dup || g === "" || init < 0 || mn < 0;
  const items = [{ k: "auto", label: "Auto", node: <StrainAvatar name={name} size={72} /> },
    ...STRAIN_PICK.map(([k, label]) => ({ k, label, node: <StrainAvatar avatar={k} size={72} /> }))];
  return (
    <Sheet title="Nueva genética" onClose={onClose}>
      <Lbl>Nombre de la cepa</Lbl>
      <Txt value={name} onChange={setName} placeholder="Ej: Lemon OG" />
      {dup && <Warn>Ya existe una genética con ese nombre.</Warn>}
      <Lbl>Categoría</Lbl>
      <Seg opts={[["Sativa", "Sativa"], ["Indica", "Indica"], ["Híbrida", "Híbrida"]]} value={type} onChange={setType} />
      <Lbl>Gramos iniciales</Lbl>
      <Num value={g} onChange={setG} placeholder="Ej: 125.5" />
      <Lbl>Stock mínimo (g)</Lbl>
      <Num value={min} onChange={setMin} placeholder={String(mn)} />
      <Lbl>Avatar de cuerpo entero</Lbl>
      <Picker items={items} value={avatar} onChange={setAvatar} />
      <Lbl>Capacidad máxima (g) • opcional</Lbl>
      <Num value={max} onChange={setMax} placeholder={String(mx)} />
      <Lbl>Precio por gramo ($) • opcional</Lbl>
      <Num value={p} onChange={setP} placeholder="10" />
      <StockPreview s={{ stock: 0, max: mx, min: mn }} delta={init} />
      <div className="mt-4">
        <Cta disabled={bad} onClick={() => onConfirm({ name: name.trim(), type, stock: r2(init), min: mn, max: mx, p: +p > 0 ? +p : 10, avatar: avatar === "auto" ? undefined : avatar })}>AGREGAR GENÉTICA</Cta>
      </div>
    </Sheet>
  );
}

function AddMemberSheet({ nextId, onConfirm, onClose }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [active, setActive] = useState("1");
  const [limit, setLimit] = useState("");
  const [avatar, setAvatar] = useState("auto");
  const [ad, setAd] = useState(emptyAddr());
  const started = !!(ad.street.trim() || ad.partido.trim());
  const okAddr = !started || validAddr(ad);
  const items = [{ k: "auto", label: "Auto", node: <MemberAvatar id={nextId} name={first || "x"} size={64} /> },
    ...MEMBER_PICK.map(([k, label]) => ({ k, label, node: <MemberAvatar avatar={k} name={k} size={64} /> }))];
  return (
    <Sheet title="Nuevo socio" onClose={onClose}>
      <Lbl>Nombre</Lbl>
      <Txt value={first} onChange={setFirst} placeholder="Ej: Julián" />
      <Lbl>Apellido</Lbl>
      <Txt value={last} onChange={setLast} placeholder="Ej: Paz" />
      <Lbl>Membresía</Lbl>
      <Seg opts={[["1", "Activa"], ["0", "Vencida"]]} value={active} onChange={setActive} />
      <Lbl>Tope de consumo mensual (g) • opcional</Lbl>
      <Num value={limit} onChange={setLimit} placeholder="50" />
      <Lbl>Avatar de cogollito</Lbl>
      <Picker items={items} value={avatar} onChange={setAvatar} />
      <div className="mt-6 text-lg font-black">Dirección principal (opcional)</div>
      <div className="-mt-2"><AddrFields v={ad} onChange={setAd} /></div>
      {!okAddr && <Warn>{ad.zone === "GBA" ? "Completá calle y partido, o dejá la dirección vacía." : "Completá la calle y altura, o dejá la dirección vacía."}</Warn>}
      <div className="mt-4">
        <Cta disabled={!first.trim() || !last.trim() || !okAddr} onClick={() => onConfirm({ first: first.trim(), last: last.trim(), active: active === "1", limit: +limit > 0 ? +limit : 50, avatar: avatar === "auto" ? undefined : avatar, addr: started ? cleanAddr(ad) : undefined })}>AGREGAR SOCIO</Cta>
      </div>
    </Sheet>
  );
}

function StaffSheet({ emps, emp, onConfirm, onClose }) {
  const editing = !!emp;
  const [name, setName] = useState(emp ? emp.name : "");
  const [role, setRole] = useState(emp ? emp.role : "");
  const [pin, setPin] = useState("");
  const [kind, setKind] = useState(emp ? emp.kind : "warrior");
  const [admin, setAdmin] = useState(emp && emp.admin ? "1" : "0");
  const others = emps.filter((e) => !emp || e.id !== emp.id);
  const lastAdmin = !!(emp && emp.admin && emps.filter((e) => e.admin).length === 1);
  const okPin = editing ? pin === "" || /^\d{4}$/.test(pin) : /^\d{4}$/.test(pin), dupPin = false;
  const dupName = others.some((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase());
  const items = STAFF_PICK.map(([k, label]) => ({ k, label, node: <Bud kind={k} size={72} /> }));
  return (
    <Sheet title={editing ? "Editar empleado" : "Nuevo empleado"} onClose={onClose}>
      <Lbl>Nombre</Lbl>
      <Txt value={name} onChange={setName} placeholder="Ej: Lucía" />
      {name.trim() && dupName && <Warn>Ya hay un empleado con ese nombre.</Warn>}
      <Lbl>Rol</Lbl>
      <Txt value={role} onChange={setRole} placeholder="Ej: Dispensario" />
      <Chips vals={["Encargado", "Dispensario", "Cadete"]} fmt={(v) => v} onPick={setRole} />
      <Lbl>Permisos</Lbl>
      <Seg opts={[["0", "Empleado"], ["1", "Administrador"]]} value={admin} onChange={(v) => !lastAdmin && setAdmin(v)} />
      <Warn>{lastAdmin ? "Es el único administrador: tiene que haber al menos uno." : "Los administradores cambian PIN, dan de baja empleados y gestionan el equipo."}</Warn>
      <Lbl>{editing ? "Nuevo PIN • vacío = no cambia" : "PIN de 4 dígitos"}</Lbl>
      <Txt type="password" maxLength={4} value={pin} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))} placeholder="••••" />
      {pin.length > 0 && !okPin && <Warn>El PIN debe tener 4 números.</Warn>}
      {okPin && dupPin && <Warn>Ese PIN ya lo usa otro empleado.</Warn>}
      <Lbl>Avatar</Lbl>
      <Picker items={items} value={kind} onChange={setKind} />
      <div className="mt-4">
        <Cta disabled={!name.trim() || dupName || !role.trim() || !okPin || dupPin} onClick={() => onConfirm({ name: name.trim(), role: role.trim(), pin, kind, admin: admin === "1" })}>{editing ? "GUARDAR CAMBIOS" : "AGREGAR EMPLEADO"}</Cta>
      </div>
    </Sheet>
  );
}

function AddTaskSheet({ emps, onConfirm, onClose }) {
  const [t, setT] = useState("");
  const [u, setU] = useState("0");
  const [f, setF] = useState("d");
  return (
    <Sheet title="Nueva tarea" onClose={onClose}>
      <Lbl>Descripción</Lbl>
      <Txt value={t} onChange={setT} placeholder="Ej: Pesar y etiquetar frascos" />
      <Lbl>Empleado asignado</Lbl>
      <Sel value={u} onChange={setU}>{emps.map((e, i) => <option key={e.name} value={i}>{e.name} • {e.role}</option>)}</Sel>
      <Lbl>Frecuencia</Lbl>
      <Seg opts={[["d", "Diaria"], ["s", "Semanal"]]} value={f} onChange={setF} />
      <div className="mt-4"><Cta disabled={!t.trim()} onClick={() => onConfirm({ u: +u, t: t.trim(), f })}>AGREGAR TAREA</Cta></div>
    </Sheet>
  );
}

const calcCost = (mode, cost, qty) => {
  const c = +cost, q = +qty;
  if (!(c > 0)) return { total: 0, per: 0 };
  return mode === "t" ? { total: r2(c), per: q > 0 ? r2(c / q) : 0 } : { total: r2(c * q), per: r2(c) };
};
const uOf = (p) => p.unit || "u.";

function CostFields({ qty, mode, setMode, cost, setCost, unit }) {
  const { total, per } = calcCost(mode, cost, qty);
  return (
    <>
      <Lbl>Precio / costo de la compra (opcional)</Lbl>
      <Seg opts={[["t", "Costo total"], ["u", "Por unidad"]]} value={mode} onChange={setMode} />
      <div className="mt-2"><Num value={cost} onChange={setCost} placeholder={mode === "t" ? "Ej: 35000" : "Ej: 700"} /></div>
      <Warn>{total > 0 ? `Total $${money(total)}${per ? ` • $${money(per)} por ${unit}` : ""} • se registra como gasto` : "Sin costo: no se registra ningún gasto."}</Warn>
    </>
  );
}

function AddPackSheet({ onConfirm, onClose }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("u.");
  const [qty, setQty] = useState("");
  const [min, setMin] = useState("");
  const [mode, setMode] = useState("t");
  const [cost, setCost] = useState("");
  return (
    <Sheet title="Nuevo insumo" onClose={onClose}>
      <Lbl>Nombre del insumo</Lbl>
      <Txt value={name} onChange={setName} placeholder="Ej: Nutrientes Top Crop, Macetas 5L" />
      <Lbl>Unidad de medida</Lbl>
      <Txt value={unit} onChange={setUnit} placeholder="Ej: u., L, kg" maxLength={8} />
      <Lbl>Cantidad inicial (exacta)</Lbl>
      <Num value={qty} onChange={setQty} placeholder="Ej: 12.5" />
      <Lbl>Stock mínimo</Lbl>
      <Num value={min} onChange={setMin} placeholder="Ej: 2" />
      <CostFields qty={qty} mode={mode} setMode={setMode} cost={cost} setCost={setCost} unit={unit.trim() || "u."} />
      <div className="mt-4">
        <Cta disabled={!name.trim() || qty === "" || min === "" || +qty < 0 || +min < 0}
          onClick={() => onConfirm({ name: name.trim(), unit: unit.trim() || "u.", qty: r2(+qty), min: r2(+min), mode, cost })}>AGREGAR INSUMO</Cta>
      </div>
    </Sheet>
  );
}

function RestockSheet({ p, onConfirm, onClose }) {
  const [qty, setQty] = useState("");
  const [mode, setMode] = useState("t");
  const [cost, setCost] = useState("");
  const u = uOf(p), n = +qty;
  return (
    <Sheet title="Reponer insumo" onClose={onClose}>
      <h3 className="text-3xl font-black leading-none tracking-tight">{p.name}</h3>
      <p className="mt-1 text-sm font-bold">Stock actual {fg(p.qty)} {u}</p>
      <Lbl>Cantidad exacta a agregar ({u})</Lbl>
      <Num value={qty} onChange={setQty} placeholder="Ej: 25" />
      <Warn>{n > 0 ? `Quedan ${fg(p.qty + n)} ${u}` : "Escribí la cantidad comprada"}</Warn>
      <CostFields qty={qty} mode={mode} setMode={setMode} cost={cost} setCost={setCost} unit={u} />
      <div className="mt-4"><Cta disabled={!(n > 0)} onClick={() => onConfirm({ q: n, mode, cost })}>CONFIRMAR REPOSICIÓN</Cta></div>
    </Sheet>
  );
}

function UseSheet({ p, free, onConfirm, onClose }) {
  const [qty, setQty] = useState("");
  const [why, setWhy] = useState("");
  const u = uOf(p), n = +qty;
  return (
    <Sheet title="Usar insumo" onClose={onClose}>
      <h3 className="text-3xl font-black leading-none tracking-tight">{p.name}</h3>
      <p className="mt-1 text-sm font-bold">Disponible {fg(free)} {u}</p>
      <Lbl>Cantidad exacta usada ({u})</Lbl>
      <Num value={qty} onChange={setQty} placeholder="Ej: 1.5" />
      <Lbl>Motivo / uso (opcional)</Lbl>
      <Txt value={why} onChange={setWhy} placeholder="Ej: Riego sala 2" maxLength={80} />
      <Warn>{n > free ? `Supera lo disponible (${fg(free)} ${u})` : n > 0 ? `Quedan ${fg(p.qty - n)} ${u}` : "Escribí la cantidad usada"}</Warn>
      <div className="mt-4"><Cta disabled={!(n > 0) || n > free} onClick={() => onConfirm(n, why.trim())}>REGISTRAR USO</Cta></div>
    </Sheet>
  );
}

function EditPackSheet({ p, onConfirm, onClose }) {
  const [name, setName] = useState(p.name);
  const [unit, setUnit] = useState(uOf(p));
  const [min, setMin] = useState(String(p.min));
  return (
    <Sheet title="Editar insumo" onClose={onClose}>
      <Lbl>Nombre del insumo</Lbl>
      <Txt value={name} onChange={setName} />
      <Lbl>Unidad de medida</Lbl>
      <Txt value={unit} onChange={setUnit} maxLength={8} />
      <Lbl>Stock mínimo</Lbl>
      <Num value={min} onChange={setMin} />
      <div className="mt-4"><Cta disabled={!name.trim() || min === "" || +min < 0} onClick={() => onConfirm({ name: name.trim(), unit: unit.trim() || "u.", min: r2(+min) })}>GUARDAR CAMBIOS</Cta></div>
    </Sheet>
  );
}

function StrainCard({ s, reserved, onOut, onMerma, onIngreso, onDelete }) {
  const [open, setOpen] = useState(false);
  const mn = minOf(s);
  const nivel = nivelOf(s);
  return (
    <Card>
      <div className="flex justify-center"><StrainAvatar name={s.name} avatar={s.avatar} size={240} /></div>
      <h3 className="mt-1 text-center text-4xl font-black tracking-tight">{s.name}</h3>
      <p className="mb-4 mt-1 text-center text-sm font-bold">{s.type} • {nivel}</p>
      <Bar value={s.stock} max={s.max} min={mn} left={`mín ${fg(mn)}g`} right={`${fg(s.stock)}g / ${s.max}g`} />
      <div className="mt-4"><Cta onClick={onOut}>SALIDA RÁPIDA</Cta></div>
      <div className="mt-4 flex justify-between px-2">
        <RoundBtn icon={Scale} label="Merma" onClick={onMerma} />
        <RoundBtn icon={PackagePlus} label="Ingreso" onClick={onIngreso} />
        <RoundBtn icon={Info} label="Detalles" onClick={() => setOpen((o) => !o)} />
      </div>
      {open && (
        <div className="mt-4 rounded-2xl p-3" style={{ border: `3px dashed ${INK}` }}>
          <div className="text-sm font-black">Reservado {fg(reserved)}g • Disponible {fg(s.stock - reserved)}g</div>
          <div className="mt-1 text-sm font-bold">Stock total {fg(s.stock)}g • ${s.p}/g</div>
        </div>
      )}
      <div className="mt-4"><DeleteBtn onClick={onDelete}>Eliminar genética</DeleteBtn></div>
    </Card>
  );
}

function GenView({ strains, reservedOf, openSheet, onDelete }) {
  const list = [...strains].sort((a, b) => b.stock - a.stock);
  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {list.length === 0 && <p className="col-span-full px-1 text-sm font-bold text-zinc-400">No hay genéticas. Tocá + para agregar la primera.</p>}
      {list.map((s) => (
        <StrainCard key={s.id} s={s} reserved={reservedOf(s.id)} onDelete={() => onDelete(s.id)} onOut={() => openSheet({ k: "out", sid: s.id })}
          onMerma={() => openSheet({ k: "merma", sid: s.id })} onIngreso={() => openSheet({ k: "ingreso", sid: s.id })} />
      ))}
    </div>
  );
}

function SociosView({ members, openSheet }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {members.length === 0 && <p className="col-span-full px-1 text-sm font-bold text-zinc-400">No hay socios. Tocá + para agregar el primero.</p>}
      {members.map((m) => (
        <button key={m.id} onClick={() => openSheet({ k: "member", id: m.id })}
          className="flex w-full items-center gap-3 rounded-3xl p-3 text-left"
          style={{ ...line(3), background: CREAM, color: INK, boxShadow: "0 0 0 3px #3F3F46" }}>
          <MemberAvatar id={m.id} name={m.first} avatar={m.avatar} size={68} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-black leading-tight">{m.first} {m.last}</div>
            <div className="mt-1 flex items-center gap-2">
              <Tag dark={m.active}>{m.active ? "Activo" : "Vencido"}</Tag>
              <span className="text-xs font-black">{fg(m.grams)}g / {m.limit}g</span>
            </div>
            <div className="mt-2"><Bar compact value={m.grams} max={m.limit} /></div>
          </div>
          <div className="flex flex-none flex-col items-end gap-2">
            <BalanceTag bal={m.balance} />
            <ChevronRight size={22} strokeWidth={3} />
          </div>
        </button>
      ))}
    </div>
  );
}

const gx = (x) => (Number.isInteger(r2(x)) ? r2(x).toFixed(1) : String(r2(x)));
const money = (v) => Math.abs(v).toLocaleString("es-AR", { maximumFractionDigits: 2 });
const norm = (t = "") => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const fmtTs = (ts) => new Date(ts).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const CATS = {
  out: { label: "SALIDA / MOSTRADOR", bg: "#16A34A" },
  merma: { label: "MERMA / AJUSTE", bg: "#EA580C" },
  socio: { label: "SOCIO / DEUDA", bg: "#2563EB" },
  ingreso: { label: "INGRESO DE STOCK", bg: "#7C3AED" },
  anul: { label: "ANULACIÓN / CANCELADO", bg: "#DC2626" },
  gasto: { label: "GASTO / COMPRA DE INSUMOS", bg: "#A16207" },
  baja: { label: "BAJA / ELIMINADO", bg: "#18181B" },
  sys: { label: "SISTEMA / OTROS", bg: "#52525B" },
};
const CAT_FILTERS = [["all", "Todos"], ["out", "Ventas"], ["merma", "Mermas"], ["socio", "Socios"], ["ingreso", "Cosechas"], ["anul", "Anulaciones"], ["gasto", "Gastos"], ["baja", "Bajas"]];

const Delta = ({ v, unit, ul }) => (
  <span className="rounded-full px-2.5 py-0.5 text-sm font-black text-white" style={{ background: v > 0 ? "#16A34A" : "#DC2626", border: `2px solid ${INK}` }}>
    {v > 0 ? "+" : "−"}{unit === "g" ? `${gx(Math.abs(v))}g` : unit === "u" ? `${fg(Math.abs(v))} ${ul || "u."}` : `$${money(v)}`}
  </span>
);

function LogEntry({ e, first }) {
  const c = CATS[e.cat] || CATS.sys;
  const d = e.d || {};
  return (
    <div className="py-3.5" style={first ? undefined : { borderTop: "2px solid #000" }}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full" style={{ ...line(2), background: "#fff" }}>
          <Bud kind={e.k || "calm"} size={32} crop />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black leading-tight">{e.u}</div>
          <div className="text-xs font-bold text-zinc-600">{fmtTs(e.ts)}</div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black text-white" style={{ background: c.bg, border: `2px solid ${INK}` }}>{c.label}</span>
        {d.g ? <Delta v={d.g} unit="g" /> : null}
        {d.u ? <Delta v={d.u} unit="u" ul={e.unit} /> : null}
        {d.m ? <Delta v={d.m} unit="$" /> : null}
      </div>
      <p className="mt-2 text-sm font-bold leading-snug"><b className="font-black">{e.u}</b> {e.txt}</p>
      {(e.why || e.before != null) && (
        <div className="mt-2 rounded-2xl p-2.5" style={{ border: `2px dashed ${INK}` }}>
          {e.why && (<><div className="text-xs font-black">Razón / Justificación</div><div className="text-sm font-bold">{e.why}</div></>)}
          {e.before != null && (
            <div className={`${e.why ? "mt-2 " : ""}flex flex-wrap items-center gap-x-2 text-xs font-black`}>
              <span>{e.cat === "merma" ? "Stock teórico" : "Stock anterior"}: {e.unit ? `${fg(e.before)} ${e.unit}` : `${gx(e.before)}g`}</span>
              <span>→</span>
              <span>{e.cat === "merma" ? "Balance real" : "Stock nuevo"}: {e.unit ? `${fg(e.after)} ${e.unit}` : `${gx(e.after)}g`}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AuditLog({ log }) {
  const [cat, setCat] = useState("all");
  const [who, setWho] = useState("all");
  const [q, setQ] = useState("");
  const [n, setN] = useState(20);
  const names = [...new Set(log.map((l) => l.u))];
  const nq = norm(q.trim());
  const rows = log.filter((l) =>
    (cat === "all" || l.cat === cat) && (who === "all" || l.u === who) &&
    (!nq || norm(`${l.u} ${l.txt} ${l.why || ""} ${(CATS[l.cat] || CATS.sys).label}`).includes(nq)));
  const filtered = cat !== "all" || who !== "all" || nq;
  const spent = cat === "gasto" ? r2(-rows.reduce((a, l) => a + ((l.d && l.d.m) || 0), 0)) : null;
  const pick = (f) => (v) => { f(v); setN(20); };
  return (
    <Card>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="lg:sticky lg:top-6 lg:order-2">
      <div className="relative">
        <Search size={20} strokeWidth={3} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" />
        <input type="search" value={q} onChange={(e) => pick(setQ)(e.target.value)} placeholder="Buscar socio, genética o texto"
          className="h-12 w-full rounded-full pl-11 pr-4 text-base font-black" style={fieldStyle} />
      </div>
      <div className="mt-3"><Seg opts={CAT_FILTERS} value={cat} onChange={pick(setCat)} /></div>
      <div className="mt-2">
        <select value={who} onChange={(e) => pick(setWho)(e.target.value)} className="h-12 w-full rounded-full px-4 text-base font-black" style={fieldStyle} aria-label="Filtrar por empleado">
          <option value="all">Todos los empleados</option>
          {names.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs font-black">
        <span>{rows.length} de {log.length} registros{spent != null ? ` • Total gastado $${money(spent)}` : ""}</span>
        {filtered && <button onClick={() => { setCat("all"); setWho("all"); setQ(""); setN(20); }} className="underline">Limpiar filtros</button>}
      </div>
      <div className="mt-5 hidden lg:block">
        <div className="mb-2 text-sm font-black">Resumen por tipo</div>
        {CAT_FILTERS.slice(1).map(([k]) => {
          const c = CATS[k] || CATS.sys;
          return (
            <div key={k} className="flex items-center justify-between gap-2 py-1.5">
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-black text-white" style={{ background: c.bg, border: `2px solid ${INK}` }}>{c.label}</span>
              <span className="text-sm font-black">{log.filter((l) => l.cat === k).length}</span>
            </div>
          );
        })}
      </div>
      </div>
      <div className="lg:order-1">
      <div className="mt-1 lg:mt-0">
        {rows.length === 0 && <p className="py-6 text-center text-sm font-bold">Sin registros para estos filtros.</p>}
        {rows.slice(0, n).map((e, i) => <LogEntry key={e.id || i} e={e} first={i === 0} />)}
      </div>
      {rows.length > n && <div className="mt-2 flex"><Pill icon={Plus} onClick={() => setN((x) => x + 20)}>Ver más</Pill></div>}
      </div>
      </div>
    </Card>
  );
}

function StaffList({ emps, tasks, user, isAdmin, openSheet, onReset, onDelete, onLogout }) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
      <div className="col-span-full flex md:max-w-sm"><Pill icon={LogOut} onClick={onLogout}>Cerrar sesión / Cambiar turno</Pill></div>
      {emps.map((e, i) => {
        const t = tasks.filter((x) => x.u === i), done = t.filter((x) => x.d).length;
        return (
          <Card key={e.id}>
            <div className="flex items-center gap-2">
              <div className="flex-none"><Bud kind={e.kind} size={130} /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-4xl font-black leading-none tracking-tight">{e.name}</h3>
                <p className="mt-1.5 text-sm font-bold">{e.role}</p>
                <div className="mt-2 flex flex-wrap gap-1.5"><Tag dark={user === i}>{user === i ? "Sesión activa" : "Fuera de turno"}</Tag>{e.admin && <Tag>Administrador</Tag>}</div>
              </div>
            </div>
            <div className="mb-1.5 mt-4 flex justify-between text-sm font-black"><span>Tareas cumplidas</span><span>{done} de {t.length}</span></div>
            <Bar value={done} max={t.length || 1} left="0" right={`${t.length} tareas`} />
            {isAdmin && (
              <div className="mt-3 flex gap-2.5">
                <Pill icon={KeyRound} onClick={() => openSheet({ k: "editStaff", id: e.id })}>Cambiar PIN</Pill>
                <Pill icon={Pencil} onClick={() => openSheet({ k: "editStaff", id: e.id })}>Editar</Pill>
              </div>
            )}
            <div className="mt-3"><DeleteBtn onClick={() => onDelete(i)}>Dar de baja al empleado</DeleteBtn></div>
          </Card>
        );
      })}
    </div>
  );
}

const TASK_GROUPS = [["d", "Diarias"], ["s", "Semanales"]];
function TasksPanel({ emps, tasks, onTask, onDelete }) {
  const done = tasks.filter((t) => t.d).length, total = tasks.length;
  const pc = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div className="col-span-full"><Card>
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-xl font-black">Cumplimiento general</span>
          <span className="text-sm font-bold">{done} de {total} tareas</span>
        </div>
        <Bar value={done} max={total || 1} left="0" right={`${pc}%`} />
      </Card></div>
      {emps.map((e, i) => {
        const mine = tasks.map((t, ti) => ({ ...t, ti })).filter((t) => t.u === i);
        const dn = mine.filter((t) => t.d).length;
        return (
          <Card key={e.id}>
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full bg-white" style={line(3)}><Bud kind={e.kind} size={42} crop /></span>
              <div className="min-w-0 flex-1">
                <h3 className="text-2xl font-black leading-none tracking-tight">{e.name}</h3>
                <div className="mt-1 text-sm font-bold">{e.role} • {dn} de {mine.length}</div>
              </div>
            </div>
            <Bar compact value={dn} max={mine.length || 1} />
            {mine.length === 0 && <p className="mt-3 text-sm font-bold">Sin tareas asignadas.</p>}
            {TASK_GROUPS.map(([f, label]) => {
              const g = mine.filter((t) => (t.f || "d") === f);
              if (!g.length) return null;
              return (
                <div key={f} className="mt-3">
                  <div className="mb-1.5 flex justify-between text-xs font-black"><span>{label.toUpperCase()}</span><span>{g.filter((t) => t.d).length}/{g.length}</span></div>
                  <div className="flex flex-col gap-2">
                    {g.map((t) => (
                      <div key={t.ti} className="flex items-center gap-2">
                        <button onClick={() => onTask(t.ti)} className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-white px-3 py-2 text-left text-sm font-black" style={line(3)}>
                          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-white" style={{ ...line(3), background: t.d ? INK : "#fff" }}>{t.d && <Check size={14} strokeWidth={4} />}</span>
                          <span className={t.d ? "text-zinc-500 line-through" : ""}>{t.t}</span>
                        </button>
                        <button onClick={() => onDelete(t.ti)} aria-label={`Eliminar tarea: ${t.t}`} className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white" style={line(3)}>
                          <Trash2 size={18} strokeWidth={3} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })}
    </div>
  );
}

function EquipoView({ emps, tasks, user, isAdmin, log, mode, setMode, openSheet, onReset, onTask, onDeleteEmp, onDeleteTask, onLogout }) {
  return (
    <div>
      <div className="md:max-w-xl"><Seg dark opts={[["emp", "Empleados"], ["tar", "Tareas"], ["log", "Registro"]]} value={mode} onChange={setMode} /></div>
      <div className="mt-4">
        {mode === "emp" && <StaffList emps={emps} tasks={tasks} user={user} isAdmin={isAdmin} openSheet={openSheet} onReset={onReset} onDelete={onDeleteEmp} onLogout={onLogout} />}
        {mode === "tar" && <TasksPanel emps={emps} tasks={tasks} onTask={onTask} onDelete={onDeleteTask} />}
        {mode === "log" && (<><h2 className="mb-3 px-1 text-2xl font-black text-white">Registro de actividad</h2><AuditLog log={log} /></>)}
      </div>
    </div>
  );
}

const PACK_ICON = { bag: ShoppingBag, jar: FlaskConical, box: Package, lab: TagIcon, nut: FlaskConical };
function InvView({ pack, strains, reservedOf, freeOf, openSheet, onDelete }) {
  const list = [...strains].sort((a, b) => b.stock - a.stock);
  const totalAvail = r2(strains.reduce((a, s) => a + s.stock - reservedOf(s.id), 0));
  return (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <div className="col-span-full"><Card>
        <h3 className="text-2xl font-black tracking-tight">Flores en stock</h3>
        <p className="mt-1 text-sm font-bold text-zinc-600">Gramos exactos disponibles • total {fg(totalAvail)}g</p>
        <div className="mt-2 md:grid md:grid-cols-2 md:gap-x-8 xl:grid-cols-3">
          {list.map((s, i) => {
            const res = reservedOf(s.id), av = r2(s.stock - res);
            const nivel = nivelOf({ ...s, stock: av });
            return (
              <div key={s.id} className={`py-3${i ? " border-t-2 border-black" : ""}${i < 2 ? " md:border-t-0" : ""}${i < 3 ? " xl:border-t-0" : ""}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-lg font-black">{s.name}</span>
                  <span className="flex-none text-2xl font-black">{fg(av)}g</span>
                </div>
                <div className="mt-1.5"><Bar compact value={av} max={s.max} min={minOf(s)} /></div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs font-bold">
                  <Tag dark={nivel === "Stock bajo"}>{nivel}</Tag>
                  <span>{res > 0 ? `${fg(res)}g reservados • ${fg(s.stock)}g en stock` : `de ${s.max}g`}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card></div>
      <h2 className="col-span-full -mb-2 px-1 text-2xl font-black text-white">Insumos y packaging</h2>
      {pack.length === 0 && <p className="col-span-full px-1 text-sm font-bold text-zinc-400">No hay insumos. Tocá + para agregar el primero.</p>}
      {pack.map((p) => {
        const Icon = PACK_ICON[p.k] || Package;
        const u = uOf(p), free = freeOf(p), res = r2(p.qty - free), low = free <= p.min;
        return (
          <Card key={p.id}>
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-white" style={line(3)}><Icon size={26} strokeWidth={2.6} /></span>
              <div className="min-w-0 flex-1">
                <h3 className="text-2xl font-black leading-tight tracking-tight">{p.name}</h3>
                <div className="mt-1"><Tag dark={low}>{low ? "Stock mínimo" : "Stock ok"}</Tag></div>
              </div>
              <div className="text-right leading-none"><span className="text-4xl font-black">{fg(free)}</span><span className="ml-1 text-sm font-black">{u}</span></div>
            </div>
            <div className="mt-4"><Bar value={free} max={p.max} min={p.min} left={`mín ${fg(p.min)}`} right={`${fg(p.qty)} ${u} en total`} /></div>
            {res > 0 && <p className="mt-1 text-xs font-bold text-zinc-600">{fg(res)} reservadas en pedidos activos</p>}
            {p.uc > 0 && <p className="mt-1 text-xs font-bold text-zinc-600">Último costo: ${money(p.uc)} por {u}</p>}
            <div className="mt-3 flex gap-2">
              <Pill icon={Minus} onClick={() => openSheet({ k: "packUse", id: p.id })}>Usar</Pill>
              <Pill dark icon={Plus} onClick={() => openSheet({ k: "packRestock", id: p.id })}>Reponer</Pill>
              <Pill icon={Pencil} onClick={() => openSheet({ k: "packEdit", id: p.id })}>Editar</Pill>
            </div>
            <div className="mt-3"><DeleteBtn onClick={() => onDelete(p.id)}>Eliminar insumo</DeleteBtn></div>
          </Card>
        );
      })}
    </div>
  );
}

function PedidosSummary({ orders, members }) {
  const act = orders.filter(isActive);
  const rows = [...ST.map((l, i) => [l, orders.filter((o) => !o.c && o.st === i).length]), ["Cancelado", orders.filter((o) => o.c).length]];
  const reserved = r2(act.reduce((a, o) => a + o.items.reduce((t, it) => t + it.g, 0), 0));
  const next = [...act].sort((a, b) => String(a.h).localeCompare(String(b.h))).slice(0, 5);
  const who = (id) => { const m = members.find((x) => x.id === id); return m ? `${m.first}${m.last ? ` ${m.last[0]}.` : ""}` : "Socio eliminado"; };
  return (
    <Card>
      <h3 className="text-2xl font-black tracking-tight">Resumen</h3>
      <p className="mt-1 text-sm font-bold text-zinc-600">{act.length} activos • {fg(reserved)}g reservados</p>
      <div className="mt-3">
        {rows.map(([l, n], i) => (
          <div key={l} className="flex items-center justify-between py-2.5 text-sm font-black" style={i ? { borderTop: "2px solid #000" } : undefined}>
            <span>{l}</span><Tag dark={n > 0}>{n}</Tag>
          </div>
        ))}
      </div>
      <div className="mb-1.5 mt-4 text-sm font-black">Próximos despachos</div>
      {next.length === 0 && <p className="text-sm font-bold">Sin pedidos activos.</p>}
      {next.map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-sm font-bold">
          <span className="min-w-0 truncate">#{o.id} {who(o.m)}</span><span className="flex-none font-black">{o.h}</span>
        </div>
      ))}
    </Card>
  );
}

function PedidosView({ orders, members, strains, openSheet, onAdvance, onCancel, onDelete }) {
  const [f, setF] = useState("all");
  const list = orders.filter((o) => (f === "all" ? true : f === "x" ? o.c : !o.c && String(o.st) === f));
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-4">
      <div className="md:max-w-sm"><Cta light onClick={() => openSheet({ k: "new" })}>NUEVO PEDIDO</Cta></div>
      <Seg dark opts={[["all", "Todos"], ["0", "Pendiente"], ["1", "Listo"], ["2", "En camino"], ["3", "Entregado"], ["x", "Cancelado"]]} value={f} onChange={setF} />
      {list.length === 0 && <p className="px-1 text-sm font-bold text-zinc-400">No hay pedidos en este estado.</p>}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
      {list.map((o) => {
        const m = members.find((x) => x.id === o.m) || GONE_MEMBER;
        return (
          <Card key={o.id}>
            <div className={`flex items-center gap-3 ${o.c ? "opacity-50" : ""}`}>
              <MemberAvatar id={m.id} name={m.first} avatar={m.avatar} size={60} />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-xl font-black leading-tight ${o.c ? "line-through" : ""}`}>#{o.id} {m.first}{m.last ? ` ${m.last[0]}.` : ""}</div>
                <div className="mt-1"><Tag dark={!o.c && o.st >= 2}>{o.c ? "Cancelado" : ST[o.st]}</Tag></div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.items.map((i) => <Tag key={i.s}>{(strains.find((s) => s.id === i.s) || { name: "Genética eliminada" }).name} {fg(i.g)}g</Tag>)}
            </div>
            <div className={o.c ? "opacity-50" : ""}><DestBox a={o.addr || m.addr} alt={o.alt} /></div>
            <div className="mt-3 flex items-center gap-1.5 text-sm font-bold">
              <Clock size={16} strokeWidth={3} /> Despacho {o.h} • Cadete: Tomás{o.c ? " • stock liberado" : ""}
            </div>
            {o.c && (
              <div className="mt-3">
                <DeleteBtn onClick={() => onDelete(o.id)}>Eliminar permanentemente</DeleteBtn>
                {o.cAt && <p className="mt-1.5 text-center text-xs font-bold text-zinc-600">Se limpia solo {leftTxt(o.cAt)}</p>}
              </div>
            )}
            {isActive(o) && (
              <div className="mt-3 flex flex-col gap-2.5">
                <div className="flex"><Pill dark onClick={() => onAdvance(o.id)}>{NEXT[o.st]}</Pill></div>
                <div className="flex gap-2.5">
                  <Pill icon={Plus} onClick={() => openSheet({ k: "add", oid: o.id })}>Producto</Pill>
                  <Pill icon={Ban} onClick={() => onCancel(o.id)}>Cancelar</Pill>
                </div>
              </div>
            )}
          </Card>
        );
      })}
      </div>
      </div>
      <aside className="hidden lg:sticky lg:top-6 lg:block"><PedidosSummary orders={orders} members={members} /></aside>
    </div>
  );
}

const TABS = [["gen", "Genéticas", LeafIcon], ["soc", "Socios", Users], ["eq", "Equipo", Shield], ["inv", "Inventario", Package], ["ped", "Pedidos", ClipboardList]];

function ClubLogo() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl" style={{ background: CREAM, color: INK }}>
        <LeafIcon size={28} strokeWidth={3} />
      </span>
      <div className="leading-none">
        <div className="text-2xl font-black tracking-tight">CLUB OPS</div>
        <div className="mt-1 text-xs font-bold text-zinc-400">Gestión interna</div>
      </div>
    </div>
  );
}

function Sidebar({ me, tab, setTab, onSession, onLogout, badges }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto px-4 py-6 lg:flex xl:w-72" style={{ background: "#0F0F0F", borderRight: `3px solid ${CREAM}` }}>
      <ClubLogo />
      <button onClick={onSession} aria-label="Sesión y cambio de turno" className="mt-6 flex items-center gap-3 rounded-2xl p-3 text-left" style={{ border: `3px solid ${CREAM}`, color: CREAM }}>
        <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full" style={{ background: CREAM }}><Bud kind={me.kind} size={50} crop /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-black leading-tight">{me.name}</span>
          <span className="mt-0.5 block truncate text-xs font-bold text-zinc-400">{me.admin ? "Administrador" : me.role}</span>
          <span className="mt-1.5 block"><Tag>En turno</Tag></span>
        </span>
      </button>
      <nav className="mt-6 flex flex-col gap-2" aria-label="Secciones">
        {TABS.map(([k, label, Icon]) => {
          const on = tab === k, n = badges[k];
          return (
            <button key={k} onClick={() => setTab(k)} aria-current={on ? "page" : undefined} className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-base font-black"
              style={{ background: on ? CREAM : "transparent", color: on ? INK : "#A1A1AA" }}>
              <Icon size={24} strokeWidth={2.8} />
              <span className="flex-1">{label}</span>
              {n > 0 && <span className="rounded-full px-2 py-0.5 text-xs font-black" style={{ background: on ? INK : CREAM, color: on ? CREAM : INK }}>{n}</span>}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto pt-6"><Pill icon={LogOut} onClick={onLogout}>Cambiar turno</Pill></div>
    </aside>
  );
}

export default function App({ initialTab = "gen" }) {
  const [boot, setBoot] = useState("ready");
  const [bootErr, setBootErr] = useState("");
  const [loginList, setLoginList] = useState([{ id: 1, name: LOCAL_EMP.name, kind: LOCAL_EMP.kind }]);
  const [session, setSession] = useState({ ...LOCAL_SESSION, day: dayKey() });
  const [tab, setTab] = useState(initialTab);
  const [strains, setStrains] = useState([]);
  const [members, setMembers] = useState([]);
  const [pack, setPack] = useState([]);
  const [orders, setOrders] = useState([]);
  const [emps, setEmps] = useState([LOCAL_EMP]);
  const [tasks, setTasks] = useState([]);
  const [log, setLog] = useState([]);
  const [eqMode, setEqMode] = useState("emp");
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState("");
  const [confirm, setConfirm] = useState(null);
  const [tick, setTick] = useState(0);
  const toastT = useRef(0), busy = useRef(false), seq = useRef(0), meRef = useRef(null);
  const me = session ? emps.find((e) => e.id === session.id) || null : null;
  const user = me ? emps.indexOf(me) : -1;
  const isAdmin = !!(me && me.admin);
  const adminCount = emps.filter((e) => e.admin).length;
  meRef.current = me;

  const flash = (m, ms = 1800) => { setToast(m); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(""), ms); };
  const resetUi = () => { setSheet(null); setConfirm(null); setTab("gen"); setEqMode("emp"); };
  const restricted = () => setConfirm({ k: "restricted" });

  const toLogin = async (msg) => {
    // MODO LOCAL: "cambiar turno" vuelve a la pantalla de login sin consultar nada (PIN: cualquiera)
    save("session", null); setSession(null);
    resetUi(); setBoot("login");
    if (msg) flash(msg, 3500);
  };
  const expire = (msg) => toLogin(msg || "Tu sesión venció. Ingresá de nuevo.");

  const refresh = useCallback(async () => {
    // MODO LOCAL: datos mock instantáneos, sin red ni loaders
    const d = mockData();
    setEmps(d.emps); setStrains(d.strains); setMembers(d.members); setPack(d.pack); setOrders(d.orders); setTasks(d.tasks); setLog(d.log);
    return d;
  }, []);
  const bg = () => refresh().catch((e) => { if (isAuthErr(e)) expire(); });

  const fail = (e) => {
    console.error(e);
    if (isAuthErr(e)) return expire();
    if (e.message === "CONFLICT") { flash("Otro empleado modificó este dato. Revisá y reintentá.", 3500); return bg(); }
    flash(e.code === "42501" ? "Sin permiso para esta acción." : e.message || "Error inesperado.", 3500);
  };
  const act = (fn) => async (...a) => {
    if (busy.current) return;
    busy.current = true;
    try { await fn(...a); } catch (e) { fail(e); } finally { busy.current = false; }
  };
  const sync = async (msg) => { await refresh(); flash(msg); };
  const finish = async (msg) => { await sync(msg); setConfirm(null); setSheet(null); };

  const note = (txt, x = {}) => {
    const e = meRef.current, { cat = "sys", d = {}, why, before, after, unit, u, eid } = x;
    return supabase.from("audit_log").insert({
      empleado_id: eid ?? (e && e.id) ?? null, empleado_nombre: u ?? (e && e.name) ?? null, categoria_badge: cat, descripcion: txt,
      cambio_gramos: d.g ?? null, cambio_dinero: d.m ?? null, cambio_unidades: d.u ?? null, unidad: unit ?? null,
      stock_antes: before ?? null, stock_despues: after ?? null, justificacion_merma: why ?? null,
    }).then(({ error }) => { if (error) console.error("audit_log:", error.message); });
  };

  
  const doLogin = async (id, pin) => {
  // BYPASS LOCAL: Si ponés 0000, simulamos una sesión exitosa local
  if (LOCAL || pin === "0000") {
      const empleadoElegido = loginList.find((e) => e.id === id) || loginList[0] || { id: 1, name: "Admin", kind: "warrior" };
      const fakeToken = LOCAL_TOKEN;
      TOKEN = fakeToken;
      
      const s = { id: empleadoElegido.id, token: fakeToken, exp: Math.floor(Date.now() / 1000) + 86400, day: dayKey() };
      save("session", s); 
      setSession(s); 
      resetUi(); 
      setBoot("ready");

      // Carga inicial silenciada para dev local
      refresh().catch(() => {});

      flash(`Hola ${empleadoElegido.name} (Modo Local)`);
      return { ok: true, empleado_id: empleadoElegido.id, nombre: empleadoElegido.name, token: fakeToken };
    }

  let r;
  try {
    const { data, error } = await supabase.functions.invoke("login-pin", { body: { empleado_id: id, pin } });
    if (error || !data) return { ok: false, motivo: "red" };
    r = data;
  } catch { return { ok: false, motivo: "red" }; }
  if (!r.ok) return r;
  TOKEN = r.token; supabase.realtime.setAuth(r.token);
  try { await refresh(); } catch { TOKEN = null; return { ok: false, motivo: "red" }; }
  const s = { id: r.empleado_id, token: r.token, exp: r.exp, day: dayKey() };
  save("session", s); setSession(s); resetUi(); setBoot("ready");
  note("inició turno.", { eid: r.empleado_id, u: r.nombre }).then(bg);
  flash(`Hola ${r.nombre}`);
  return r;
};
  /* Arranque local: sin async ni red. Todo ya está en "ready" con la sesión falsa; solo rellena el mock. */
  useEffect(() => { TOKEN = LOCAL_TOKEN; setBoot("ready"); refresh(); }, []);

  const doLogout = async () => { await note("cerró turno."); await toLogin(); };

  useEffect(() => {
    if (LOCAL || boot !== "ready") return; // MODO LOCAL: sin Realtime
    let t;
    const ch = supabase.channel("club");
    RT_TABLES.forEach((tb) => ch.on("postgres_changes", { event: "*", schema: "public", table: tb }, () => { clearTimeout(t); t = setTimeout(bg, 400); }));
    ch.subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [boot]);

  useEffect(() => {
    const t = setInterval(() => { setTick((x) => x + 1); bg(); }, 60000);
    const vis = () => { if (!document.hidden) { setTick((x) => x + 1); bg(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);

  useEffect(() => { if (boot === "ready" && session && !me) expire("Tu usuario ya no está activo."); }, [emps, session, boot]);

  useEffect(() => {
    if (!me) return;
    const now = Date.now(), stale = orders.filter((o) => o.c && o.cAt && now - o.cAt > CANCEL_TTL);
    if (!stale.length) return;
    (async () => {
      const gone = await ok(supabase.from("pedidos").delete().in("id", stale.map((o) => o.id)).eq("estado", "cancelado").select("id"));
      if (gone.length) { await note(`limpió ${gone.length} pedido${gone.length > 1 ? "s" : ""} cancelado${gone.length > 1 ? "s" : ""} con más de 2 días (${gone.map((o) => "#" + o.id).join(", ")}).`, { cat: "baja", u: "Sistema" }); await refresh(); }
    })().catch(() => {});
  }, [orders, tick, me && me.id]);

  const reservedOf = (sid) => r2(orders.filter(isActive).reduce((a, o) => a + gOf(o.items, sid), 0));
  const availOf = (sid) => r2(strains.find((s) => s.id === sid).stock - reservedOf(sid));
  const activeOrders = orders.filter(isActive).length;
  const close = () => setSheet(null);
  const mname = (id) => { const m = members.find((x) => x.id === id); return m ? `${m.first} ${m.last}` : "Socio eliminado"; };
  const nextMemberId = () => Math.max(0, ...members.map((x) => x.id)) + 1;
  const strainOf = (id) => strains.find((s) => s.id === id);
  const totalOf = (items) => r2(items.reduce((a, i) => a + i.g * ((strainOf(i.s) || {}).p || 0), 0));
  const toItems = (items) => items.map((i) => ({ genetica_id: i.s, gramos: i.g }));
  const packFree = (p) => r2(p.qty - (isPk(p) ? activeOrders : 0));
  const packOf = (id) => pack.find((x) => x.id === id);
  const activeWith = (pred) => orders.filter((o) => isActive(o) && pred(o));

  const doOut = act(async (sid, mid, g, paid) => {
    const s = strainOf(sid), cost = r2(g * s.p);
    await tx(async (u) => {
      await casU(u, "geneticas", sid, { gramos_stock: s.stock }, { gramos_stock: r2(s.stock - g) });
      if (mid) {
        const m = members.find((x) => x.id === mid);
        await casU(u, "socios", mid, { consumo_mes: m.grams, saldo_cuenta: m.balance }, { consumo_mes: r2(m.grams + g), saldo_cuenta: paid ? m.balance : r2(m.balance - cost) });
        await ok(supabase.from("socio_movimientos").insert({ socio_id: mid, descripcion: `${paid ? "Retiro" : "Fiado"} ${fg(g)}g ${s.name}`, monto: paid ? 0 : -cost }));
      }
    });
    await note(`registró una Salida Rápida de ${gx(g)}g de ${s.name}${mid ? ` para el socio ${mname(mid)}` : " en mostrador"}${mid && !paid ? ", a cuenta (fiado)" : ""}.`, { cat: "out", d: { g: -g, m: paid ? cost : 0 } });
    await finish(`Salida −${fg(g)}g • quedan ${fg(s.stock - g)}g`);
  });
  const doMerma = act(async (sid, g, why) => {
    const s = strainOf(sid);
    await cas("geneticas", sid, { gramos_stock: s.stock }, { gramos_stock: r2(s.stock - g) });
    await note(`registró una Merma / Ajuste de ${gx(g)}g en ${s.name}.`, { cat: "merma", d: { g: -g }, why, before: s.stock, after: r2(s.stock - g) });
    await finish(`Merma −${fg(g)}g • quedan ${fg(s.stock - g)}g`);
  });
  const doIngreso = act(async (sid, g, lote) => {
    const s = strainOf(sid), ns = r2(s.stock + g);
    await cas("geneticas", sid, { gramos_stock: s.stock }, { gramos_stock: ns, stock_maximo: ns > s.max ? Math.ceil(ns / 100) * 100 : s.max });
    await note(`registró un ingreso de ${gx(g)}g de ${s.name}${lote ? ` (${lote})` : ""}.`, { cat: "ingreso", d: { g }, before: s.stock, after: ns });
    await finish(`Ingreso +${fg(g)}g • total ${fg(ns)}g`);
  });

  const saveAddr = act(async (mid, addr) => {
    await ok(supabase.from("socios").update({ direccion_calle: addr.street, direccion_zona: addr.zone, direccion_partido: addr.partido, direccion_notas: addr.notes }).eq("id", mid));
    await note(`actualizó la dirección principal del socio ${mname(mid)}: ${destText(addr)}.`, { cat: "socio" });
    await sync("Dirección guardada");
  });
  const doPay = act(async (mid, v) => {
    const m = members.find((x) => x.id === mid);
    await tx(async (u) => {
      await casU(u, "socios", mid, { saldo_cuenta: m.balance }, { saldo_cuenta: r2(m.balance + v) });
      await ok(supabase.from("socio_movimientos").insert({ socio_id: mid, descripcion: v > 0 ? "Pago registrado" : "Fiado manual", monto: v }));
    });
    await note(v > 0 ? `registró un pago de $${money(v)} del socio ${mname(mid)}.` : `anotó un fiado manual de $${money(v)} al socio ${mname(mid)}.`, { cat: "socio", d: { m: v } });
    await sync(v > 0 ? "Pago registrado" : "Fiado anotado");
  });

  const newOrder = act(async ({ mid, sid, g, h, addr, alt }) => {
    const items = [{ s: sid, g }];
    const row = await ok(supabase.from("pedidos").insert({ socio_id: mid, direccion_entrega: addr, es_alternativa: !!alt, estado: "pendiente", items_json: toItems(items), total: totalOf(items), hora_entrega: h }).select("id").single());
    await note(`creó el pedido #${row.id} para el socio ${mname(mid)}: reserva ${gx(g)}g de ${strainOf(sid).name}. Destino${alt ? " (dirección alternativa)" : ""}: ${destText(addr)}.`, { cat: "out" });
    await finish("Pedido creado • stock reservado");
  });
  const addItem = act(async (oid, { sid, g }) => {
    const o = orders.find((x) => x.id === oid);
    const items = o.items.some((i) => i.s === sid) ? o.items.map((i) => (i.s === sid ? { ...i, g: r2(i.g + g) } : i)) : [...o.items, { s: sid, g }];
    await ok(supabase.from("pedidos").update({ items_json: toItems(items), total: totalOf(items) }).eq("id", oid));
    await note(`sumó ${gx(g)}g de ${strainOf(sid).name} al pedido #${oid}.`, { cat: "out" });
    await finish("Producto agregado");
  });
  const advance = act(async (oid) => {
    const o = orders.find((x) => x.id === oid), ns = o.st + 1, tg = r2(o.items.reduce((a, i) => a + i.g, 0));
    await tx(async (u) => {
      const rows = await ok(supabase.from("pedidos").update({ estado: ESTADOS[ns] }).eq("id", oid).eq("estado", ESTADOS[o.st]).select("id"));
      if (!rows.length) throw new Error("CONFLICT");
      u.push(() => ok(supabase.from("pedidos").update({ estado: ESTADOS[o.st] }).eq("id", oid)));
      if (ns === 3) {
        for (const it of o.items) { const s = strainOf(it.s); if (s) await casU(u, "geneticas", s.id, { gramos_stock: s.stock }, { gramos_stock: r2(Math.max(0, s.stock - it.g)) }); }
        for (const p of pack.filter(isPk)) await casU(u, "inventario", p.id, { cantidad: p.qty }, { cantidad: r2(Math.max(0, p.qty - 1)) });
        const m = members.find((x) => x.id === o.m);
        if (m) await casU(u, "socios", m.id, { consumo_mes: m.grams }, { consumo_mes: r2(m.grams + tg) });
      }
    });
    await note(ns === 3 ? `entregó el pedido #${oid} del socio ${mname(o.m)} (${gx(tg)}g descontados del stock).` : `movió el pedido #${oid} de ${mname(o.m)} a "${ST[ns]}".`, { cat: "out", d: ns === 3 ? { g: -tg } : undefined });
    await sync(ST[ns]);
  });
  const cancel = act(async (oid) => {
    const o = orders.find((x) => x.id === oid);
    const rows = await ok(supabase.from("pedidos").update({ estado: "cancelado" }).eq("id", oid).in("estado", ["pendiente", "listo", "en_camino"]).select("id"));
    if (!rows.length) throw new Error("CONFLICT");
    await note(`canceló el pedido #${oid} del socio ${mname(o.m)}. Se liberaron ${gx(o.items.reduce((a, i) => a + i.g, 0))}g reservados.`, { cat: "anul" });
    await sync("Stock y packaging liberados");
  });

  const toggleTask = act(async (i) => {
    const t = tasks[i];
    await ok(supabase.from("tareas").update({ completada: !t.d }).eq("id", t.id));
    await note(`${t.d ? "reabrió" : "completó"} la tarea: ${t.t}.`);
    await refresh();
  });

  const doPackUse = act(async (id, q, why) => {
    const p = packOf(id), u = uOf(p);
    await cas("inventario", id, { cantidad: p.qty }, { cantidad: r2(p.qty - q) });
    await note(`registró el uso de ${fg(q)} ${u} de ${p.name}${why ? ` (${why})` : ""}.`, { d: { u: -q }, unit: u, before: p.qty, after: r2(p.qty - q) });
    await finish(`Uso −${fg(q)} ${u} • quedan ${fg(p.qty - q)}`);
  });
  const doRestock = act(async (id, { q, mode, cost }) => {
    const p = packOf(id), u = uOf(p), ns = r2(p.qty + q), { total, per } = calcCost(mode, cost, q);
    await cas("inventario", id, { cantidad: p.qty }, { cantidad: ns, cantidad_maxima: ns > p.max ? Math.ceil(ns / 10) * 10 : p.max, costo_unitario: per || p.uc || 0 });
    await note(`registró el reabastecimiento de ${fg(q)} ${u} de ${p.name}${total > 0 ? ` por $${money(total)} ($${money(per)} por ${u})` : " (sin costo)"}.`,
      { cat: total > 0 ? "gasto" : "sys", d: total > 0 ? { u: q, m: -total } : { u: q }, unit: u, before: p.qty, after: ns });
    await finish(total > 0 ? `Gasto −$${money(total)} registrado` : `Reposición +${fg(q)} ${u}`);
  });
  const doEditPack = act(async (id, v) => {
    const old = packOf(id);
    await ok(supabase.from("inventario").update({ nombre_insumo: v.name, unidad: v.unit, cantidad_minima: v.min }).eq("id", id));
    await note(`editó el insumo ${old.name}${v.name !== old.name ? ` (ahora ${v.name})` : ""}: mínimo ${fg(v.min)} ${v.unit}.`);
    await finish("Insumo actualizado");
  });

  const addStrain = act(async (v) => {
    await ok(supabase.from("geneticas").insert({ nombre: v.name, categoria: v.type, gramos_stock: v.stock, stock_minimo: v.min, stock_maximo: v.max, precio_gramo: v.p, avatar_svg: v.avatar || "auto" }));
    await note(`dio de alta la genética ${v.name} con ${gx(v.stock)}g iniciales.`, v.stock > 0 ? { cat: "ingreso", d: { g: v.stock }, before: 0, after: v.stock } : {});
    await finish(`${v.name} agregada`);
  });
  const addMember = act(async (v) => {
    const a = v.addr;
    await ok(supabase.from("socios").insert({
      nombre: v.first, apellido: v.last, membresia: v.active ? "activa" : "inactiva", limite_mensual: v.limit, avatar_cogollito: v.avatar || "auto",
      direccion_calle: a ? a.street : "", direccion_zona: a ? a.zone : null, direccion_partido: a ? a.partido : "", direccion_notas: a ? a.notes : "",
    }));
    await note(`dio de alta al socio ${v.first} ${v.last}${a ? ` (${destText(a)})` : ""}.`, { cat: "socio" });
    await finish(`${v.first} agregado`);
  });
  const addStaff = act(async (v) => {
    if (!isAdmin) return restricted();
    await ok(supabase.from("empleados").insert({ nombre: v.name, cargo: v.role, pin: v.pin, rol: v.admin ? "admin" : "empleado", avatar_svg: v.kind }));
    await note(`dio de alta al empleado ${v.name} (${v.role}${v.admin ? ", administrador" : ""}).`);
    await finish(`${v.name} agregado al equipo`);
  });
  const editStaff = act(async (id, v) => {
    if (!isAdmin) return restricted();
    const old = emps.find((e) => e.id === id);
    if (!old || (old.admin && !v.admin && adminCount === 1)) return;
    const rows = await ok(supabase.from("empleados").update({ nombre: v.name, cargo: v.role, rol: v.admin ? "admin" : "empleado", avatar_svg: v.kind, ...(v.pin ? { pin: v.pin } : {}) }).eq("id", id).select("id"));
    if (!rows.length) throw new Error("Sin permiso para editar empleados.");
    const ch = [old.name !== v.name && `ahora se llama ${v.name}`, old.role !== v.role && `rol ${v.role}`, old.admin !== v.admin && (v.admin ? "ahora es administrador" : "ya no es administrador"), v.pin && "cambió su PIN"].filter(Boolean);
    await note(`editó el perfil de ${old.name}${ch.length ? ` (${ch.join(", ")})` : ""}.`);
    await finish("Empleado actualizado");
  });
  const addTask = act(async (v) => {
    await ok(supabase.from("tareas").insert({ descripcion: v.t, empleado_id: emps[v.u].id, frecuencia: v.f === "s" ? "semanal" : "diaria" }));
    await note(`creó una tarea ${v.f === "s" ? "semanal" : "diaria"} para ${emps[v.u].name}: ${v.t}.`);
    await finish("Tarea agregada");
  });
  const addPack = act(async (v) => {
    const { total, per } = calcCost(v.mode, v.cost, v.qty);
    await ok(supabase.from("inventario").insert({ nombre_insumo: v.name, unidad: v.unit, cantidad: v.qty, cantidad_minima: v.min, cantidad_maxima: Math.max(v.qty * 2, v.min * 2, 50), costo_unitario: per || 0, tipo: packTipo(v.name) }));
    await note(`dio de alta el insumo ${v.name} con ${fg(v.qty)} ${v.unit} iniciales${total > 0 ? `, compra por $${money(total)} ($${money(per)} por ${v.unit})` : ""}.`,
      { cat: total > 0 ? "gasto" : "sys", d: total > 0 ? { u: v.qty, m: -total } : { u: v.qty }, unit: v.unit, before: 0, after: v.qty });
    await finish(total > 0 ? `${v.name} agregado • gasto −$${money(total)}` : `${v.name} agregado`);
  });

  const delStrain = act(async (sid) => {
    const s = strainOf(sid); if (!s) return;
    await del("geneticas", sid);
    await note(`eliminó la genética ${s.name}${s.stock > 0 ? ` (se descartaron ${gx(s.stock)}g de stock)` : ""}.`, s.stock > 0 ? { cat: "baja", d: { g: -s.stock }, before: s.stock, after: 0 } : { cat: "baja" });
    await finish(`${s.name} eliminada`);
  });
  const delMember = act(async (mid) => {
    const m = members.find((x) => x.id === mid); if (!m) return;
    await del("socios", mid);
    await note(`eliminó al socio ${m.first} ${m.last}${m.balance < 0 ? ` (deuda pendiente de $${money(m.balance)})` : m.balance > 0 ? ` (saldo a favor de $${money(m.balance)})` : ""}.`, { cat: "baja" });
    await finish(`${m.first} eliminado`);
  });
  const delPack = act(async (id) => {
    const p = packOf(id); if (!p) return;
    const u = uOf(p);
    await del("inventario", id);
    await note(`eliminó el insumo ${p.name}${p.qty > 0 ? ` (se descartaron ${fg(p.qty)} ${u})` : ""}.`, p.qty > 0 ? { cat: "baja", d: { u: -p.qty }, unit: u, before: p.qty, after: 0 } : { cat: "baja" });
    await finish(`${p.name} eliminado`);
  });
  const delOrder = act(async (oid) => {
    const o = orders.find((x) => x.id === oid); if (!o || !o.c) return;
    await del("pedidos", oid);
    await note(`eliminó permanentemente el pedido cancelado #${oid} del socio ${mname(o.m)}.`, { cat: "baja" });
    await finish(`Pedido #${oid} eliminado`);
  });
  const delTask = act(async (ti) => {
    const t = tasks[ti]; if (!t) return;
    await del("tareas", t.id);
    await note(`eliminó la tarea ${t.d ? "completada" : "pendiente"} de ${emps[t.u] ? emps[t.u].name : "un empleado"}: ${t.t}.`, { cat: "baja" });
    await finish("Tarea eliminada");
  });
  const askDelTask = (ti) => (tasks[ti] && tasks[ti].d ? delTask(ti) : setConfirm({ k: "task", i: ti }));
  const delEmp = act(async (i) => {
    if (!isAdmin) return restricted();
    const e = emps[i]; if (!e || i === user) return;
    const mine = tasks.filter((t) => t.u === i).length;
    await del("empleados", e.id);
    await note(`dio de baja al empleado ${e.name} (${e.role})${mine ? ` y eliminó sus ${mine} tarea${mine > 1 ? "s" : ""}` : ""}.`, { cat: "baja" });
    await finish(`${e.name} dado de baja`);
  });

  const confirmInfo = () => {
    if (!confirm) return null;
    const ids = (a) => a.map((o) => `#${o.id}`).join(", ");
    const plural = (n, w) => (n > 1 ? `${w}s` : w);
    if (confirm.k === "strain") {
      const s = strains.find((x) => x.id === confirm.id); if (!s) return null;
      const act = activeWith((o) => o.items.some((i) => i.s === s.id));
      return {
        question: `¿Estás seguro de eliminar a ${s.name}?`,
        blocked: act.length ? `${s.name} está en ${act.length} ${plural(act.length, "pedido")} ${plural(act.length, "activo")} (${ids(act)}). Entregalos o cancelalos antes de eliminar la genética.` : null,
        warn: s.stock > 0 ? `Tiene ${fg(s.stock)}g en stock: se descartan y quedan registrados en la auditoría.` : null,
        run: () => delStrain(s.id),
      };
    }
    if (confirm.k === "member") {
      const m = members.find((x) => x.id === confirm.id); if (!m) return null;
      const act = activeWith((o) => o.m === m.id);
      return {
        question: `¿Estás seguro de eliminar a ${m.first} ${m.last}?`,
        blocked: act.length ? `${m.first} tiene ${act.length} ${plural(act.length, "pedido")} ${plural(act.length, "activo")} (${ids(act)}). Entregalos o cancelalos antes de eliminar al socio.` : null,
        warn: m.balance < 0 ? `Tiene una deuda de $${money(m.balance)} sin cobrar: se pierde su cuenta corriente.` : m.balance > 0 ? `Tiene $${money(m.balance)} a favor: se pierde su cuenta corriente.` : null,
        run: () => delMember(m.id),
      };
    }
    if (confirm.k === "pack") {
      const p = packOf(confirm.id); if (!p) return null;
      const u = uOf(p);
      const w = [p.qty > 0 ? `Quedan ${fg(p.qty)} ${u}: se descartan y quedan registrados en la auditoría.` : null,
        isPk(p) && activeOrders > 0 ? "Los pedidos activos dejarían de descontar este material." : null].filter(Boolean).join(" ");
      return { question: `¿Estás seguro de eliminar a ${p.name}?`, blocked: null, warn: w || null, run: () => delPack(p.id) };
    }
    if (confirm.k === "restricted") return { title: "Sin permiso", blocked: "Acción restringida solo a Administradores.", run: () => {} };
    if (confirm.k === "task") {
      const t = tasks[confirm.i]; if (!t) return null;
      return { question: `¿Estás seguro de eliminar la tarea "${t.t}"?`, blocked: null, warn: "Todavía no está completada.", run: () => delTask(confirm.i) };
    }
    if (confirm.k === "emp") {
      const e = emps[confirm.i]; if (!e) return null;
      const mine = tasks.filter((t) => t.u === confirm.i), pend = mine.filter((t) => !t.d).length;
      return {
        question: `¿Estás seguro de dar de baja a ${e.name}?`,
        blocked: confirm.i === user ? `Ahora estás usando el perfil de ${e.name}. Cambiá de turno antes de darlo de baja.` : null,
        warn: mine.length ? `Se eliminan sus ${mine.length} tarea${mine.length > 1 ? "s" : ""}${pend ? ` (${pend} sin completar)` : ""} y su PIN deja de funcionar.` : "Su PIN deja de funcionar.",
        run: () => delEmp(confirm.i),
      };
    }
    if (confirm.k === "order") {
      const o = orders.find((x) => x.id === confirm.id); if (!o) return null;
      return { question: `¿Estás seguro de eliminar el pedido #${o.id} de ${mname(o.m)}?`, blocked: null, warn: null, run: () => delOrder(o.id) };
    }
    return null;
  };
  const ci = confirmInfo();

  if (boot === "loading") return <Splash>Cargando club...</Splash>;
  if (boot === "error") return <Splash onRetry={() => window.location.reload()}>{`No se pudo conectar con el club.${bootErr ? ` (${bootErr})` : ""}`}</Splash>;
  if (!me) return boot === "login" ? <LoginScreen emps={loginList} onSubmit={doLogin} /> : <Splash>Cargando club...</Splash>;

  const lowPack = pack.filter((p) => packFree(p) <= p.min).length;
  const total = r2(strains.reduce((a, s) => a + s.stock, 0));
  const debt = r2(members.filter((m) => m.balance < 0).reduce((a, m) => a - m.balance, 0));
  const HEAD = {
    gen: ["Genéticas", `${fg(total)}g en ${strains.length} cepas`],
    soc: ["Socios", `${members.length} socios • deuda total $${fg(debt)}`],
    eq: ["Equipo", `Sesión: ${me.name} • ${me.admin ? "Administrador" : me.role}`],
    inv: ["Inventario", lowPack ? `${lowPack} material${lowPack > 1 ? "es" : ""} en mínimo` : "Todo en orden"],
    ped: ["Pedidos", `${activeOrders} pedidos activos hoy`],
  }[tab];
  const ADD = {
    gen: [{ k: "addStrain" }, "Agregar genética"],
    soc: [{ k: "addMember" }, "Agregar socio"],
    eq: eqMode === "emp" ? [{ k: "addStaff" }, "Agregar empleado"] : eqMode === "tar" ? [{ k: "addTask" }, "Agregar tarea"] : null,
    inv: [{ k: "addPack" }, "Agregar material"],
    ped: [{ k: "new" }, "Nuevo pedido"],
  }[tab];

  const sm = sheet && sheet.k === "member" ? members.find((m) => m.id === sheet.id) : null;
  const sp = sheet && ["packUse", "packRestock", "packEdit"].includes(sheet.k) ? pack.find((x) => x.id === sheet.id) : null;
  const ss = sheet && ["out", "merma", "ingreso"].includes(sheet.k) ? strains.find((s) => s.id === sheet.sid) : null;

  return (
    <div className="min-h-screen text-white" style={{ background: "#0F0F0F", fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
      <div className="lg:pl-64 xl:pl-72">
      <div className="mx-auto max-w-sm px-4 pb-[120px] md:max-w-3xl md:px-6 lg:mx-0 lg:max-w-[1600px] lg:px-8 lg:pb-12 xl:px-10" style={{ paddingTop: "calc(24px + env(safe-area-inset-top, 0px))" }}>
        <header className="mb-5 flex items-center justify-between gap-2 md:mb-6 lg:mb-8">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-black tracking-tight md:text-4xl">{HEAD[0]}</h1>
            <p className="mt-0.5 truncate text-sm font-bold text-zinc-400 md:text-base">{HEAD[1]}</p>
          </div>
          {ADD && (
            <button onClick={() => (tab === "eq" && eqMode === "emp" && !isAdmin ? restricted() : setSheet(ADD[0]))} aria-label={ADD[1]}
              className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl" style={{ background: CREAM, color: INK, border: `3px solid ${CREAM}` }}>
              <Plus size={30} strokeWidth={4} />
            </button>
          )}
          <button onClick={() => setSheet({ k: "session" })} aria-label="Sesión y cambio de turno"
            className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full lg:hidden" style={{ border: `3px solid ${CREAM}`, background: CREAM }}>
            <Bud kind={me.kind} size={50} crop />
          </button>
        </header>

        {tab === "gen" && <GenView strains={strains} reservedOf={reservedOf} openSheet={setSheet} onDelete={(id) => setConfirm({ k: "strain", id })} />}
        {tab === "soc" && <SociosView members={members} openSheet={setSheet} />}
        {tab === "eq" && <EquipoView emps={emps} tasks={tasks} user={user} isAdmin={isAdmin} onLogout={doLogout} log={log} mode={eqMode} setMode={setEqMode} openSheet={setSheet} onTask={toggleTask} onDeleteEmp={(i) => (isAdmin ? setConfirm({ k: "emp", i }) : restricted())} onDeleteTask={askDelTask} />}
        {tab === "inv" && <InvView pack={pack} strains={strains} reservedOf={reservedOf} freeOf={packFree} openSheet={setSheet} onDelete={(id) => setConfirm({ k: "pack", id })} />}
        {tab === "ped" && <PedidosView orders={orders} members={members} strains={strains} openSheet={setSheet} onAdvance={advance} onCancel={cancel} onDelete={(id) => setConfirm({ k: "order", id })} />}
      </div>
      </div>

      <Sidebar me={me} tab={tab} setTab={setTab} onSession={() => setSheet({ k: "session" })} onLogout={doLogout} badges={{ ped: activeOrders, inv: lowPack }} />

      <nav className="fixed bottom-0 left-0 right-0 z-40 mx-auto flex max-w-sm gap-1 px-2 pt-2 md:max-w-3xl lg:hidden" style={{ background: "#0F0F0F", borderTop: `3px solid ${CREAM}`, paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }}>
        {TABS.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className="flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-xs font-black"
            style={{ background: tab === k ? CREAM : "transparent", color: tab === k ? INK : "#A1A1AA" }}>
            <Icon size={22} strokeWidth={2.8} />
            {label}
          </button>
        ))}
      </nav>

      {toast && (
        <div className="fixed left-0 right-0 z-[60] flex justify-center px-4" style={{ top: "calc(14px + env(safe-area-inset-top, 0px))" }}>
          <div className="rounded-full px-5 py-3 text-sm font-black" style={{ background: CREAM, color: INK, border: "3px solid #000" }}>{toast}</div>
        </div>
      )}

      {sheet && sheet.k === "out" && ss && <OutSheet strain={ss} members={members} avail={availOf(ss.id)} onConfirm={(g, mid, paid) => doOut(ss.id, mid, g, paid)} onClose={close} />}
      {sheet && sheet.k === "merma" && ss && <MermaSheet strain={ss} avail={availOf(ss.id)} onConfirm={(g, why) => doMerma(ss.id, g, why)} onClose={close} />}
      {sheet && sheet.k === "ingreso" && ss && <IngresoSheet strain={ss} onConfirm={(g, lote) => doIngreso(ss.id, g, lote)} onClose={close} />}
      {sm && <MemberSheet m={sm} onPay={doPay} onSaveAddr={saveAddr} onDelete={() => setConfirm({ k: "member", id: sm.id })} onClose={close} />}
      {sheet && sheet.k === "new" && <OrderSheet strains={strains} members={members} avail={availOf} onConfirm={newOrder} onClose={close} />}
      {sheet && sheet.k === "add" && <OrderSheet strains={strains} members={members} avail={availOf} orderId={sheet.oid} onConfirm={(v) => addItem(sheet.oid, v)} onClose={close} />}
      {sheet && sheet.k === "session" && <SessionSheet me={me} onLogout={doLogout} onClose={close} />}
      {sheet && sheet.k === "addStrain" && <AddStrainSheet strains={strains} onConfirm={addStrain} onClose={close} />}
      {sheet && sheet.k === "addMember" && <AddMemberSheet nextId={nextMemberId()} onConfirm={addMember} onClose={close} />}
      {sheet && sheet.k === "addStaff" && isAdmin && <StaffSheet emps={emps} onConfirm={addStaff} onClose={close} />}
      {sheet && sheet.k === "editStaff" && isAdmin && emps.find((e) => e.id === sheet.id) && <StaffSheet emps={emps} emp={emps.find((e) => e.id === sheet.id)} onConfirm={(v) => editStaff(sheet.id, v)} onClose={close} />}
      {sheet && sheet.k === "addTask" && <AddTaskSheet emps={emps} onConfirm={addTask} onClose={close} />}
      {sheet && sheet.k === "addPack" && <AddPackSheet onConfirm={addPack} onClose={close} />}
      {sheet && sheet.k === "packUse" && sp && <UseSheet p={sp} free={packFree(sp)} onConfirm={(q, why) => doPackUse(sp.id, q, why)} onClose={close} />}
      {sheet && sheet.k === "packRestock" && sp && <RestockSheet p={sp} onConfirm={(v) => doRestock(sp.id, v)} onClose={close} />}
      {ci && <ConfirmSheet title={ci.title} question={ci.question} warn={ci.warn} blocked={ci.blocked} onConfirm={ci.run} onClose={() => setConfirm(null)} />}
      {sheet && sheet.k === "packEdit" && sp && <EditPackSheet p={sp} onConfirm={(v) => doEditPack(sp.id, v)} onClose={close} />}
    </div>
  );
}